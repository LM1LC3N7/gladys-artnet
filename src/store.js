// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), readable by the container user only (0600):
//   - `node`: the last valid node address of the configuration;
//   - `fixtures`: the universe, start address and profile of each fixture of
//     the last configuration read.
// They let "off" and "Blackout" leave right after a restart, before the
// configuration is read (or while it cannot be). No state of the fixtures is
// kept: after a restart every fixture is assumed off until commanded.
// An unreadable file is never taken as an empty one, and nothing is written
// over it until it reads again.
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { addFixture, parseAddress } from './config.js';
import { LIMITS } from './constants.js';
import { PROFILES } from './profiles.js';

export const STATE_FILE = '/data/artnet-state.json';

export function fileStore(path = process.env.DATA_FILE || STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    /** `{ ok: true, data }` (data null when there is no file yet) or `{ ok: false }`. */
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        if (text.length > LIMITS.storeBytes) return { ok: false };
        return { ok: true, data: JSON.parse(text) };
      } catch (err) {
        return err?.code === 'ENOENT' ? { ok: true, data: null } : { ok: false };
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** For the tests: the same JSON round trip as the file, with failures on demand. */
export function memoryStore(initial = null) {
  return {
    data: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    saves: 0,
    loads: 0,
    unreadable: false,
    unwritable: false,
    async load() {
      this.loads += 1;
      if (this.unreadable) return { ok: false };
      return { ok: true, data: this.data === null ? null : JSON.parse(JSON.stringify(this.data)) };
    },
    async save(data) {
      if (this.unwritable) throw new Error('EROFS');
      this.data = JSON.parse(JSON.stringify(data));
      this.saves += 1;
    },
  };
}

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** The persisted state, repaired and bounded with the rules of the configuration. */
export function normalizeMemory(raw) {
  const data = object(raw);
  const n = object(data.node);
  const parsed =
    typeof n.host === 'string' ? parseAddress(`${n.host}:${n.port}`).address : undefined;
  const node = parsed && parsed.host === n.host && parsed.port === n.port ? parsed : undefined;
  const fixtures = [];
  for (const item of Array.isArray(data.fixtures) ? data.fixtures.slice(0, LIMITS.fixtures) : []) {
    const f = object(item);
    if (
      !Number.isInteger(f.universe) ||
      f.universe < 0 ||
      f.universe > LIMITS.portAddress ||
      !Number.isInteger(f.address) ||
      f.address < 1 ||
      typeof f.profile !== 'string' ||
      !Object.hasOwn(PROFILES, f.profile) ||
      f.address + PROFILES[f.profile].channels - 1 > LIMITS.channels
    ) {
      continue;
    }
    addFixture(fixtures, {
      universe: f.universe,
      address: f.address,
      profile: f.profile,
      name: '',
    });
  }
  return { node, fixtures };
}

/** What is written: the node and the fixtures without their names (nothing personal). */
export const memoryOf = (node, fixtures) => ({
  node: node ? { host: node.host, port: node.port } : undefined,
  fixtures: fixtures.map((f) => ({ universe: f.universe, address: f.address, profile: f.profile })),
});
