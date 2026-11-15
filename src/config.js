// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with what a form may send. There is no secret:
// Art-Net has no password.
//
// The "Fixtures" field is one line, entries separated by `;`:
//   [<universe>/]<address> <profile> [<name>]
//   e.g.  1 rgb Living room; 0/4 dimmer Bar; 2/10 drgbw Stage left
// universe 0..32767 (the 15-bit Port-Address, 0 when left out), address
// 1..512 (the first DMX channel of the fixture), profile among PROFILES, name
// up to 40 characters. An entry that cannot be read, that runs past channel
// 512 or that overlaps an earlier fixture is skipped and its position shown in
// the status (never its text).
// -----------------------------------------------------------------------------

import { ARTNET_PORT, LIMITS } from './constants.js';
import { PROFILES } from './profiles.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  node_address: '',
  fixtures: '',
  language: 'fr',
};

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

/**
 * The node address typed by the user: one IPv4 address, with an optional port
 * (6454 by default). A pasted URL is reduced to its host. Never a broadcast,
 * multicast or "any" address: Art-Net 4 sends DMX by unicast only.
 * @returns {{ address?: { host: string, port: number }, invalid?: boolean, broadcast?: boolean }}
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') return {};
  if (text.length > 100 || /[\s@\\]/.test(text)) return { invalid: true };
  text = text.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');
  const match = /^([\d.]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match || !IPV4.test(match[1])) return { invalid: true };
  const [, host, portText] = match;
  const port = portText === undefined ? ARTNET_PORT : Number(portText);
  if (port < 1 || port > 65535) return { invalid: true };
  const octets = host.split('.').map(Number);
  if (
    octets[0] === 0 ||
    octets[0] >= 224 ||
    octets[3] === 255 ||
    (octets[3] === 0 && octets[0] !== 127)
  ) {
    return { broadcast: true };
  }
  return { address: { host, port } };
}

/** `u<universe>-a<address>`: the platform id of a fixture (frozen). */
export const fixtureId = ({ universe, address }) => `u${universe}-a${address}`;

/** A decimal integer written without sign, leading zero or decimals, in [min, max]; else undefined. */
function integer(text, min, max) {
  if (!/^(0|[1-9]\d{0,4})$/.test(text)) return undefined;
  const n = Number(text);
  return n >= min && n <= max ? n : undefined;
}

/** A fixture name: printable, no control character, at most 40 characters; '' when absent. */
function cleanName(text) {
  const name = text.replace(/\s+/g, ' ').trim();
  if (/[\p{Cc}\p{Cf}]/u.test(name) || [...name].length > LIMITS.name) return undefined;
  return name;
}

/**
 * One entry, or `{ error }`: 'syntax', 'universe', 'address', 'profile',
 * 'name', 'overflow' (runs past channel 512).
 */
export function parseFixture(entry) {
  const match = /^(?:(\d+)\/)?(\d+)\s+([a-z]+)(?:\s+(.*))?$/i.exec(entry.trim());
  if (!match) return { error: 'syntax' };
  const [, universeText = '0', addressText, profileText, nameText = ''] = match;
  const universe = integer(universeText, 0, LIMITS.portAddress);
  if (universe === undefined) return { error: 'universe' };
  const address = integer(addressText, 1, LIMITS.channels);
  if (address === undefined) return { error: 'address' };
  const profile = profileText.toLowerCase();
  if (!Object.hasOwn(PROFILES, profile)) return { error: 'profile' };
  if (address + PROFILES[profile].channels - 1 > LIMITS.channels) return { error: 'overflow' };
  const name = cleanName(nameText);
  if (name === undefined) return { error: 'name' };
  return { fixture: { universe, address, profile, name } };
}

/** The last channel of a fixture. */
export const lastChannel = (f) => f.address + PROFILES[f.profile].channels - 1;

/**
 * Adds a fixture to a list unless it overlaps one already there or a bound is
 * reached: the reason, or undefined when added.
 */
export function addFixture(list, fixture) {
  if (list.length >= LIMITS.fixtures) return 'tooMany';
  const universes = new Set(list.map((f) => f.universe));
  if (!universes.has(fixture.universe) && universes.size >= LIMITS.universes) return 'universes';
  const overlap = list.some(
    (f) =>
      f.universe === fixture.universe &&
      f.address <= lastChannel(fixture) &&
      fixture.address <= lastChannel(f),
  );
  if (overlap) return 'overlap';
  list.push({ ...fixture, id: fixtureId(fixture) });
  return undefined;
}

/**
 * The fixtures of the field: `{ fixtures, errors: [{ index (1-based), reason }], tooLong }`.
 */
export function parseFixtures(raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (text.length > LIMITS.fixturesText) return { fixtures: [], errors: [], tooLong: true };
  const fixtures = [];
  const errors = [];
  const entries = text.split(/[;\n\r]/);
  let index = 0;
  for (const entry of entries) {
    if (entry.trim() === '') continue;
    index += 1;
    const parsed = parseFixture(entry);
    const reason = parsed.error ?? addFixture(fixtures, parsed.fixture);
    if (reason) errors.push({ index, reason });
  }
  return { fixtures, errors, tooLong: false };
}

/**
 * @returns {{ node?: { host: string, port: number }, invalid: boolean, broadcast: boolean,
 *   fixtures: object[], errors: { index: number, reason: string }[], tooLong: boolean,
 *   language: 'fr'|'en' }}
 */
export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(c, key) && value != null) c[key] = value;
  }
  const parsed = parseAddress(typeof c.node_address === 'string' ? c.node_address : '');
  const { fixtures, errors, tooLong } = parseFixtures(c.fixtures);
  return {
    node: parsed.address,
    invalid: Boolean(parsed.invalid),
    broadcast: Boolean(parsed.broadcast),
    fixtures,
    errors,
    tooLong,
    language: c.language === 'en' ? 'en' : 'fr',
  };
}

/** `host:port`: a change of it sends the frames to the new node. */
export const nodeKey = (node) => (node ? `${node.host}:${node.port}` : '');
