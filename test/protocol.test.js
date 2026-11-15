// -----------------------------------------------------------------------------
// Art-Net packets against the specification (Art-Net 4, revision 1.4dp), the
// profiles (channel values of a state), byte by byte.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelsOf, DEFAULT_STATE, PROFILES } from '../src/profiles.js';
import { artDmx, artPoll, opcodeOf, parseDmx, parsePollReply } from '../src/protocol.js';
import { pollReply } from './helpers/node.js';

test('ArtDmx: header, Port-Address split in SubUni and Net, length high byte first', () => {
  const data = new Uint8Array(512).fill(7);
  data[0] = 255;
  const packet = artDmx({ universe: 0x1234, sequence: 9, data });
  assert.equal(packet.length, 18 + 512);
  assert.deepEqual(
    [...packet.subarray(0, 18)],
    [
      0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00, 0x00, 0x50, 0, 14, 9, 0, 0x34, 0x12, 0x02,
      0x00,
    ],
  );
  assert.equal(packet[18], 255);
  assert.equal(packet[18 + 511], 7);
  assert.deepEqual(parseDmx(packet), { universe: 0x1234, sequence: 9, data: [...data] });
  // The top Port-Address: Net 0x7f, SubUni 0xff.
  const top = artDmx({ universe: 32767, sequence: 1, data: [0, 0] });
  assert.deepEqual([top[14], top[15], top[16], top[17]], [0xff, 0x7f, 0, 2]);
});

test('ArtDmx refuses what the specification refuses', () => {
  for (const bad of [
    { universe: -1, sequence: 1, data: [0, 0] },
    { universe: 32768, sequence: 1, data: [0, 0] },
    { universe: 1.5, sequence: 1, data: [0, 0] },
    { universe: 0, sequence: 256, data: [0, 0] },
    { universe: 0, sequence: 1, data: [0] },
    { universe: 0, sequence: 1, data: [0, 0, 0] },
    { universe: 0, sequence: 1, data: new Uint8Array(514) },
  ]) {
    assert.equal(artDmx(bad), undefined, JSON.stringify({ ...bad, data: bad.data.length }));
  }
});

test('ArtPoll: 14 bytes, OpPoll, protocol 14, flags 0', () => {
  assert.deepEqual(
    [...artPoll()],
    [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00, 0x00, 0x20, 0, 14, 0, 0],
  );
});

test('ArtPollReply: names in printable ASCII, bounded; short, long or foreign packets refused', () => {
  const reply = parsePollReply(
    pollReply({ ip: [192, 168, 1, 60], shortName: 'Node\u0000hidden', longName: 'A\u0007BéC' }),
  );
  assert.deepEqual(reply, { ip: '192.168.1.60', shortName: 'Node', longName: 'A B C' });
  assert.equal(parsePollReply(pollReply({ length: 206 })), undefined);
  assert.ok(parsePollReply(pollReply({ length: 207 })));
  assert.equal(parsePollReply(pollReply({ length: 1025 })), undefined);
  assert.equal(parsePollReply(artPoll()), undefined);
  const forged = pollReply();
  forged[0] = 0x61;
  assert.equal(parsePollReply(forged), undefined);
  assert.equal(opcodeOf(Buffer.from('Art-Net')), undefined);
  assert.equal(opcodeOf('Art-Net\0\0\x50'), undefined);
});

test('parseDmx refuses a length that does not match the packet', () => {
  const packet = artDmx({ universe: 1, sequence: 1, data: [1, 2, 3, 4] });
  assert.equal(parseDmx(packet.subarray(0, 20)), undefined);
  packet[17] = 3;
  assert.equal(parseDmx(packet), undefined);
});

test('profiles: off is every channel at 0; on follows brightness, colour and temperature', () => {
  const on = (extra) => ({ ...DEFAULT_STATE, on: true, ...extra });
  for (const [profile, spec] of Object.entries(PROFILES)) {
    assert.deepEqual(
      channelsOf(profile, { ...on({}), on: false }),
      new Array(spec.channels).fill(0),
    );
    assert.equal(channelsOf(profile, on({})).length, spec.channels, profile);
  }
  assert.deepEqual(channelsOf('dimmer', on({ brightness: 1 })), [3]);
  assert.deepEqual(channelsOf('dimmer', on({ brightness: 100 })), [255]);
  assert.deepEqual(channelsOf('rgb', on({ color: 0xff8000, brightness: 50 })), [128, 64, 0]);
  assert.deepEqual(channelsOf('rgbw', on({ color: 0xffffff })), [0, 0, 0, 255]);
  assert.deepEqual(channelsOf('rgbw', on({ color: 0xff4020 })), [223, 32, 0, 32]);
  assert.deepEqual(channelsOf('drgb', on({ color: 0x102030, brightness: 40 })), [102, 16, 32, 48]);
  assert.deepEqual(channelsOf('drgbw', on({ color: 0x808080 })), [255, 0, 0, 0, 128]);
  assert.deepEqual(channelsOf('cct', on({ mired: 153 })), [255, 0]);
  assert.deepEqual(channelsOf('cct', on({ mired: 370 })), [0, 255]);
  assert.deepEqual(channelsOf('cct', on({ mired: 261.5, brightness: 50 })), [128, 128]);
  // Out-of-range values are clamped, never above 255.
  assert.deepEqual(channelsOf('cct', on({ mired: 9999 })), [0, 255]);
  assert.deepEqual(channelsOf('dimmer', on({ brightness: 400 })), [255]);
  assert.deepEqual(channelsOf('laser', on({})), []);
});

test('timings within Art-Net and Gladys bounds: keep-alive 800-1000 ms, at most 44 frames/s, answer under 5 s', async () => {
  const { TIMINGS } = await import('../src/constants.js');
  assert.ok(TIMINGS.refresh >= 800 && TIMINGS.refresh <= 1000, `refresh ${TIMINGS.refresh}`);
  assert.ok(TIMINGS.gap >= 1000 / 44, `gap ${TIMINGS.gap}`);
  assert.ok(TIMINGS.ackBudget < 5000 && TIMINGS.ackBudget >= 1000, `budget ${TIMINGS.ackBudget}`);
  assert.ok(TIMINGS.storeWait < TIMINGS.ackBudget);
});
