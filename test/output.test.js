// -----------------------------------------------------------------------------
// The Output alone, on a manual clock (timers fire only when the test moves
// the clock; each read of it moves 1 µs) and a fake socket whose send callback
// the test holds: the 25 ms gap, a change during a frame in flight, the
// keep-alive, a new node, nothing after close.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { Output } from '../src/output.js';
import { parseDmx } from '../src/protocol.js';

function manualClock() {
  let now = 1000;
  let id = 0;
  const pending = new Map();
  const clock = {
    monotonic: () => (now += 0.001),
    timers: {
      setTimeout: (fn, ms) => {
        id += 1;
        pending.set(id, { at: now + Math.max(0, ms), fn });
        return id;
      },
      clearTimeout: (handle) => pending.delete(handle),
    },
    get pending() {
      return pending.size;
    },
    /** Moves the clock, firing the due timers in order (one event-loop turn between two). */
    async advance(ms) {
      const end = now + ms;
      const turns = async () => {
        for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
      };
      await turns();
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
        await turns();
      }
      now = end;
      await turns();
    },
  };
  return clock;
}

function fakeSocket(clock) {
  const socket = {
    sent: [],
    hold: false,
    held: [],
    closed: false,
    send(packet, port, host, cb) {
      socket.sent.push({ at: clock.monotonic(), host, port, frame: parseDmx(packet) });
      if (socket.hold) socket.held.push(cb);
      else setImmediate(() => cb(null));
    },
    release() {
      for (const cb of socket.held.splice(0)) cb(null);
    },
    on() {},
    close() {
      socket.closed = true;
    },
  };
  return socket;
}

function setup() {
  const clock = manualClock();
  const socket = fakeSocket(clock);
  const state = { value: 0 };
  const output = new Output({
    open: async () => ({ socket, port: 6454 }),
    timers: clock.timers,
    monotonic: clock.monotonic,
    frameOf: () => [state.value, 0],
  });
  output.setNode({ host: '192.168.1.60', port: 6454 });
  return { clock, socket, state, output };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a burst of changes: one frame at once, the next 25 ms later with the latest value', async () => {
  const { clock, socket, state, output } = setup();
  state.value = 1;
  const first = output.touch(0).promise;
  await clock.advance(0);
  assert.deepEqual(await first, { sent: true });
  assert.equal(socket.sent.length, 1);
  const waits = [];
  for (let v = 2; v <= 10; v += 1) {
    state.value = v;
    waits.push(output.touch(0).promise);
  }
  await clock.advance(TIMINGS.gap - 1);
  assert.equal(socket.sent.length, 1, 'never before the gap');
  await clock.advance(2);
  await Promise.all(waits);
  assert.equal(socket.sent.length, 2);
  assert.deepEqual(socket.sent[1].frame.data, [10, 0]);
  assert.ok(socket.sent[1].at - socket.sent[0].at >= TIMINGS.gap);
  assert.deepEqual(
    socket.sent.map((s) => s.frame.sequence),
    [1, 2],
  );
});

test('a change while a frame is in flight leaves right after it, never lost', async () => {
  const { clock, socket, state, output } = setup();
  socket.hold = true;
  state.value = 1;
  output.touch(0);
  await clock.advance(0);
  assert.equal(socket.sent.length, 1);
  state.value = 2;
  const second = output.touch(0).promise;
  await clock.advance(100);
  assert.equal(socket.sent.length, 1, 'one frame in flight per universe');
  socket.hold = false;
  socket.release();
  await flush();
  await clock.advance(TIMINGS.gap);
  assert.deepEqual(await second, { sent: true });
  assert.equal(socket.sent.length, 2);
  assert.deepEqual(socket.sent[1].frame.data, [2, 0]);
});

test('keep-alive every 900 ms; the sequence wraps from 255 to 1', async () => {
  const { clock, socket, output } = setup();
  output.touch(0);
  await clock.advance(0);
  await clock.advance(TIMINGS.refresh - 1);
  assert.equal(socket.sent.length, 1);
  await clock.advance(2);
  assert.equal(socket.sent.length, 2);
  await clock.advance(TIMINGS.refresh * 300);
  const sequences = socket.sent.map((s) => s.frame.sequence);
  const wrap = sequences.indexOf(255);
  assert.ok(wrap > 0);
  assert.equal(sequences[wrap + 1], 1);
  assert.ok(!sequences.includes(0));
});

test('a new node gets every started universe at once', async () => {
  const { clock, socket, output } = setup();
  output.touch(0);
  output.touch(7);
  await clock.advance(0);
  assert.equal(socket.sent.length, 2);
  await clock.advance(100);
  output.setNode({ host: '192.168.1.61', port: 6454 });
  await clock.advance(TIMINGS.gap);
  const moved = socket.sent.slice(2);
  assert.deepEqual(moved.map((s) => [s.host, s.frame.universe]).sort(), [
    ['192.168.1.61', 0],
    ['192.168.1.61', 7],
  ]);
  // The same node again changes nothing.
  output.setNode({ host: '192.168.1.61', port: 6454 });
  await clock.advance(TIMINGS.gap);
  assert.equal(socket.sent.length, 4);
});

test('no node: refused at once; node removed: the keep-alive stops', async () => {
  const { clock, socket, output } = setup();
  output.touch(0);
  await clock.advance(0);
  output.setNode(undefined);
  assert.deepEqual(await output.touch(1).promise, { sent: false, error: 'noNode' });
  await clock.advance(TIMINGS.refresh * 3);
  assert.equal(socket.sent.length, 1);
});

test('close: waiters answered, no frame and no timer after it, even for a frame in flight', async () => {
  const { clock, socket, output } = setup();
  socket.hold = true;
  output.touch(0);
  await clock.advance(0);
  const waiting = output.touch(0).promise;
  output.close();
  assert.deepEqual(await waiting, { sent: false, error: 'closed' });
  socket.hold = false;
  socket.release();
  await flush();
  await clock.advance(0);
  assert.equal(clock.pending, 0, 'no timer set by the frame that ended after close');
  await clock.advance(TIMINGS.refresh * 5);
  assert.equal(socket.sent.length, 1);
  assert.equal(clock.pending, 0);
  assert.equal(socket.closed, true);
  assert.deepEqual(await output.touch(0).promise, { sent: false, error: 'closed' });
});

test('close during a frame in flight with no change waiting: no keep-alive set, no result reported', async () => {
  const clock = manualClock();
  const socket = fakeSocket(clock);
  const results = [];
  const output = new Output({
    open: async () => ({ socket, port: 6454 }),
    timers: clock.timers,
    monotonic: clock.monotonic,
    frameOf: () => [1, 0],
    onResult: (universe, result) => results.push(result),
  });
  output.setNode({ host: '192.168.1.60', port: 6454 });
  socket.hold = true;
  const first = output.touch(0).promise;
  await clock.advance(0);
  output.close();
  socket.release();
  assert.deepEqual(await first, { sent: true });
  await clock.advance(0);
  assert.equal(clock.pending, 0);
  assert.deepEqual(results, []);
});
