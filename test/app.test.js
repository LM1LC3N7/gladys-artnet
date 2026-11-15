// -----------------------------------------------------------------------------
// ArtnetApp with the SDK's fake Gladys, the exact handlers of the container
// (src/handlers.js), a simulated node on 127.0.0.1 (real UDP) and a sped-up
// REAL clock (it moves between any two reads), a memory store.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ArtnetApp } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { parseDmx } from '../src/protocol.js';
import { flakyOpen, pollReply, speedClock, startNode, until } from './helpers/node.js';

const SPEED = 10;
const dev = (id) => ({ external_id: `ext:artnet:fixture:${id}` });
const feat = (id, key) => ({ external_id: `ext:artnet:fixture:${id}:${key}` });
const FIXTURES = '1 rgb Salon; 4 dimmer Bar; 0/10 cct Bureau; 2/1 drgbw Scène';
const quietLogger = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );

async function setup(
  t,
  {
    node,
    store = memoryStore(),
    config = {},
    speed = SPEED,
    connect = true,
    getConfig,
    open,
    timings = TIMINGS,
    port,
  } = {},
) {
  if (!node && port === undefined) node = await startNode();
  const gladys = createFakeGladys({
    selector: 'artnet',
    config: {
      node_address: `127.0.0.1:${port ?? node.port}`,
      fixtures: FIXTURES,
      language: 'en',
      ...config,
    },
  });
  if (getConfig) {
    // The fake reads the configuration itself in connect(): only the app's reads fail.
    const original = gladys.getConfig.bind(gladys);
    gladys.getConfig = () => (gladys.connected ? getConfig() : original());
  }
  const logs = [];
  const clock = speedClock(speed);
  const app = new ArtnetApp({
    gladys,
    logger: quietLogger(logs),
    store,
    monotonic: clock.monotonic,
    timers: clock.timers,
    timings,
    localPort: 0,
    ...(open ? { open } : {}),
  });
  registerHandlers(gladys, app, quietLogger(logs));
  t.after(async () => {
    await app.stop();
    await node?.halt();
  });
  if (connect) {
    await gladys.connect();
    await until(() => app.configRead || app.configError, 3000, 'config');
    await until(() => app.memory !== undefined || app.storeFailed, 3000, 'store');
  }
  return { gladys, app, node, logs, store, clock };
}

/** Waits until the last frame of a universe (or a slice of it) is the expected one. */
async function frameIs(node, universe, expected, slice) {
  const shown = () => {
    const f = node.last(universe);
    return f && JSON.stringify(slice ? f.data.slice(...slice) : f.data);
  };
  await until(
    () => shown() === JSON.stringify(expected),
    2000,
    `universe ${universe}: ${expected} (seen ${shown()})`,
  );
}

async function frameZero(node, universe) {
  await until(
    () => node.last(universe)?.data.every((v) => v === 0),
    2000,
    `universe ${universe} at 0`,
  );
}

const set = (gladys, id, key, value) => gladys.fake.setValue(dev(id), feat(id, key), value);

test('discovery: one light per fixture, features of its profile, written without feedback', async (t) => {
  const { gladys } = await setup(t);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.external_id, d.name]),
    [
      ['ext:artnet:fixture:u0-a1', 'Salon'],
      ['ext:artnet:fixture:u0-a4', 'Bar'],
      ['ext:artnet:fixture:u0-a10', 'Bureau'],
      ['ext:artnet:fixture:u2-a1', 'Scène'],
    ],
  );
  assert.deepEqual(
    devices[0].features.map((f) => f.external_id.split(':').pop()),
    ['binary', 'brightness', 'color'],
  );
  assert.deepEqual(
    devices[2].features.map((f) => f.external_id.split(':').pop()),
    ['binary', 'brightness', 'temperature'],
  );
  for (const f of devices.flatMap((d) => d.features)) {
    assert.equal(f.has_feedback, false);
    assert.equal(f.read_only, false);
  }
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(status.message.en, /Ready: 4 fixture\(s\).*assumed state/);
  const badges = gladys.fake.transports;
  assert.equal(badges.length, 4);
  assert.ok(badges.every((b) => b.degraded === true && b.transport === 'local'));
});

test('a command sends the whole universe; nothing is sent before the first command', async (t) => {
  const { gladys, node, clock } = await setup(t);
  await clock.wait(2000);
  assert.equal(node.frames.length, 0, 'nothing sent at start');
  const ack = await set(gladys, 'u0-a1', 'color', 0xff8000);
  assert.equal(ack.success, true, ack.error);
  // Salon rgb at 1-3 (on, full brightness), Bar 4 and Bureau 10-11 at 0, length 12 (even).
  await frameIs(node, 0, [255, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(gladys.fake.lastState('ext:artnet:fixture:u0-a1:binary'), 1);
  // The other fixtures of the universe were never commanded: assumed off, said to Gladys.
  assert.equal(gladys.fake.lastState('ext:artnet:fixture:u0-a4:binary'), 0);
  assert.equal(gladys.fake.lastState('ext:artnet:fixture:u0-a10:binary'), 0);
  // Universe 2 was not touched.
  assert.equal(node.of(2).length, 0);
  assert.equal(gladys.fake.lastState('ext:artnet:fixture:u2-a1:binary'), undefined);
});

test('profiles: brightness scales, cct mixes, drgbw puts intensity first', async (t) => {
  const { gladys, node } = await setup(t);
  assert.equal((await set(gladys, 'u0-a4', 'brightness', 50)).success, true);
  await frameIs(node, 0, [128], [3, 4]);
  assert.equal((await set(gladys, 'u0-a10', 'temperature', 370)).success, true);
  await frameIs(node, 0, [0, 255], [9, 11]);
  assert.equal((await set(gladys, 'u2-a1', 'color', 0xffffff)).success, true);
  await frameIs(node, 2, [255, 0, 0, 0, 255], [0, 5]);
  assert.equal((await set(gladys, 'u2-a1', 'brightness', 20)).success, true);
  await frameIs(node, 2, [51, 0, 0, 0, 255], [0, 5]);
});

test('off: every channel of the fixture at 0, kept by the keep-alive; brightness 0 is off', async (t) => {
  const { gladys, node, clock } = await setup(t);
  await set(gladys, 'u0-a1', 'binary', 1);
  await set(gladys, 'u0-a4', 'binary', 1);
  await frameIs(node, 0, [255, 255, 255, 255], [0, 4]);
  assert.equal((await set(gladys, 'u0-a1', 'binary', 0)).success, true);
  await frameIs(node, 0, [0, 0, 0, 255], [0, 4]);
  assert.equal((await set(gladys, 'u0-a4', 'brightness', 0)).success, true);
  await frameIs(node, 0, [0, 0, 0, 0], [0, 4]);
  assert.equal(gladys.fake.lastState('ext:artnet:fixture:u0-a4:binary'), 0);
  const count = node.of(0).length;
  await clock.wait(3000);
  const later = node.of(0).slice(count);
  assert.ok(later.length >= 2, `keep-alive frames: ${later.length}`);
  assert.ok(later.every((f) => f.data.every((v) => v === 0)));
});

test('rate: a burst of 60 commands leaves as at most 40 frames a second, the last one wins', async (t) => {
  const { gladys, node, clock } = await setup(t);
  await set(gladys, 'u0-a4', 'binary', 1);
  const start = node.of(0).length;
  const t0 = clock.monotonic();
  const acks = await Promise.all(
    Array.from({ length: 60 }, (_, i) => set(gladys, 'u0-a4', 'brightness', i + 1)),
  );
  const elapsed = clock.monotonic() - t0;
  assert.ok(acks.every((a) => a.success));
  const frames = node.of(0).slice(start);
  assert.ok(frames.length <= Math.ceil(elapsed / TIMINGS.gap) + 1, `${frames.length} frames`);
  await frameIs(node, 0, [Math.round(2.55 * 60)], [3, 4]);
  const gaps = frames.slice(1).map((f, i) => (f.at - frames[i].at) * SPEED);
  assert.ok(
    gaps.every((g) => g >= TIMINGS.gap * 0.8),
    `gaps ${gaps.map(Math.round)}`,
  );
});

test('nothing older leaves after an off: "on" then "off" at once ends at 0 for good', async (t) => {
  const { gladys, node, clock } = await setup(t);
  await set(gladys, 'u0-a4', 'binary', 1);
  const on = set(gladys, 'u0-a4', 'brightness', 80);
  const off = set(gladys, 'u0-a4', 'binary', 0);
  await Promise.all([on, off]);
  await clock.wait(2000);
  const frames = node.of(0);
  const first = frames.findIndex((f, i) => i > 0 && f.data[3] === 0);
  assert.ok(first > 0, 'the off left');
  for (const frame of frames.slice(first)) assert.equal(frame.data[3], 0);
});

test('refusals: unknown device, invalid value, feature not on the profile, fixture not listed', async (t) => {
  const { gladys, node } = await setup(t);
  const cases = [
    [
      { external_id: 'ext:other:fixture:u0-a1' },
      { external_id: 'ext:other:fixture:u0-a1:binary' },
      1,
      /not an Art-Net fixture/,
    ],
    [dev('u0-a1'), feat('u0-a1', 'binary'), 2, /Invalid value/],
    [dev('u0-a1'), feat('u0-a1', 'color'), null, /Invalid value/],
    [dev('u0-a1'), feat('u0-a1', 'color'), '', /Invalid value/],
    [dev('u0-a1'), feat('u0-a1', 'color'), true, /Invalid value/],
    [dev('u0-a1'), feat('u0-a1', 'temperature'), 200, /not exist on the profile/],
    [dev('u0-a20'), feat('u0-a20', 'binary'), 1, /not in the configuration/],
    [dev('u0-a20'), feat('u0-a20', 'binary'), 0, /not in the configuration/],
    [dev('u00-a1'), feat('u00-a1', 'binary'), 1, /not an Art-Net fixture/],
  ];
  for (const [d, f, v, message] of cases) {
    const ack = await gladys.fake.setValue(d, f, v);
    assert.equal(ack.success, false);
    assert.match(ack.error, message);
  }
  assert.equal(node.frames.length, 0);
});

test('after a restart, before the configuration is read: off and Blackout leave from /data, on is refused', async (t) => {
  const node = await startNode();
  const store = memoryStore({
    node: { host: '127.0.0.1', port: node.port },
    fixtures: [
      { universe: 0, address: 1, profile: 'rgb' },
      { universe: 3, address: 7, profile: 'dimmer' },
    ],
  });
  const { gladys, app } = await setup(t, {
    node,
    store,
    getConfig: () => Promise.reject(new Error('HTTP 503')),
  });
  assert.equal(app.configRead, false);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Configuration not read: tried again in 5 s/,
  );
  const on = await set(gladys, 'u0-a1', 'binary', 1);
  assert.equal(on.success, false);
  assert.match(on.error, /Configuration not read/);
  const off = await set(gladys, 'u0-a1', 'binary', 0);
  assert.equal(off.success, true, off.error);
  await frameIs(node, 0, [0, 0, 0, 0]);
  const blackout = await gladys.fake.action('blackout');
  assert.equal(blackout.success, true);
  assert.match(blackout.data.message.en, /2 universe\(s\) of 2/);
  await frameIs(node, 3, [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('getConfig failing in connected: tried again, spaced, until it reads', async (t) => {
  let fail = 2;
  let reads = 0;
  const { gladys, app } = await setup(t, {
    getConfig: () => {
      reads += 1;
      if (fail > 0) {
        fail -= 1;
        return Promise.reject(new Error('HTTP 500'));
      }
      return Promise.resolve({
        node_address: gladys.fake.config.node_address,
        fixtures: FIXTURES,
      });
    },
  });
  assert.equal(app.configRead, false);
  await until(() => app.configRead, 5000, 'config read after retries');
  assert.equal(reads, 3);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  // A reconnection reads it again (once).
  await app.connected(() => gladys.getConfig());
  assert.equal(reads, 4);
});

test('a frame that cannot leave: "on" is undone and says nothing was sent; "off" is kept and reaches Gladys later', async (t) => {
  const flaky = flakyOpen();
  const { gladys, node, app, clock } = await setup(t, { open: flaky.open });
  await set(gladys, 'u0-a4', 'binary', 1);
  flaky.failing = true;
  const on = await set(gladys, 'u0-a1', 'binary', 1);
  assert.equal(on.success, false);
  assert.match(on.error, /did not leave \(EHOSTUNREACH\): nothing sent/);
  await until(() => gladys.fake.connectionStatus.connected === false, 2000, 'status down');
  assert.match(gladys.fake.connectionStatus.message.en, /do not leave.*EHOSTUNREACH/);
  await until(
    () => gladys.fake.transports.slice(-4).every((b) => b.transport === 'unreachable'),
    2000,
    'badges',
  );
  const off = await set(gladys, 'u0-a4', 'binary', 0);
  assert.equal(off.success, false);
  assert.match(off.error, /Off not sent yet.*tried again every second/);
  assert.equal(app.offPending.has('u0-a4'), true);
  flaky.failing = false;
  const before = node.of(0).length;
  await until(() => node.of(0).length > before, 3000, 'keep-alive after the network came back');
  // The "on" that failed never leaves; the "off" does.
  await frameIs(node, 0, [0, 0, 0, 0], [0, 4]);
  await until(
    () => gladys.fake.lastState('ext:artnet:fixture:u0-a4:binary') === 0,
    2000,
    'off state',
  );
  await clock.wait(200);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('Blackout: every universe started or known at 0; scene action too; never refused for config', async (t) => {
  const { gladys, node } = await setup(t);
  await set(gladys, 'u0-a1', 'binary', 1);
  await set(gladys, 'u2-a1', 'binary', 1);
  const ack = await gladys.fake.action('blackout');
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /2 univers sur 2/);
  await frameZero(node, 0);
  await frameZero(node, 2);
  for (const id of ['u0-a1', 'u0-a4', 'u0-a10', 'u2-a1']) {
    assert.equal(gladys.fake.lastState(`ext:artnet:fixture:${id}:binary`), 0, id);
  }
  await set(gladys, 'u0-a1', 'binary', 1);
  const scene = await gladys.fake.sceneAction('blackout');
  assert.equal(scene.success, true);
  await frameZero(node, 0);
});

test('Blackout and off with no node known: refused, nothing sent', async (t) => {
  const { gladys, node } = await setup(t, { config: { node_address: '' } });
  assert.match(gladys.fake.connectionStatus.message.en, /Type the IP address/);
  const ack = await gladys.fake.action('blackout');
  assert.match(ack.data.message.en, /no node address known/);
  const off = await set(gladys, 'u0-a1', 'binary', 0);
  assert.equal(off.success, false);
  assert.match(off.error, /Node address not configured/);
  const scene = await gladys.fake.sceneAction('blackout');
  assert.equal(scene.success, false);
  assert.equal(node.frames.length, 0);
});

test('a broadcast node address is refused; the last valid node of /data still takes off', async (t) => {
  const node = await startNode();
  const store = memoryStore();
  const { gladys, app } = await setup(t, { node, store });
  await until(() => store.data?.node?.port === node.port, 2000, 'node kept in /data');
  await set(gladys, 'u0-a1', 'binary', 1);
  await gladys.fake.configUpdated({ node_address: '192.168.1.255', fixtures: FIXTURES });
  assert.match(gladys.fake.connectionStatus.message.en, /broadcast/);
  const on = await set(gladys, 'u0-a1', 'binary', 1);
  assert.match(on.error, /not configured/);
  const off = await set(gladys, 'u0-a1', 'binary', 0);
  assert.equal(off.success, true);
  await frameIs(node, 0, [0, 0, 0], [0, 3]);
  assert.equal(store.data.node.port, node.port);
  assert.equal(app.config.node, undefined);
});

test('a fixture removed from the configuration goes to 0; the frame never gets shorter', async (t) => {
  const { gladys, node } = await setup(t);
  await set(gladys, 'u0-a10', 'binary', 1);
  await until(() => node.last(0)?.data.length === 12, 2000, 'frame of 12 channels');
  await gladys.fake.configUpdated({
    node_address: gladys.fake.config.node_address,
    fixtures: '1 rgb Salon',
  });
  await set(gladys, 'u0-a1', 'binary', 1);
  await frameIs(node, 0, [255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('fixture entries in error: skipped, their position shown, never their text', async (t) => {
  const { gladys } = await setup(t, {
    config: { fixtures: '1 rgb A; 2 rgb Overlap; 600 dimmer X; 1 laser Y; 511 rgb Z; 5 dimmer B' },
  });
  const { message } = gladys.fake.connectionStatus;
  assert.match(message.en, /#2 \(overlaps.*#3 \(address.*#4 \(unknown profile.*#5 \(runs past/);
  assert.doesNotMatch(message.en, /laser|Overlap/);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['A', 'B'],
  );
});

test('Test the node: the ArtPollReply name, or no reply; never twice within 10 s', async (t) => {
  const node = await startNode({
    reply: pollReply({ shortName: 'Node\u00071', longName: 'Long name' }),
  });
  const { gladys } = await setup(t, { node });
  const ack = await gladys.fake.action('test_node');
  assert.match(ack.data.message.en, /answers: Node 1 - Long name/);
  assert.equal(node.polls, 1);
  const again = await gladys.fake.action('test_node');
  assert.match(again.data.message.en, /try again in/);
  assert.equal(node.polls, 1);
});

test('Test the node without a reply: said, and DMX still possible', async (t) => {
  const { gladys, node } = await setup(t);
  const ack = await gladys.fake.action('test_node');
  assert.match(ack.data.message.en, /No ArtPollReply/);
  assert.equal(node.polls, 1);
  assert.equal((await set(gladys, 'u0-a1', 'binary', 1)).success, true);
});

test('a reply from another address or a forged packet is ignored by the test', async (t) => {
  const { app } = await setup(t);
  let got;
  app.testWaiter = { host: '127.0.0.1', resolve: (r) => (got = r) };
  app.message(pollReply({ shortName: 'X' }), { address: '127.0.0.2' });
  app.message(Buffer.from('Art-Net\0junk'), { address: '127.0.0.1' });
  app.message(pollReply({ shortName: 'X', length: 100 }), { address: '127.0.0.1' });
  assert.equal(got, undefined);
  app.message(pollReply({ shortName: 'OK' }), { address: '127.0.0.1' });
  assert.equal(got.shortName, 'OK');
  app.testWaiter = undefined;
});

test('a scene on 5 fixtures of 5 universes sets them all', async (t) => {
  const { gladys, node } = await setup(t, {
    config: { fixtures: '0/1 dimmer A; 1/1 dimmer B; 2/1 dimmer C; 3/1 dimmer D; 4/1 dimmer E' },
  });
  const ids = ['u0-a1', 'u1-a1', 'u2-a1', 'u3-a1', 'u4-a1'];
  const acks = await Promise.all(ids.map((id) => set(gladys, id, 'brightness', 100)));
  assert.ok(acks.every((a) => a.success));
  for (const u of [0, 1, 2, 3, 4]) await frameIs(node, u, [255, 0]);
});

test('/data unreadable: read again every 10 s, never written over; then off leaves from it', async (t) => {
  const node = await startNode();
  const store = memoryStore({
    node: { host: '127.0.0.1', port: node.port },
    fixtures: [{ universe: 0, address: 1, profile: 'rgb' }],
  });
  store.unreadable = true;
  const { gladys, app } = await setup(t, {
    node,
    store,
    getConfig: () => Promise.reject(new Error('HTTP 503')),
  });
  assert.equal(app.storeFailed, true);
  const off = await set(gladys, 'u0-a1', 'binary', 0);
  assert.equal(off.success, false);
  assert.match(off.error, /Configuration not read/);
  assert.equal(store.saves, 0);
  store.unreadable = false;
  await until(() => app.memory !== undefined, 3000, 'store read again');
  assert.ok(store.loads >= 2);
  const again = await set(gladys, 'u0-a1', 'binary', 0);
  assert.equal(again.success, true, again.error);
});

test('/data not writable: said in the status, commands still work', async (t) => {
  const store = memoryStore();
  store.unwritable = true;
  const { gladys } = await setup(t, { store });
  await until(() => /not writable/.test(gladys.fake.connectionStatus.message.en), 2000, 'status');
  assert.equal((await set(gladys, 'u0-a1', 'binary', 1)).success, true);
});

test('stop: no frame, no timer after it', async (t) => {
  const { gladys, node, app, clock } = await setup(t);
  await set(gladys, 'u0-a1', 'binary', 1);
  await frameIs(node, 0, [255, 255, 255], [0, 3]);
  await app.stop();
  await clock.wait(100);
  const count = node.frames.length;
  await clock.wait(3000);
  assert.equal(node.frames.length, count);
  assert.equal(clock.live, 0);
  const off = await set(gladys, 'u0-a1', 'binary', 0);
  assert.equal(off.success, false);
});

test('the socket cannot open: on and off say nothing left; tried again by the next frame', async (t) => {
  const flaky = flakyOpen();
  flaky.openFails = true;
  const { gladys, node } = await setup(t, { open: flaky.open });
  const on = await set(gladys, 'u0-a1', 'binary', 1);
  assert.match(on.error, /did not leave \(socket\)/);
  const off = await set(gladys, 'u0-a4', 'binary', 0);
  assert.match(off.error, /Off not sent yet \(socket\)/);
  flaky.openFails = false;
  await until(() => node.of(0).length > 0, 3000, 'frame after the socket opened');
  await frameZero(node, 0);
});

test('reconnection: status and badges published again, nothing sent', async (t) => {
  const { gladys, app, node } = await setup(t);
  const statuses = gladys.fake.bodies('POST', '/connection_status').length;
  await app.connected(() => gladys.getConfig());
  assert.ok(gladys.fake.bodies('POST', '/connection_status').length > statuses);
  assert.equal(node.frames.length, 0);
});

/** A socket opener whose sends wait until the test answers them (error code or success). */
function heldOpen() {
  const control = { sends: [] };
  control.open = async () => ({
    port: 6454,
    socket: {
      send(packet, port, host, cb) {
        control.sends.push({
          frame: parseDmx(packet),
          answer: (code) => cb(code ? Object.assign(new Error(code), { code }) : null),
        });
      },
      on() {},
      close() {},
    },
  });
  return control;
}

test('a failed command falls back to the last state that left, or to the last off', async (t) => {
  const flaky = flakyOpen();
  const { gladys, node } = await setup(t, { open: flaky.open });
  assert.equal((await set(gladys, 'u0-a1', 'color', 0x112233)).success, true);
  await frameIs(node, 0, [0x11, 0x22, 0x33], [0, 3]);
  flaky.failing = true;
  const acks = await Promise.all([
    set(gladys, 'u0-a1', 'brightness', 50),
    set(gladys, 'u0-a1', 'color', 0xff0000),
  ]);
  assert.ok(acks.every((a) => a.success === false));
  flaky.failing = false;
  await clock2(node, 0);
  await frameIs(node, 0, [0x11, 0x22, 0x33], [0, 3]);
  flaky.failing = true;
  assert.equal((await set(gladys, 'u0-a1', 'binary', 0)).success, false);
  assert.equal((await set(gladys, 'u0-a1', 'brightness', 40)).success, false);
  flaky.failing = false;
  await clock2(node, 0);
  await frameIs(node, 0, [0, 0, 0], [0, 3]);
});

/** Waits for two more frames of a universe (the keep-alive after the network came back). */
async function clock2(node, universe) {
  const n = node.of(universe).length;
  await until(() => node.of(universe).length >= n + 2, 3000, 'two more frames');
}

test('an older failed command never undoes a newer one that left', async (t) => {
  const held = heldOpen();
  const { gladys } = await setup(t, { open: held.open });
  const older = set(gladys, 'u0-a1', 'color', 0xff0000);
  await until(() => held.sends.length === 1, 2000, 'first frame');
  const newer = set(gladys, 'u0-a1', 'color', 0x0000ff);
  await new Promise((resolve) => setTimeout(resolve, 20));
  held.sends[0].answer('EHOSTUNREACH');
  assert.equal((await older).success, false);
  await until(() => held.sends.length === 2, 2000, 'second frame');
  assert.deepEqual(held.sends[1].frame.data.slice(0, 3), [0, 0, 255]);
  held.sends[1].answer();
  assert.equal((await newer).success, true);
});

test('Blackout counts the universes already started, even with no fixture left', async (t) => {
  const { gladys, node } = await setup(t);
  await set(gladys, 'u2-a1', 'binary', 1);
  await gladys.fake.configUpdated({
    node_address: gladys.fake.config.node_address,
    fixtures: '1 rgb Salon',
  });
  const ack = await gladys.fake.action('blackout');
  assert.match(ack.data.message.en, /2 universe\(s\) of 2/);
  await frameZero(node, 2);
});

test('a frame that left before an off never makes that off fall back to "on"', async (t) => {
  const held = heldOpen();
  const { gladys } = await setup(t, { open: held.open });
  const answer = async (i, code) => {
    await until(() => held.sends.length > i, 2000, `frame ${i + 1}`);
    held.sends[i].answer(code);
  };
  const red = set(gladys, 'u0-a1', 'color', 0xff0000);
  await answer(0);
  assert.equal((await red).success, true);
  const dim = set(gladys, 'u0-a1', 'brightness', 50);
  await until(() => held.sends.length === 2, 2000, 'frame 2 in flight');
  const off = set(gladys, 'u0-a1', 'binary', 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await answer(1);
  assert.equal((await dim).success, true);
  await answer(2, 'EHOSTUNREACH');
  assert.equal((await off).success, false);
  const green = set(gladys, 'u0-a1', 'color', 0x00ff00);
  await answer(3, 'EHOSTUNREACH');
  assert.equal((await green).success, false);
  await until(() => held.sends.length > 4, 3000, 'keep-alive');
  assert.deepEqual(held.sends[4].frame.data.slice(0, 3), [0, 0, 0]);
});

test('port 6454 busy: the status says the frames leave from another port', async (t) => {
  const node = await startNode();
  const gladys = createFakeGladys({
    selector: 'artnet',
    config: { node_address: `127.0.0.1:${node.port}`, fixtures: '1 dimmer A' },
  });
  const clock = speedClock(SPEED);
  const app = new ArtnetApp({
    gladys,
    logger: quietLogger([]),
    store: memoryStore(),
    monotonic: clock.monotonic,
    timers: clock.timers,
    localPort: 6454,
    open: async () => ({
      socket: { send: (p, port, host, cb) => setImmediate(() => cb(null)), on() {}, close() {} },
      port: 50123,
    }),
  });
  registerHandlers(gladys, app, quietLogger([]));
  t.after(async () => {
    await app.stop();
    await node.halt();
  });
  await gladys.connect();
  await until(() => app.configRead, 3000, 'config');
  assert.equal((await set(gladys, 'u0-a1', 'binary', 1)).success, true);
  await until(
    () => /from port 50123/.test(gladys.fake.connectionStatus.message.en),
    2000,
    'status',
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
