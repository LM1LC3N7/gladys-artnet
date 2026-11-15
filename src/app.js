// -----------------------------------------------------------------------------
// The integration: one Art-Net node (its address in the configuration), the
// fixtures typed by the user as Gladys lights, the badges, the "Test the
// node" and "Blackout" buttons, the Blackout scene action and the commands.
// index.js only wires the SDK handlers to it.
//
// Art-Net sends DMX one way: no state is ever read. The app keeps the assumed
// state of each fixture (on, brightness, colour, temperature) and builds the
// frame of a universe from it right before each send (src/output.js). Gladys
// saves the value of each command that succeeds (features `has_feedback:
// false`) and the badge of each fixture says the state is assumed. After a
// restart every fixture is assumed off: the first frame of a universe sets
// its fixtures not commanded yet to 0 (and says so to Gladys).
//
// "Off" (binary 0 or brightness 0) and Blackout are the protective commands.
// They depend on no option, no configuration read (the node and the fixtures
// are also kept in /data), no rate limit beyond the 25 ms between two frames:
// the state becomes "off" at once, the next frame carries it, and the
// keep-alive sends it again every 900 ms; a frame that could not leave is
// tried again by that keep-alive, never dropped. Their only refusals: no node
// address known, or a fixture known neither by the configuration nor by /data.
//
// The other commands (on, brightness, colour, temperature) need the
// configuration read, the node address valid and the fixture listed with a
// profile that has the feature. They are answered within 3.4 s (Gladys stops
// waiting at 5 s): success once the frame left the socket; when it could not
// leave, the change is undone (unless a newer command replaced it) and the
// answer says nothing was sent.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { ARTNET_PORT, FEATURES, LIMITS, OPCODES, TIMINGS } from './constants.js';
import { buildFixture, fixtureIds, parseExternalId, valueOf } from './devices.js';
import { ERRORS, T, join } from './i18n.js';
import { Output, openUdp } from './output.js';
import { PROFILES, DEFAULT_STATE, channelsOf } from './profiles.js';
import { artPoll, opcodeOf, parsePollReply } from './protocol.js';
import { fileStore, memoryOf, normalizeMemory } from './store.js';

const commandError = (message) => new Error(message);

export class ArtnetApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'artnet' }),
    store = fileStore(),
    monotonic = () => performance.now(),
    timers = globalThis,
    open = openUdp,
    localPort = ARTNET_PORT,
    timings = TIMINGS,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.monotonic = monotonic;
    this.timers = timers;
    this.timings = timings;
    this.localPort = localPort;
    this.config = normalizeConfig();
    this.configRead = false;
    this.configTimer = undefined;
    this.configDelay = timings.configRetryMin;
    this.configError = undefined;
    this.generation = 0;
    this.stopped = false;
    /** undefined: not read yet; then `{ node, fixtures }`. */
    this.memory = undefined;
    this.storeFailed = false;
    this.storeUnwritable = false;
    this.loading = undefined;
    this.storeTimer = undefined;
    /** fixture id -> assumed state `{ on, brightness, color, mired, version }`. */
    this.states = new Map();
    /** Commands numbered at their arrival. */
    this.seq = 0;
    /** universe -> length of its frame (never shorter within a session). */
    this.lengths = new Map();
    /** universe -> error code of its last frame (absent: the last one left). */
    this.sendErrors = new Map();
    /** fixture ids whose "off" did not reach Gladys as a state yet. */
    this.offPending = new Set();
    this.lastBoundPort = undefined;
    /**
     * fixture id -> the state a failed command falls back to: the last one that
     * left in a frame, or the last "off" (an off stays, sent or not).
     */
    this.safe = new Map();
    /** universe -> the states of its frame in flight. */
    this.framed = new Map();
    this.lastTestAt = -Infinity;
    this.testWaiter = undefined;
    this.stateTimes = [];
    this.lastStatus = '';
    this.lastBadges = '';
    this.output = new Output({
      open,
      localPort,
      timers,
      monotonic,
      timings,
      frameOf: (universe) => this.frameOf(universe),
      onResult: (universe, result) => this.frameResult(universe, result),
      onMessage: (message, remote) => this.message(message, remote),
    });
  }

  // --- lifecycle --------------------------------------------------------------

  /** After every connection to Gladys: storage, configuration, Discovery, badges, status. */
  async connected(getConfig) {
    this.stopped = false;
    this.lastStatus = '';
    this.lastBadges = '';
    if (this.memory === undefined) this.loadMemory();
    this.clearConfigTimer();
    this.configDelay = this.timings.configRetryMin;
    await this.readConfig(getConfig);
  }

  async readConfig(getConfig) {
    const generation = this.generation;
    let raw;
    try {
      raw = await getConfig();
    } catch (err) {
      if (this.stopped || generation !== this.generation) return;
      this.logger.warn(`Configuration not read: ${err?.message ?? err}`);
      const delay = this.configDelay;
      this.configDelay = Math.min(this.timings.configRetryMax, delay * 2);
      this.configError = T.configUnread(delay);
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        if (!this.stopped) this.readConfig(getConfig);
      }, delay);
      await this.publishStatus();
      return;
    }
    if (this.stopped || generation !== this.generation) return;
    this.configError = undefined;
    await this.applyConfig(raw);
  }

  clearConfigTimer() {
    if (this.configTimer !== undefined) this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
  }

  async configUpdated(raw) {
    this.clearConfigTimer();
    this.configError = undefined;
    await this.applyConfig(raw);
  }

  async applyConfig(raw) {
    this.generation += 1;
    this.config = normalizeConfig(raw);
    this.configRead = true;
    this.rememberConfig();
    this.output.setNode(this.protectiveNode());
    await this.publishDiscovery();
    await this.publishBadges();
    await this.publishStatus();
  }

  /** The node and fixtures of the configuration, kept in /data (a typo in the node keeps the last valid one). */
  rememberConfig() {
    if (!this.memory || !this.configRead) return;
    const next = memoryOf(this.config.node ?? this.memory.node, this.config.fixtures);
    if (JSON.stringify(next) === JSON.stringify(memoryOf(this.memory.node, this.memory.fixtures))) {
      return;
    }
    this.memory = normalizeMemory(next);
    this.saveMemory();
  }

  /** Where "off" and Blackout go: the configured node, else the last valid one (/data). */
  protectiveNode() {
    return this.config.node ?? this.memory?.node;
  }

  /** The fixtures known: the configuration once read, else /data. */
  fixtures() {
    return this.configRead ? this.config.fixtures : (this.memory?.fixtures ?? []);
  }

  async stop() {
    this.stopped = true;
    this.generation += 1;
    this.clearConfigTimer();
    if (this.storeTimer !== undefined) this.timers.clearTimeout(this.storeTimer);
    this.storeTimer = undefined;
    if (this.testWaiter) this.testWaiter.resolve(undefined);
    this.output.close();
    await this.loading;
  }

  // --- /data ------------------------------------------------------------------

  /** One read at a time; unreadable: read again every 10 s, never taken as empty. */
  loadMemory() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const result = await this.store.load().catch(() => ({ ok: false }));
      this.loading = undefined;
      if (this.stopped) return;
      if (!result.ok) {
        this.storeFailed = true;
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = undefined;
          if (!this.stopped) this.loadMemory();
        }, this.timings.storeRetry);
        await this.publishStatus();
        return;
      }
      this.storeFailed = false;
      this.memory = normalizeMemory(result.data);
      this.rememberConfig();
      this.output.setNode(this.protectiveNode());
      await this.publishStatus();
    })();
    return this.loading;
  }

  async saveMemory() {
    if (!this.memory) return false;
    try {
      await this.store.save(memoryOf(this.memory.node, this.memory.fixtures));
      if (this.storeUnwritable) {
        this.storeUnwritable = false;
        await this.publishStatus();
      }
      return true;
    } catch (err) {
      this.logger.warn(`/data not written: ${err?.message ?? err}`);
      if (!this.storeUnwritable) {
        this.storeUnwritable = true;
        await this.publishStatus();
      }
      return false;
    }
  }

  // --- frames -------------------------------------------------------------------

  stateOf(id) {
    return this.states.get(id) ?? { ...DEFAULT_STATE, version: 0 };
  }

  /** The whole frame of a universe from the assumed states, right before it is sent. */
  frameOf(universe) {
    const list = this.fixtures().filter((f) => f.universe === universe);
    let needed = 2;
    for (const f of list) needed = Math.max(needed, f.address + PROFILES[f.profile].channels - 1);
    needed += needed % 2;
    const length = Math.min(LIMITS.channels, Math.max(this.lengths.get(universe) ?? 0, needed));
    this.lengths.set(universe, length);
    const data = new Uint8Array(length);
    const snapshot = [];
    for (const f of list) {
      const state = this.stateOf(f.id);
      snapshot.push([f.id, state]);
      data.set(channelsOf(f.profile, state), f.address - 1);
    }
    this.framed.set(universe, snapshot);
    return data;
  }

  frameResult(universe, result) {
    if (this.stopped || result.error === 'closed') return;
    const before = this.sendErrors.size;
    const previous = this.sendErrors.get(universe);
    if (result.sent) this.sendErrors.delete(universe);
    else this.sendErrors.set(universe, result.error);
    if (result.sent) {
      // What left is the fallback of a later failure, unless an "off" is newer.
      for (const [id, state] of this.framed.get(universe) ?? []) {
        if (state.version >= (this.safe.get(id)?.version ?? -1)) this.safe.set(id, state);
      }
    }
    if (result.sent && this.offPending.size > 0) {
      // An "off" answered with a failure reached the fixture later: Gladys learns it now.
      for (const f of this.fixtures().filter((x) => x.universe === universe)) {
        if (!this.offPending.delete(f.id)) continue;
        if (!this.stateOf(f.id).on) this.publishAssumed(f, FEATURES.BINARY, 0);
      }
    }
    if (this.output.boundPort !== this.lastBoundPort) {
      // The socket was (re)opened: the status says when 6454 was busy.
      this.lastBoundPort = this.output.boundPort;
      this.publishStatus();
    }
    if (previous !== this.sendErrors.get(universe)) {
      this.publishStatus();
      if ((before === 0) !== (this.sendErrors.size === 0)) this.publishBadges();
    }
  }

  /**
   * Touches a universe and waits for its next frame, within the answer budget:
   * `{ sent, error, issued }` (issued: the frame was handed to the socket).
   */
  async send(universe) {
    const fresh = !this.output.universes.has(universe);
    const { promise, waiter } = this.output.touch(universe);
    let timer;
    const deadline = new Promise((resolve) => {
      timer = this.timers.setTimeout(
        () => resolve({ sent: false, error: 'timeout', timedOut: true }),
        this.timings.ackBudget,
      );
    });
    const result = await Promise.race([promise, deadline]);
    this.timers.clearTimeout(timer);
    if (result.sent && fresh) {
      // First frame of this universe in this session: its fixtures never commanded are now at 0.
      for (const f of this.fixtures().filter((x) => x.universe === universe)) {
        if (this.states.has(f.id)) continue;
        this.states.set(f.id, { ...DEFAULT_STATE, version: 0 });
        this.publishAssumed(f, FEATURES.BINARY, 0);
      }
    }
    return { ...result, issued: waiter.issued };
  }

  // --- publications ------------------------------------------------------------

  async publishDiscovery() {
    const devices = this.config.fixtures.map((f) =>
      buildFixture(this.gladys, f, { language: this.config.language }),
    );
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.logger.warn(`Discovery not published: ${err?.message ?? err}`);
    }
  }

  statusNow() {
    const c = this.config;
    if (this.configError) return [false, this.configError];
    if (!this.configRead) return [false, T.configUnread(0)];
    if (!c.node) {
      return [false, c.invalid ? T.invalidAddress : c.broadcast ? T.broadcastAddress : T.noAddress];
    }
    const notes = [
      c.tooLong ? T.tooLong : c.fixtures.length === 0 ? T.noFixtures : undefined,
      c.errors.length > 0 ? T.fixtureErrors(c.errors) : undefined,
      this.storeFailed ? T.storeUnread : undefined,
      this.storeUnwritable ? T.storeUnwritable : undefined,
      this.localPort &&
      this.output.boundPort !== undefined &&
      this.output.boundPort !== this.localPort
        ? T.portFallback(this.output.boundPort)
        : undefined,
    ];
    const [code] = this.sendErrors.values();
    if (code !== undefined) return [false, join(T.sendFailed(c.node, code), ...notes)];
    return [true, join(T.ready(c.node, c.fixtures.length), T.assumed, ...notes)];
  }

  async publishStatus() {
    if (this.stopped) return;
    const [ok, message] = this.statusNow();
    const key = JSON.stringify([ok, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    try {
      await this.gladys.setConnectionStatus(ok, message);
    } catch (err) {
      this.lastStatus = '';
      this.logger.warn(`Status not published: ${err?.message ?? err}`);
    }
  }

  async publishBadges() {
    if (this.stopped) return;
    const transport = this.sendErrors.size > 0 ? 'unreachable' : 'local';
    const entries = this.config.fixtures.slice(0, 100).map((f) => ({
      external_id: fixtureIds(this.gladys, f).device,
      transport,
      degraded: true,
      message: T.badge,
    }));
    const key = JSON.stringify(entries);
    if (entries.length === 0 || key === this.lastBadges) return;
    this.lastBadges = key;
    try {
      await this.gladys.publishTransports(entries);
    } catch (err) {
      this.lastBadges = '';
      this.logger.warn(`Badges not published: ${err?.message ?? err}`);
    }
  }

  /** An assumed state (the command just sent), within 250 states a minute. */
  async publishAssumed(fixture, key, value) {
    if (this.stopped) return;
    const mono = this.monotonic();
    this.stateTimes = this.stateTimes.filter((t) => mono - t < 60_000);
    if (this.stateTimes.length >= LIMITS.statesPerMinute) return;
    this.stateTimes.push(mono);
    try {
      await this.gladys.publishState(fixtureIds(this.gladys, fixture).feature(key), value);
    } catch (err) {
      this.logger.warn(`State not published: ${err?.message ?? err}`);
    }
  }

  async scan() {
    await this.publishDiscovery();
    await this.publishBadges();
  }

  async devicesChanged() {
    this.lastBadges = '';
    await this.publishBadges();
  }

  // --- commands ---------------------------------------------------------------

  async setValue(device, feature, value) {
    const target = parseExternalId(this.gladys, feature?.external_id);
    if (!target || target.key === undefined) throw commandError(ERRORS.unknown);
    const checked = valueOf(target.key, value);
    if (checked === undefined) throw commandError(ERRORS.invalidValue);
    if (checked === 0 && (target.key === FEATURES.BINARY || target.key === FEATURES.BRIGHTNESS)) {
      return this.off(target, { fromBrightness: target.key === FEATURES.BRIGHTNESS });
    }
    return this.command(target, target.key, checked);
  }

  /** On, brightness, colour, temperature. */
  async command(target, key, value) {
    if (this.stopped) throw commandError(ERRORS.closed);
    if (!this.configRead) throw commandError(ERRORS.configUnread);
    if (!this.config.node) throw commandError(ERRORS.notConfigured);
    const fixture = this.config.fixtures.find((f) => f.id === target.id);
    if (!fixture) throw commandError(ERRORS.notListed);
    if (!PROFILES[fixture.profile].features.includes(key)) {
      throw commandError(ERRORS.notThisProfile);
    }
    const next = { ...this.stateOf(fixture.id), on: true };
    if (key === FEATURES.BRIGHTNESS) next.brightness = value;
    if (key === FEATURES.COLOR) next.color = value;
    if (key === FEATURES.TEMPERATURE) next.mired = value;
    const version = (this.seq += 1);
    this.states.set(fixture.id, { ...next, version });
    this.offPending.delete(fixture.id);
    const result = await this.send(fixture.universe);
    if (!result.sent) {
      if (result.issued && result.timedOut) throw commandError(ERRORS.unconfirmed);
      // Never left: back to the last state that left (or the last "off"), unless a
      // newer command of the fixture replaced it meanwhile (that one decides).
      if (this.states.get(fixture.id)?.version === version) {
        const fallback = this.safe.get(fixture.id) ?? DEFAULT_STATE;
        this.states.set(fixture.id, { ...fallback, version: (this.seq += 1) });
      }
      throw commandError(result.error === 'closed' ? ERRORS.closed : ERRORS.unsent(result.error));
    }
    if (key !== FEATURES.BINARY) await this.publishAssumed(fixture, FEATURES.BINARY, 1);
  }

  /** A fixture assumed off at once; a later failed command falls back to it. */
  setOff(fixture) {
    const state = { ...this.stateOf(fixture.id), on: false, version: (this.seq += 1) };
    this.states.set(fixture.id, state);
    this.safe.set(fixture.id, state);
  }

  /** The protective command: refused only when no node or no such fixture is known. */
  async off(target, { fromBrightness = false } = {}) {
    if (this.stopped) throw commandError(ERRORS.closed);
    const fixture = this.fixtures().find((f) => f.id === target.id);
    if (!fixture) {
      throw commandError(this.configRead ? ERRORS.notListed : ERRORS.configUnread);
    }
    if (!this.protectiveNode()) throw commandError(ERRORS.notConfigured);
    this.output.setNode(this.protectiveNode());
    this.setOff(fixture);
    const result = await this.send(fixture.universe);
    if (result.sent) {
      this.offPending.delete(fixture.id);
      if (fromBrightness) await this.publishAssumed(fixture, FEATURES.BINARY, 0);
      return;
    }
    this.offPending.add(fixture.id);
    if (result.error === 'closed') throw commandError(ERRORS.closed);
    if (result.issued && result.timedOut) throw commandError(ERRORS.offUnconfirmed);
    throw commandError(ERRORS.offUnsent(result.error));
  }

  /** Every fixture known at 0, every universe started or known sent at once. Never refused but for no node. */
  async blackout() {
    if (this.stopped) return { ok: false, message: T.closed };
    const fixtures = this.fixtures();
    const universes = [...new Set([...fixtures.map((f) => f.universe), ...this.output.active()])];
    if (universes.length === 0) return { ok: false, message: T.blackoutNothing };
    const node = this.protectiveNode();
    if (!node) return { ok: false, message: T.blackoutNoNode };
    this.output.setNode(node);
    for (const f of fixtures) {
      this.setOff(f);
      this.offPending.add(f.id);
    }
    const results = await Promise.all(universes.map((u) => this.send(u)));
    const sent = results.filter((r) => r.sent).length;
    for (const f of fixtures) {
      if (!results[universes.indexOf(f.universe)].sent) continue;
      if (!this.offPending.delete(f.id)) continue;
      if (!this.stateOf(f.id).on) await this.publishAssumed(f, FEATURES.BINARY, 0);
    }
    if (sent === universes.length) {
      return { ok: true, message: T.blackoutSent(sent, universes.length) };
    }
    const code = results.find((r) => !r.sent)?.error ?? 'ERROR';
    return { ok: false, message: T.blackoutPartial(sent, universes.length, code) };
  }

  async blackoutAction() {
    return (await this.blackout()).message;
  }

  /** Scene action: resolves when every universe left, else fails (the scene logs it and goes on). */
  async blackoutScene() {
    const { ok, message } = await this.blackout();
    if (!ok) throw new Error(message.en);
  }

  // --- "Test the node" ------------------------------------------------------------

  message(packet, remote) {
    const waiter = this.testWaiter;
    if (!waiter || remote?.address !== waiter.host) return;
    if (opcodeOf(packet) !== OPCODES.POLL_REPLY) return;
    const reply = parsePollReply(packet);
    if (reply) waiter.resolve(reply);
  }

  async testNode() {
    const c = this.config;
    if (!this.configRead) return this.configError ?? T.configUnread(0);
    if (!c.node)
      return c.invalid ? T.invalidAddress : c.broadcast ? T.broadcastAddress : T.noAddress;
    const mono = this.monotonic();
    if (mono - this.lastTestAt < this.timings.testSpacing) {
      return T.testTooSoon(this.lastTestAt + this.timings.testSpacing - mono);
    }
    this.lastTestAt = mono;
    const node = c.node;
    let timer;
    const reply = new Promise((resolve) => {
      this.testWaiter = { host: node.host, resolve };
      timer = this.timers.setTimeout(() => resolve(undefined), this.timings.testWait);
    });
    const sent = await this.output.sendTo(node, artPoll());
    if (!sent.sent) {
      this.timers.clearTimeout(timer);
      this.testWaiter = undefined;
      return T.testSendFailed(node, sent.error);
    }
    const answer = await reply;
    this.timers.clearTimeout(timer);
    this.testWaiter = undefined;
    await this.publishStatus();
    if (this.stopped) return T.testNoReply(node);
    return answer ? T.testOk(node, answer) : T.testNoReply(node);
  }
}
