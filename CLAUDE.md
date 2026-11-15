# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** (Node.js 22+, ESM, no build step,
its own sandboxed Docker container) that drives DMX fixtures through one
Art-Net node over UDP 6454, written from the Art-Net 4 specification.
Its only runtime dependency is `@gladysassistant/integration-sdk`.

## Commands

```bash
npm install
npm test                                  # node --test (60 s timeout per test)
node --test test/app.test.js              # one file
npm run lint && npm run format:check
memcap npm run mutants                    # mutation check of the guards
npx github:GladysAssistant/integration-store .   # store admission checks
```

## Architecture

```
index.js            SDK wiring only
src/handlers.js     handlers registered before connect() (shared with the tests)
src/app.js          ArtnetApp: config, /data, assumed states, commands, off, Blackout, test, status, badges
src/output.js       UDP socket, per-universe frames (25 ms gap, 900 ms keep-alive), waiters
src/protocol.js     ArtDmx, ArtPoll, ArtPollReply (pure)
src/profiles.js     fixture profiles: channels of a state (pure)
src/config.js       node address and "Fixtures" field parsing (pure)
src/devices.js      Gladys devices, external ids, value checks (pure)
src/store.js        /data (node + fixtures, no names)
src/i18n.js         texts en/fr
test/helpers/node.js  simulated Art-Net node on 127.0.0.1, sped-up real clock
scripts/            cover.png generator, mutants (scripts/mutants.json)
```

## Rules

- **External ids are forever**: `ext:<selector>:fixture:u<universe>-a<address>`;
  never the name, the profile nor the node address.
- **"Off" and Blackout are never blocked** but for: no node known, fixture
  unknown to config and /data, stopping. No option, no configuration read,
  no rate refusal in front of them. A change that adds a condition to `off()`,
  `blackout()` or `Output.touch()` needs a test that they still leave.
- **/data is read at construction** (the SDK emits `connected` only after its
  own getConfig): before the configuration is read, `off()` and `blackout()`
  wait up to 1.5 s for that read.
- **The frame is computed right before each send** from the assumed states:
  nothing older can leave after an "off". A failed "on" is undone (unless a
  newer command replaced it); a failed "off" is kept (the keep-alive retries).
- **Unicast only** (Art-Net 4): no `setBroadcast`, broadcast addresses refused.
- **Rate**: 25 ms between two frames of a universe, keep-alive 900 ms.
- **Clocks**: monotonic only (no wall clock is needed); tests on a sped-up
  real clock, every wait bounded.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow**; `test/manifest.test.js` checks
  the four places agree.
- **Changelog**: every user-visible change under `## [Unreleased]`.
- **User-facing text** is bilingual (English and French), docs kept in sync
  with the code, the Art-Net credit kept in docs and README.
