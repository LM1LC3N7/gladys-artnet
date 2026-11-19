# TODO — Art-Net

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `gi ci` (Prettier, ESLint, tests on Node 24 and 22,
  Docker build, store validator), `npm run audit`, `memcap npm run mutants`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum post from a module session.

## Status

- [x] **Milestone 1 — core** (2026-11-15, lot 24): one node, fixtures typed in
      one field, six profiles, assumed states, frames with a 25 ms gap and a
      900 ms keep-alive, protective "off" and Blackout (button + scene action)
      from /data before the configuration is read, "Test the node" (ArtPoll),
      badges, docs en/fr, cover. Tested against a simulated node only.
- [ ] **Milestone 2 — real node**: try a real Art-Net node (ENTTEC ODE, DMXking,
      a QLC+ / OLA receiver); check it accepts frames sent from a port other
      than 6454 when 6454 is busy, the cct channel order, the colour of rgbw.
- [ ] **Milestone 3 — more**: several nodes (one per universe), ArtPoll
      discovery of the subscribed universes (Art-Net 4 asks a controller to
      poll and send only to subscribers), 16-bit channels, more profiles
      (strobe, moving heads as selects, never a switch), ArtSync, answering
      ArtPoll with an ArtPollReply (needs an OEM code, see below).

## Decisions

- **Version 0.1.0 set by hand** (package.json, package-lock.json, manifest,
  `docker_image` tag) for the first milestone; from now on the Release
  workflow owns it.
- **SDK `^0.16.0`** (latest on npm on 2026-11-15).
- **Reference**: the Art-Net 4 specification of Artistic Licence (revision
  1.4dp, 2025-10-23), royalty-free; the credit "Art-Net™ Designed by and
  Copyright Artistic Licence" (exact text of the specification's Credits
  section) is in the docs, README and THIRD_PARTY_NOTICES; the company name
  (Artistic Licence Engineering Ltd) goes in a separate sentence. dmxnet (MIT) was only named as an example in the lot;
  no code of it or of any other implementation is used.
- **OEM code**: Louis decided on 2026-11-19 to publish v1 without one. The
  packets sent (ArtDmx, the 14-byte ArtPoll) carry no OEM field and no
  ArtPollReply is sent. A fully compliant Art-Net 4 controller (ArtPollReply to
  every ArtPoll, ArtPoll every 2.5-3 s, ArtDmx to subscribers only) would need
  one (milestone 3): ask Louis again before that work.
- **Unicast only**: Art-Net 4 forbids broadcasting ArtDmx; broadcast, multicast
  and network addresses are refused in the configuration and in /data.
- **No subscription check (v1)**: frames go to the configured node without
  checking (ArtPoll) that it subscribes to the universe; the user typed the
  node and the universe.
- **Universe 1 when left out** (r1): Art-Net 4 gives Port-Address 1..32767 as
  the valid range and deprecates 0; 0 stays accepted when typed (`0/4`), since
  many nodes still use it.
- **/data read at construction** (r1): the SDK 0.16 relays commands as soon as
  it is authenticated but emits `connected` only after its own getDevices()
  and getConfig() succeed; "off" and Blackout wait up to 1.5 s for a /data
  read in progress before the configuration is read.
- **Fixtures in one string field**: the config schema has no list type; one
  line `[universe/]address profile name` separated by `;`. External id =
  universe + start address (frozen); a name or profile change keeps the device.
- **Restart = every fixture off**: no state is kept in /data. Resuming the old
  states would light fixtures nobody asked for after a power cut; after a
  restart the first frame of a universe sets the fixtures not commanded yet to
  0 and publishes "off" for them, so Gladys shows what is sent.
- **Frames computed at send time** from the assumed states: an "off" never
  needs a queue nor a resend list; the 900 ms keep-alive is the retry.
- **A failed "on"** (datagram refused by the socket) is undone so a later
  keep-alive does not light the fixture behind a failure answer. A command whose
  frame was handed to the socket but not confirmed within 3.4 s is answered
  "not confirmed" and kept.
- **Local port 6454** (Art-Net uses it as source and destination), else any
  free port, said in the status.
- **Universes keep being sent until the integration stops**, even when their
  fixtures are removed (then at 0): one rule, no surprise.
- **Wall clock not used**: nothing in /data has a date.
- **No `keywords`, no `countries`** (worldwide).
- [ ] r2 mineurs : tests des gardes Blackout (attente /data app.js:539, plafond :551), minuteur d'attente /data non annulé (:492), allumer annulé après redémarrage non annoncé à 0.
