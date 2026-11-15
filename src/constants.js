// -----------------------------------------------------------------------------
// Fixed values of the integration: Art-Net numbers, timings, bounds.
// Times are in milliseconds of the monotonic clock unless said otherwise.
//
// Art-Net 4 (Artistic Licence, specification revision 1.4dp of 2025-10-23):
//   - one UDP port, 6454 (0x1936), used as source and destination;
//   - ArtDmx is unicast only ("no conditions in which broadcast is allowed");
//   - a DMX512 output takes 44 frames a second at most;
//   - a sender repeats the last frame every 800 to 1000 ms (keep-alive).
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;

export const ARTNET_PORT = 6454;
export const PROTOCOL_VERSION = 14;
export const OPCODES = { POLL: 0x2000, POLL_REPLY: 0x2100, DMX: 0x5000 };

/** The features of a fixture (keys of the external ids: frozen). */
export const FEATURES = {
  BINARY: 'binary',
  BRIGHTNESS: 'brightness',
  COLOR: 'color',
  TEMPERATURE: 'temperature',
};

/** Brightness in % (0 is "off"), white temperature in mireds (6500 K .. 2700 K). */
export const BRIGHTNESS = { min: 0, max: 100 };
export const MIRED = { min: 153, max: 370 };

/** Manifest keys (frozen). */
export const ACTIONS = { TEST: 'test_node', BLACKOUT: 'blackout' };
export const SCENE_ACTIONS = { BLACKOUT: 'blackout' };

export const TIMINGS = {
  /** Shortest gap between two frames of one universe: 40 a second, under the 44 of DMX512. */
  gap: 25,
  /** Keep-alive: the last frame of each universe sent again (Art-Net 4: 800 to 1000 ms). */
  refresh: 900,
  /** A command is answered within this (Gladys stops waiting at 5 s). */
  ackBudget: 3400,
  /** getConfig() failing: tried again after 5 s, doubled up to 5 min. */
  configRetryMin: 5 * SECOND,
  configRetryMax: 5 * MINUTE,
  /** /data unreadable: read again every 10 s. */
  storeRetry: 10 * SECOND,
  /** "Test the node": wait for the ArtPollReply, then refuse a new test for 10 s. */
  testWait: 3 * SECOND,
  testSpacing: 10 * SECOND,
};

export const LIMITS = {
  fixtures: 64,
  universes: 16,
  /** Characters of the "Fixtures" field. */
  fixturesText: 4000,
  /** Characters of a fixture name. */
  name: 40,
  /** 15-bit Port-Address. */
  portAddress: 32767,
  channels: 512,
  /** States published a minute (the core admits 300). */
  statesPerMinute: 250,
  /** Characters of a status or an action result. */
  message: 600,
  /** A received datagram above this is dropped unread (an ArtPollReply holds 207 to 239 bytes). */
  datagram: 1024,
  storeBytes: 64 * 1024,
};
