// -----------------------------------------------------------------------------
// The fixtures of the configuration -> Gladys devices (pure).
//
// One Gladys device per fixture, a `light`, with the features of its profile:
//   binary       light/binary       on, off
//   brightness   light/brightness   0..100 %  (0 is "off")
//   color        light/color        0xRRGGBB  (rgb, rgbw, drgb, drgbw)
//   temperature  light/temperature  153..370 mireds (cct)
// Every feature is written only (`has_feedback: false`): Art-Net sends DMX
// one way, a fixture never says its state; Gladys shows the last command sent
// (the badge says so).
//
// Identity rule (frozen: it fixes the external ids): the universe and the
// start address, never the name nor the profile nor the node address:
//   device   ext:<selector>:fixture:u<universe>-a<address>
//   feature  <device>:<binary|brightness|color|temperature>
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { fixtureId } from './config.js';
import { BRIGHTNESS, FEATURES, LIMITS, MIRED } from './constants.js';
import { featureLabel, fixtureLabel } from './i18n.js';
import { PROFILES } from './profiles.js';

export const fixtureIds = (gladys, fixture) => gladys.externalIds('fixture', fixtureId(fixture));

const ID = /^u(0|[1-9]\d{0,4})-a([1-9]\d{0,2})$/;

/** `{ universe, address }` of a platform id, or undefined. */
export function fixtureOf(id) {
  const match = ID.exec(id ?? '');
  if (!match) return undefined;
  const universe = Number(match[1]);
  const address = Number(match[2]);
  if (universe > LIMITS.portAddress || address > LIMITS.channels) return undefined;
  return { universe, address };
}

/**
 * `{ id, universe, address, key }` of an external id of this integration (key
 * undefined for a device), or undefined. Prefix and parts matched exactly.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string' || externalId.length > 200) return undefined;
  const prefix = gladys.externalId('');
  if (!externalId.startsWith(prefix)) return undefined;
  const [type, id, key, ...rest] = externalId.slice(prefix.length).split(':');
  if (type !== 'fixture' || rest.length > 0) return undefined;
  const fixture = fixtureOf(id);
  if (!fixture) return undefined;
  if (key !== undefined && !Object.values(FEATURES).includes(key)) return undefined;
  return { id, ...fixture, key };
}

const FEATURE_SPECS = {
  [FEATURES.BINARY]: { type: T.LIGHT.BINARY, min: 0, max: 1 },
  [FEATURES.BRIGHTNESS]: { type: T.LIGHT.BRIGHTNESS, min: BRIGHTNESS.min, max: BRIGHTNESS.max },
  [FEATURES.COLOR]: { type: T.LIGHT.COLOR, min: 0, max: 0xffffff },
  [FEATURES.TEMPERATURE]: { type: T.LIGHT.TEMPERATURE, min: MIRED.min, max: MIRED.max },
};

/** The name of a fixture in Gladys: the one typed, else "Fixture 0/1". */
export const fixtureName = (fixture, language = 'fr') =>
  fixture.name || `${fixtureLabel(language)} ${fixture.universe}/${fixture.address}`;

/** The Gladys device of a fixture. */
export function buildFixture(gladys, fixture, { language = 'fr' } = {}) {
  const ids = fixtureIds(gladys, fixture);
  return {
    name: fixtureName(fixture, language),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'ARTNET_UNIVERSE', value: String(fixture.universe) },
      { name: 'ARTNET_ADDRESS', value: String(fixture.address) },
      { name: 'ARTNET_PROFILE', value: fixture.profile },
    ],
    features: PROFILES[fixture.profile].features.map((key) => ({
      name: featureLabel(key, language),
      external_id: ids.feature(key),
      category: C.LIGHT,
      ...FEATURE_SPECS[key],
      read_only: false,
      has_feedback: false,
      keep_history: key === FEATURES.BINARY,
    })),
  };
}

/**
 * A value sent by Gladys, checked: a finite number in [min, max] (never null,
 * '' nor a boolean: they are not 0), rounded for the integers. Undefined if not.
 */
export function valueOf(key, raw) {
  if (typeof raw === 'string' && !/^\s*-?\d+(\.\d+)?\s*$/.test(raw)) return undefined;
  if (typeof raw !== 'number' && typeof raw !== 'string') return undefined;
  const n = Number(raw);
  const spec = FEATURE_SPECS[key];
  if (!spec || !Number.isFinite(n) || n < spec.min || n > spec.max) return undefined;
  if (key === FEATURES.BINARY) return n === 0 || n === 1 ? n : undefined;
  if (key === FEATURES.COLOR) return Number.isInteger(n) ? n : undefined;
  return Math.round(n);
}
