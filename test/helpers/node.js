// -----------------------------------------------------------------------------
// A simulated Art-Net node on 127.0.0.1 (a real UDP socket, never the
// network): records every ArtDmx frame (universe, sequence, channels, time),
// answers an ArtPoll with an ArtPollReply when asked to. Also: a sped-up real
// clock, `until`, a socket opener that fails on demand.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { setTimeout as sleep } from 'node:timers/promises';
import { OPCODES } from '../../src/constants.js';
import { opcodeOf, parseDmx } from '../../src/protocol.js';
import { openUdp } from '../../src/output.js';

/** An ArtPollReply (239 bytes by default). */
export function pollReply({
  ip = [127, 0, 0, 1],
  shortName = '',
  longName = '',
  length = 239,
} = {}) {
  const packet = Buffer.alloc(length);
  packet.write('Art-Net\0', 0, 'latin1');
  packet.writeUInt16LE(OPCODES.POLL_REPLY, 8);
  ip.forEach((b, i) => (packet[10 + i] = b));
  packet.writeUInt16LE(6454, 14);
  Buffer.from(shortName, 'latin1').copy(packet, 26, 0, 18);
  Buffer.from(longName, 'latin1').copy(packet, 44, 0, 64);
  return packet;
}

export async function startNode({ reply } = {}) {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const node = {
    port: socket.address().port,
    frames: [],
    polls: 0,
    other: 0,
    reply,
    /** Frames of a universe. */
    of(universe) {
      return this.frames.filter((f) => f.universe === universe);
    },
    /** The last frame of a universe. */
    last(universe) {
      return this.of(universe).at(-1);
    },
    async halt() {
      await new Promise((resolve) => socket.close(resolve));
    },
  };
  socket.on('message', (message, remote) => {
    const op = opcodeOf(message);
    if (op === OPCODES.DMX) {
      const frame = parseDmx(message);
      if (frame) node.frames.push({ ...frame, at: performance.now() });
      else node.other += 1;
    } else if (op === OPCODES.POLL) {
      node.polls += 1;
      if (node.reply) socket.send(node.reply, remote.port, remote.address);
    } else {
      node.other += 1;
    }
  });
  return node;
}

/** A socket opener whose sends fail while `failing` is true (EHOSTUNREACH), or whose open fails. */
export function flakyOpen() {
  const control = { failing: false, openFails: false, opens: 0 };
  control.open = async (options) => {
    control.opens += 1;
    if (control.openFails) throw Object.assign(new Error('bind'), { code: 'EACCES' });
    const opened = await openUdp(options);
    const send = opened.socket.send.bind(opened.socket);
    opened.socket.send = (packet, port, host, cb) => {
      if (control.failing) {
        setImmediate(() => cb(Object.assign(new Error('unreachable'), { code: 'EHOSTUNREACH' })));
        return;
      }
      send(packet, port, host, cb);
    };
    return opened;
  };
  return control;
}

export function speedClock(speed = 10) {
  let drift = 0;
  const origin = performance.now();
  let set = 0;
  const live = new Set();
  const timers = {
    setTimeout: (fn, ms) => {
      set += 1;
      const handle = setTimeout(
        () => {
          live.delete(handle);
          fn();
        },
        Math.max(0, Number(ms) || 0) / speed,
      );
      live.add(handle);
      return handle;
    },
    clearTimeout: (handle) => {
      live.delete(handle);
      clearTimeout(handle);
    },
  };
  return {
    speed,
    timers,
    get set() {
      return set;
    },
    get live() {
      return live.size;
    },
    /** Moves at every read (a decision reading it twice sees it move). */
    monotonic: () => (performance.now() - origin) * speed + 1_000_000 + (drift += 0.001),
    /** Waits `ms` of the sped-up clock. */
    wait: (ms) => sleep(ms / speed),
  };
}

export const until = async (check, ms = 3000, what = 'condition') => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(2);
  }
};
