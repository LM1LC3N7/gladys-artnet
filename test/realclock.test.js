// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, setTimeout, time sped up)
// and a real local UDP socket playing the node: the keep-alive really leaves
// every 900 ms (never sooner, never a cycle late), a change leaves within the
// 25 ms gap, and an "off" clicked between two keep-alives leaves at once.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ArtnetApp } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { speedClock, startNode, until } from './helpers/node.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

async function start(t, speed) {
  const node = await startNode();
  const gladys = createFakeGladys({
    selector: 'artnet',
    config: { node_address: `127.0.0.1:${node.port}`, fixtures: '0/1 dimmer A; 0/2 dimmer B' },
  });
  const clock = speedClock(speed);
  const app = new ArtnetApp({
    gladys,
    logger: quiet,
    store: memoryStore(),
    monotonic: clock.monotonic,
    timers: clock.timers,
    localPort: 0,
  });
  registerHandlers(gladys, app, quiet);
  t.after(async () => {
    await app.stop();
    await node.halt();
  });
  await gladys.connect();
  await until(() => app.configRead, 3000, 'config');
  return { node, clock, gladys, app };
}

const click = (gladys, id, value) =>
  gladys.fake.setValue(
    { external_id: `ext:artnet:fixture:${id}` },
    { external_id: `ext:artnet:fixture:${id}:binary` },
    value,
  );

test('real clock: the keep-alive leaves every 900 ms', async (t) => {
  const speed = 20;
  const { node, clock, gladys } = await start(t, speed);
  assert.equal((await click(gladys, 'u0-a1', 1)).success, true);
  await until(() => node.of(0).length >= 6, (6 * TIMINGS.refresh * 1.5) / speed + 2000, 'frames');
  const frames = node.of(0).slice(1, 6);
  const gaps = frames.slice(1).map((f, i) => Math.round((f.at - frames[i].at) * clock.speed));
  for (const gap of gaps) {
    assert.ok(gap >= 0.9 * TIMINGS.refresh && gap <= 1.5 * TIMINGS.refresh, `gaps ${gaps}`);
  }
});

test('real clock: an off between two keep-alives leaves at once, never before the gap', async (t) => {
  const speed = 5;
  const { node, clock, gladys } = await start(t, speed);
  await click(gladys, 'u0-a1', 1);
  await click(gladys, 'u0-a2', 1);
  await until(() => node.last(0)?.data[1] === 255, 2000, 'on');
  await clock.wait(400);
  const before = node.of(0).length;
  const clicked = performance.now();
  assert.equal((await click(gladys, 'u0-a1', 0)).success, true);
  await until(() => node.of(0).length > before, 2000, 'off frame');
  const frame = node.of(0)[before];
  assert.deepEqual(frame.data, [0, 255]);
  const delay = (frame.at - clicked) * speed;
  assert.ok(delay < 200, `off left after ${Math.round(delay)} ms of the sped-up clock`);
  // Two changes in a row: the second waits the gap after the first.
  const n = node.of(0).length;
  await Promise.all([click(gladys, 'u0-a2', 0), click(gladys, 'u0-a1', 1)]);
  await until(() => node.of(0).length >= n + 1 && node.last(0).data[0] === 255, 2000, 'frames');
  const fresh = node.of(0).slice(n);
  for (let i = 1; i < fresh.length; i += 1) {
    const gap = (fresh[i].at - fresh[i - 1].at) * speed;
    assert.ok(gap >= TIMINGS.gap * 0.8, `gap ${Math.round(gap)}`);
  }
});

test('real clock, sender side: never two frames of a universe within 25 ms', async (t) => {
  const { Output } = await import('../src/output.js');
  const times = [];
  const socket = {
    send: (p, port, host, cb) => {
      times.push(performance.now());
      setImmediate(() => cb(null));
    },
    on() {},
    close() {},
  };
  let value = 0;
  const output = new Output({
    open: async () => ({ socket, port: 6454 }),
    frameOf: () => [value & 0xff, 0],
  });
  t.after(() => output.close());
  output.setNode({ host: '192.168.1.60', port: 6454 });
  const end = performance.now() + 600;
  while (performance.now() < end) {
    value += 1;
    output.touch(0);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const gaps = times.slice(1).map((at, i) => at - times[i]);
  assert.ok(times.length >= 15, `${times.length} frames`);
  assert.ok(Math.min(...gaps) >= TIMINGS.gap, `min gap ${Math.min(...gaps).toFixed(2)} ms`);
});
