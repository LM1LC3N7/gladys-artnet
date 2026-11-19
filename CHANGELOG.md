# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-11-19

### Added

- First version: DMX fixtures through one Art-Net node (UDP 6454, unicast) as
  Gladys lights. Profiles dimmer, rgb, rgbw, drgb, drgbw and cct, typed in one
  "Fixtures" field (`[universe/]address profile name`, universe 1 when left
  out: Art-Net 4 deprecates 0, still accepted when typed).
- Assumed state (Art-Net never reports one), said on each fixture's badge.
- Frames of a universe: 40 a second at most, keep-alive every 900 ms.
- "Off" and Blackout (button and scene action) that need no configuration read
  (node and fixtures kept in `/data`), sent again by the keep-alive until they
  leave.
- /data read as soon as the integration starts: "off" and Blackout work
  before Gladys gives the configuration.
- "Test the node" button (ArtPoll / ArtPollReply).
- CI: timeouts on the jobs, tests run with `--test-force-exit`.
- Documentation in English and French, with the Art-Net credit.

[Unreleased]: https://github.com/LM1LC3N7/gladys-artnet/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-artnet/releases/tag/v0.1.1
