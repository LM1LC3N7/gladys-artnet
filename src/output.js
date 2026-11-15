// -----------------------------------------------------------------------------
// The UDP side: one socket (bound to port 6454 when free, as Art-Net asks,
// else to any port), the ArtDmx frames of each universe, and the ArtPoll of
// the "Test the node" button.
//
// A universe starts being sent at the first command, "off" or Blackout that
// touches it, then its frame (the whole universe as the app sees it NOW:
// `frameOf(universe)` is called right before each send) is:
//   - sent again within 25 ms after a change (40 frames a second at most,
//     changes in between are merged: the rate is bounded, the latest state
//     always wins, nothing older can leave after a newer frame);
//   - sent again every 900 ms without change (the Art-Net keep-alive), until
//     the integration stops. A frame that could not leave is tried again by
//     this keep-alive, so an "off" never needs a queue of its own.
// One frame in flight per universe. A waiter (`touch()`) is answered by the
// first frame computed after it: `{ sent: true }` once the datagram left the
// socket, `{ sent: false, error }` when it did not.
// -----------------------------------------------------------------------------

import { createSocket } from 'node:dgram';
import { ARTNET_PORT, LIMITS, TIMINGS } from './constants.js';
import { artDmx } from './protocol.js';

/** Opens a UDP socket bound to `port`, else (busy, refused) to any free port. */
export function openUdp({ port = ARTNET_PORT } = {}) {
  const bind = (wanted) =>
    new Promise((resolve, reject) => {
      const socket = createSocket({ type: 'udp4', reuseAddr: false });
      const fail = (err) => {
        socket.close();
        reject(err);
      };
      socket.once('error', fail);
      socket.bind(wanted, () => {
        socket.off('error', fail);
        resolve({ socket, port: socket.address().port });
      });
    });
  return bind(port).catch((err) => {
    if (port === 0) throw err;
    return bind(0);
  });
}

const codeOf = (err) => (/^[A-Z][A-Z0-9_]{1,30}$/.test(err?.code ?? '') ? err.code : 'ERROR');

export class Output {
  constructor({
    open = openUdp,
    localPort = ARTNET_PORT,
    timers = globalThis,
    monotonic = () => performance.now(),
    timings = TIMINGS,
    frameOf,
    onResult = () => {},
    onMessage = () => {},
  }) {
    this.open = open;
    this.localPort = localPort;
    this.timers = timers;
    this.monotonic = monotonic;
    this.timings = timings;
    this.frameOf = frameOf;
    this.onResult = onResult;
    this.onMessage = onMessage;
    this.node = undefined;
    this.socketHandle = undefined;
    this.opening = undefined;
    this.boundPort = undefined;
    this.closed = false;
    /** universe -> { seq, lastSentAt, timer, inFlight, dirty, waiters } */
    this.universes = new Map();
  }

  /** The node the frames go to (undefined: nothing is sent). A new node gets every universe at once. */
  setNode(node) {
    const before = this.node ? `${this.node.host}:${this.node.port}` : '';
    const after = node ? `${node.host}:${node.port}` : '';
    this.node = node ? { host: node.host, port: node.port } : undefined;
    if (before === after || !this.node) return;
    for (const [universe, u] of this.universes) {
      u.dirty = true;
      this.schedule(universe, u);
    }
  }

  /** Marks a universe changed: `{ promise, waiter }`, the promise answered by the next frame. */
  touch(universe) {
    const waiter = { issued: false };
    if (this.closed) return { promise: Promise.resolve({ sent: false, error: 'closed' }), waiter };
    if (!this.node) return { promise: Promise.resolve({ sent: false, error: 'noNode' }), waiter };
    let u = this.universes.get(universe);
    if (!u) {
      if (this.universes.size >= LIMITS.universes * 2) {
        return { promise: Promise.resolve({ sent: false, error: 'universes' }), waiter };
      }
      u = { seq: 0, lastSentAt: -Infinity, timer: undefined, inFlight: false, dirty: false };
      u.waiters = [];
      this.universes.set(universe, u);
    }
    const promise = new Promise((resolve) => {
      waiter.resolve = resolve;
    });
    u.waiters.push(waiter);
    u.dirty = true;
    this.schedule(universe, u);
    return { promise, waiter };
  }

  /** The next frame of a universe: within the gap after the previous one. */
  schedule(universe, u) {
    if (this.closed || u.inFlight) return;
    if (u.timer !== undefined) this.timers.clearTimeout(u.timer);
    const wait = Math.max(0, u.lastSentAt + this.timings.gap - this.monotonic());
    u.timer = this.timers.setTimeout(() => {
      u.timer = undefined;
      this.sendFrame(universe, u);
    }, wait);
  }

  async socket() {
    if (this.socketHandle) return this.socketHandle;
    if (!this.opening) {
      this.opening = (async () => {
        try {
          const { socket, port } = await this.open({ port: this.localPort });
          if (this.closed) {
            socket.close();
            throw Object.assign(new Error('closed'), { code: 'CLOSED' });
          }
          socket.on('error', () => {
            if (this.socketHandle === socket) this.socketHandle = undefined;
            try {
              socket.close();
            } catch {
              // already closed
            }
          });
          socket.on('message', (message, remote) => {
            if (message.length > LIMITS.datagram) return;
            this.onMessage(message, remote);
          });
          this.socketHandle = socket;
          this.boundPort = port;
          return socket;
        } finally {
          this.opening = undefined;
        }
      })();
    }
    return this.opening;
  }

  /** Sends one datagram to the node: `{ sent: true }` or `{ sent: false, error }`. */
  async sendTo(node, packet) {
    let socket;
    try {
      socket = await this.socket();
    } catch (err) {
      return { sent: false, error: err?.code === 'CLOSED' ? 'closed' : 'socket' };
    }
    return new Promise((resolve) => {
      try {
        socket.send(packet, node.port, node.host, (err) =>
          resolve(err ? { sent: false, error: codeOf(err) } : { sent: true }),
        );
      } catch (err) {
        resolve({ sent: false, error: codeOf(err) });
      }
    });
  }

  async sendFrame(universe, u) {
    if (this.closed || u.inFlight) return;
    u.inFlight = true;
    u.dirty = false;
    const waiters = u.waiters.splice(0);
    for (const w of waiters) w.issued = true;
    const node = this.node;
    let result;
    if (!node) {
      result = { sent: false, error: 'noNode' };
    } else {
      u.seq = (u.seq % 255) + 1;
      const packet = artDmx({ universe, sequence: u.seq, data: this.frameOf(universe) });
      result = packet ? await this.sendTo(node, packet) : { sent: false, error: 'frame' };
    }
    u.lastSentAt = this.monotonic();
    u.inFlight = false;
    if (this.closed) result = result.sent ? result : { sent: false, error: 'closed' };
    for (const w of waiters) w.resolve(result);
    if (this.closed) return;
    this.onResult(universe, result);
    if (!this.node) return;
    if (u.dirty) {
      this.schedule(universe, u);
      return;
    }
    u.timer = this.timers.setTimeout(() => {
      u.timer = undefined;
      this.sendFrame(universe, u);
    }, this.timings.refresh);
  }

  /** The universes started in this session. */
  active() {
    return [...this.universes.keys()];
  }

  close() {
    this.closed = true;
    for (const u of this.universes.values()) {
      if (u.timer !== undefined) this.timers.clearTimeout(u.timer);
      u.timer = undefined;
      for (const w of u.waiters.splice(0)) w.resolve({ sent: false, error: 'closed' });
    }
    const socket = this.socketHandle;
    this.socketHandle = undefined;
    try {
      socket?.close();
    } catch {
      // already closed
    }
  }
}
