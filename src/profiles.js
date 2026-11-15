// -----------------------------------------------------------------------------
// Fixture profiles: how many DMX channels a fixture takes from its start
// address, in which order, and how an assumed state (on, brightness, colour,
// white temperature) becomes channel values 0..255 (pure).
//
//   dimmer  1 channel   intensity
//   rgb     3 channels  red, green, blue (scaled by the brightness)
//   rgbw    4 channels  red, green, blue, white (white = the grey part of the colour)
//   drgb    4 channels  intensity, red, green, blue
//   drgbw   5 channels  intensity, red, green, blue, white
//   cct     2 channels  cold white, warm white (mixed by the temperature)
//
// "Off" is every channel of the fixture at 0, whatever the profile.
// -----------------------------------------------------------------------------

import { FEATURES, MIRED } from './constants.js';

const { BINARY, BRIGHTNESS, COLOR, TEMPERATURE } = FEATURES;

export const PROFILES = {
  dimmer: { channels: 1, features: [BINARY, BRIGHTNESS] },
  rgb: { channels: 3, features: [BINARY, BRIGHTNESS, COLOR] },
  rgbw: { channels: 4, features: [BINARY, BRIGHTNESS, COLOR] },
  drgb: { channels: 4, features: [BINARY, BRIGHTNESS, COLOR] },
  drgbw: { channels: 5, features: [BINARY, BRIGHTNESS, COLOR] },
  cct: { channels: 2, features: [BINARY, BRIGHTNESS, TEMPERATURE] },
};

/** The state of a fixture never commanded in this session: off. */
export const DEFAULT_STATE = Object.freeze({
  on: false,
  brightness: 100,
  color: 0xffffff,
  mired: 250,
});

const byte = (value) => Math.min(255, Math.max(0, Math.round(value)));

function split(color) {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** The channel values of a fixture in a state (an array of `PROFILES[profile].channels` bytes). */
export function channelsOf(profile, state) {
  const spec = PROFILES[profile];
  if (!spec) return [];
  if (!state?.on) return new Array(spec.channels).fill(0);
  const level = Math.min(100, Math.max(0, state.brightness)) / 100;
  const [r, g, b] = split(state.color);
  const w = Math.min(r, g, b);
  switch (profile) {
    case 'dimmer':
      return [byte(255 * level)];
    case 'rgb':
      return [byte(r * level), byte(g * level), byte(b * level)];
    case 'rgbw':
      return [byte((r - w) * level), byte((g - w) * level), byte((b - w) * level), byte(w * level)];
    case 'drgb':
      return [byte(255 * level), r, g, b];
    case 'drgbw':
      return [byte(255 * level), r - w, g - w, b - w, w];
    case 'cct': {
      const mired = Math.min(MIRED.max, Math.max(MIRED.min, state.mired));
      const warm = (mired - MIRED.min) / (MIRED.max - MIRED.min);
      const cold = 1 - warm;
      const scale = 1 / Math.max(warm, cold);
      return [byte(255 * level * cold * scale), byte(255 * level * warm * scale)];
    }
    default:
      return new Array(spec.channels).fill(0);
  }
}
