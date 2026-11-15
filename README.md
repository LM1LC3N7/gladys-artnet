# gladys-artnet

[Gladys Assistant](https://gladysassistant.com) external integration for **DMX
stage lighting over Art-Net**: an Art-Net node on the local network (UDP 6454)
drives dimmers, RGB, RGBW, intensity + RGB(W) and cold/warm white fixtures as
Gladys lights. No account, no cloud. Unofficial.

This integration has **never been tested with a real node**: only against a
simulated node on the same machine. Not affiliated with Artistic Licence nor
with any lighting brand.

Art-Net™ Designed by and Copyright Artistic Licence Engineering Ltd.

- User documentation: [English](docs/en.md) · [Français](docs/fr.md)
- Art-Net never reports a state: Gladys shows the last command sent (assumed
  state, said on each fixture's badge).
- "Off" and **Blackout** (button and scene action) depend on no option and no
  configuration read (node and fixtures kept in `/data`), and the 900 ms
  keep-alive sends them again until they leave.
- Frames: unicast to the node, 40 a second at most per universe, keep-alive
  every 900 ms (Art-Net 4: 800 to 1000 ms).

## Development

```bash
npm install
npm test            # node --test, against the SDK's fake Gladys and a local UDP node
npm run lint
npm run format:check
npm run mutants     # mutation check of the guards (use memcap)
npm run cover       # regenerates cover.png
```

Written from the Art-Net 4 specification (art-net.org.uk, revision 1.4dp of
2025-10-23); no code is taken from another implementation. See
[CLAUDE.md](CLAUDE.md) for the architecture and the rules, [TODO.md](TODO.md)
for the decisions and what comes next.

## License

Apache-2.0 (see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
