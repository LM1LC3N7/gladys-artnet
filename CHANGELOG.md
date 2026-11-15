# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: DMX fixtures through one Art-Net node (UDP 6454, unicast) as
  Gladys lights. Profiles dimmer, rgb, rgbw, drgb, drgbw and cct, typed in one
  "Fixtures" field (`[universe/]address profile name`).
- Assumed state (Art-Net never reports one), said on each fixture's badge.
- Frames of a universe: 40 a second at most, keep-alive every 900 ms.
- "Off" and Blackout (button and scene action) that need no configuration read
  (node and fixtures kept in `/data`), sent again by the keep-alive until they
  leave.
- "Test the node" button (ArtPoll / ArtPollReply).
- Documentation in English and French, with the Art-Net credit.
