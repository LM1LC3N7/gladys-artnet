// -----------------------------------------------------------------------------
// The configuration (node address, fixtures field) and the /data state,
// normalized: what a form or a hand-edited file may hold never reaches the
// rest of the code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig, parseAddress, parseFixtures } from '../src/config.js';
import { fixtureOf, parseExternalId, valueOf } from '../src/devices.js';
import { memoryOf, normalizeMemory } from '../src/store.js';

test('node address: one unicast IPv4, port 6454 by default; broadcast, multicast, any refused', () => {
  assert.deepEqual(parseAddress('192.168.1.60'), { address: { host: '192.168.1.60', port: 6454 } });
  assert.deepEqual(parseAddress(' http://10.0.0.7:6455/x '), {
    address: { host: '10.0.0.7', port: 6455 },
  });
  assert.deepEqual(parseAddress(''), {});
  for (const bad of [
    '192.168.1',
    '256.1.1.1',
    'node.local',
    '1.2.3.4:0',
    '1.2.3.4:70000',
    'a b',
    '1.2.3\r\n.4',
  ]) {
    assert.equal(parseAddress(bad).invalid, true, bad);
  }
  for (const broadcast of [
    '192.168.1.255',
    '2.255.255.255',
    '10.255.255.255',
    '239.255.0.1',
    '0.0.0.0',
    '192.168.1.0',
  ]) {
    assert.equal(parseAddress(broadcast).broadcast, true, broadcast);
  }
});

test('fixtures: entries read, universe 0 by default, profile case-insensitive', () => {
  const { fixtures, errors } = parseFixtures(
    ' 1 RGB  Living  room ;0/4 dimmer; 32767/510 cct End ;;',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(fixtures, [
    { universe: 0, address: 1, profile: 'rgb', name: 'Living room', id: 'u0-a1' },
    { universe: 0, address: 4, profile: 'dimmer', name: '', id: 'u0-a4' },
    { universe: 32767, address: 510, profile: 'cct', name: 'End', id: 'u32767-a510' },
  ]);
});

test('fixtures: each error has its reason and position; the others are kept', () => {
  const { fixtures, errors } = parseFixtures(
    [
      'rgb 1', // 1 syntax
      '32768/1 rgb', // 2 universe
      '0 rgb', // 3 address
      '513 dimmer', // 4 address
      '01 dimmer', // 5 address (leading zero)
      '1 laser', // 6 profile
      '510 rgbw', // 7 overflow
      `1 rgb ${'x'.repeat(41)}`, // 8 name
      '1 rgb Bad\u0007', // 9 name
      '1 rgb Ok', // kept
      '3 dimmer Overlap', // 11 overlap
      '-1 dimmer', // 12 syntax
      '1.5 dimmer', // 13 syntax
    ].join(';'),
  );
  assert.deepEqual(
    errors.map((e) => [e.index, e.reason]),
    [
      [1, 'syntax'],
      [2, 'universe'],
      [3, 'address'],
      [4, 'address'],
      [5, 'address'],
      [6, 'profile'],
      [7, 'overflow'],
      [8, 'name'],
      [9, 'name'],
      [11, 'overlap'],
      [12, 'syntax'],
      [13, 'syntax'],
    ],
  );
  assert.deepEqual(
    fixtures.map((f) => f.id),
    ['u0-a1'],
  );
});

test('fixtures: at most 64, at most 16 universes, at most 4000 characters', () => {
  const many = Array.from({ length: 70 }, (_, i) => `${i + 1} dimmer`).join(';');
  const a = parseFixtures(many);
  assert.equal(a.fixtures.length, 64);
  assert.deepEqual(
    a.errors.map((e) => e.reason),
    new Array(6).fill('tooMany'),
  );
  const universes = Array.from({ length: 17 }, (_, i) => `${i}/1 dimmer`).join(';');
  const b = parseFixtures(universes);
  assert.equal(b.fixtures.length, 16);
  assert.deepEqual(b.errors, [{ index: 17, reason: 'universes' }]);
  const c = parseFixtures(`1 dimmer ${'x'.repeat(4000)}`);
  assert.equal(c.tooLong, true);
  assert.deepEqual(c.fixtures, []);
  assert.deepEqual(parseFixtures(42), { fixtures: [], errors: [], tooLong: false });
});

test('normalizeConfig: defaults, unknown keys and wrong types ignored', () => {
  const c = normalizeConfig({ node_address: 42, fixtures: ['1 rgb'], language: 'de', other: 1 });
  assert.equal(c.node, undefined);
  assert.deepEqual(c.fixtures, []);
  assert.equal(c.language, 'fr');
  assert.equal(normalizeConfig({ language: 'en' }).language, 'en');
  assert.equal(normalizeConfig(null).node, undefined);
});

test('external ids: exact prefix, canonical numbers, known features only', () => {
  const gladys = createFakeGladys({ selector: 'artnet' });
  assert.deepEqual(parseExternalId(gladys, 'ext:artnet:fixture:u2-a10:color'), {
    id: 'u2-a10',
    universe: 2,
    address: 10,
    key: 'color',
  });
  for (const bad of [
    'ext:artnet:fixture:u2-a10:laser',
    'ext:artnet:fixture:u2-a10:color:x',
    'ext:artnetx:fixture:u2-a10',
    'ext:artnet:lamp:u2-a10',
    'ext:artnet:fixture:u02-a10',
    'ext:artnet:fixture:u2-a0',
    'ext:artnet:fixture:u2-a513',
    'ext:artnet:fixture:u32768-a1',
    `ext:artnet:fixture:u1-a1:${'x'.repeat(200)}`,
    42,
  ]) {
    assert.equal(parseExternalId(gladys, bad), undefined, String(bad));
  }
  assert.deepEqual(fixtureOf('u32767-a512'), { universe: 32767, address: 512 });
});

test('values: strict numbers in range', () => {
  assert.equal(valueOf('binary', 1), 1);
  assert.equal(valueOf('binary', '0'), 0);
  assert.equal(valueOf('binary', 0.5), undefined);
  assert.equal(valueOf('brightness', 49.6), 50);
  assert.equal(valueOf('brightness', 101), undefined);
  assert.equal(valueOf('brightness', ''), undefined);
  assert.equal(valueOf('brightness', null), undefined);
  assert.equal(valueOf('brightness', false), undefined);
  assert.equal(valueOf('color', 0xffffff), 0xffffff);
  assert.equal(valueOf('color', 1.5), undefined);
  assert.equal(valueOf('color', -1), undefined);
  assert.equal(valueOf('temperature', 152), undefined);
  assert.equal(valueOf('temperature', '370'), 370);
  assert.equal(valueOf('laser', 1), undefined);
});

test('/data: repaired with the rules of the configuration, names never written', () => {
  const memory = normalizeMemory({
    node: { host: '192.168.1.60', port: 6454 },
    fixtures: [
      { universe: 0, address: 1, profile: 'rgb' },
      { universe: 0, address: 2, profile: 'dimmer' }, // overlap
      { universe: 0, address: 511, profile: 'rgb' }, // overflow
      { universe: -1, address: 1, profile: 'rgb' },
      { universe: 0, address: 20, profile: '__proto__' },
      'junk',
    ],
  });
  assert.deepEqual(memory.node, { host: '192.168.1.60', port: 6454 });
  assert.deepEqual(
    memory.fixtures.map((f) => f.id),
    ['u0-a1'],
  );
  for (const node of [
    { host: '192.168.1.255', port: 6454 },
    { host: '192.168.1.60', port: '6454' },
    { host: '192.168.1.60:1', port: 6454 },
    { host: 'x', port: 1 },
  ]) {
    assert.equal(normalizeMemory({ node }).node, undefined, JSON.stringify(node));
  }
  assert.deepEqual(normalizeMemory(null), { node: undefined, fixtures: [] });
  const written = memoryOf({ host: '1.2.3.4', port: 6454 }, [
    { universe: 0, address: 1, profile: 'rgb', name: 'Bedroom', id: 'u0-a1' },
  ]);
  assert.deepEqual(written, {
    node: { host: '1.2.3.4', port: 6454 },
    fixtures: [{ universe: 0, address: 1, profile: 'rgb' }],
  });
});
