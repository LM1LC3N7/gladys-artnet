# Art-Net

Drives DMX stage lighting (dimmers, RGB, RGBW and white fixtures) from Gladys
through an **Art-Net node**: the box that turns your local network into DMX512
lines. Everything stays on the local network (UDP port 6454), with no account
and no cloud.

> This integration has **never been tested with a real node**: only against a
> simulated node on the same machine. Please report how it behaves with yours.
> It is not affiliated with Artistic Licence nor with any lighting brand.

Art-Net™ Designed by and Copyright Artistic Licence Engineering Ltd.

## What you need

- An Art-Net node (Art-Net 3 or 4) on your network, with a **fixed IP address**
  (set it in your router or in the node).
- The DMX address of each fixture (set on the fixture: a display, DIP switches)
  and the universe of the DMX line it is plugged on (set in the node).

## Configuration

1. **Node IP address**: the address of the node, for example `192.168.1.60`.
   The port is 6454 unless you add another (`192.168.1.60:6455`). A broadcast
   address (ending in `.255`, `2.255.255.255`...) is refused: Art-Net 4 sends
   DMX to the node itself.
2. **Fixtures**: one entry per fixture, separated by `;`:
   `[universe/]address profile name`. Example:
   `1 rgb Living room; 0/4 dimmer Bar; 1/10 cct Desk`.
   - universe: 0 to 32767 (the Port-Address of the node), 0 when left out;
   - address: 1 to 512, the first DMX channel of the fixture;
   - profile: the order of its channels:

     | Profile  | Channels                           | Gladys features                       |
     | -------- | ---------------------------------- | ------------------------------------- |
     | `dimmer` | intensity                          | on/off, brightness                    |
     | `rgb`    | red, green, blue                   | on/off, brightness, colour            |
     | `rgbw`   | red, green, blue, white            | on/off, brightness, colour            |
     | `drgb`   | intensity, red, green, blue        | on/off, brightness, colour            |
     | `drgbw`  | intensity, red, green, blue, white | on/off, brightness, colour            |
     | `cct`    | cold white, warm white             | on/off, brightness, white temperature |

   - name: up to 40 characters (optional: `Fixture 0/4` otherwise).

   An entry that cannot be read, that runs past channel 512 or that overlaps
   an earlier fixture is skipped: the status gives its position and the
   reason. At most 64 fixtures on 16 universes.

3. **Language of the default names**: the names given to fixtures without one
   and to the features.

Save: the fixtures appear in **Discovery** (one light each). Add them.

## Assumed state

Art-Net sends DMX one way: a fixture **never reports its state**. Gladys shows
the last command sent, and the badge of each fixture says the state is assumed.
If someone changes a fixture with a lighting desk or its own buttons, Gladys
does not know.

After a restart of the integration, every fixture is assumed **off**: nothing is
sent until the first command, and that first command sends the whole universe,
so the other fixtures of the universe go to 0 (Gladys shows them off). The DMX
channels of a universe that are not in the fixtures list are sent at 0.

## How the frames are sent

- A universe starts being sent at the first command, "off" or Blackout that
  touches it. Its frame (the whole universe, from channel 1 to the last channel
  used) then leaves after each change, 25 ms after the previous frame at the
  earliest (40 frames a second at most, the DMX512 limit is 44), and again every
  900 ms without change, as Art-Net asks, until the integration stops.
- A frame is sent by unicast to the node address, from port 6454 when it is
  free (else from another port, said in the status: a few nodes ignore it).
- A command is answered once its frame left the network card. If it could not
  leave (network error), "on", brightness, colour and temperature are undone
  and the answer says nothing was sent.

## Off and Blackout

"Off" (on/off at 0, or brightness 0) sets every channel of the fixture to 0.
**Blackout** (button in the configuration, and scene action "Art-Net
blackout") sets every known fixture, and every universe already sent, to 0.

They need no option and no configuration read: the node address and the
fixtures are also kept in `/data`, so they work right after a restart, before
Gladys gives the configuration. If a frame cannot leave, the 900 ms keep-alive
tries it again until it does; when it finally leaves, Gladys is told the
fixture is off. Their only refusals:

- no node address known (none configured, nothing in `/data`);
- a fixture known neither by the configuration nor by `/data` ("off" only);
- no fixture and no universe known at all (Blackout only);
- the integration is stopping.

If the node address in the configuration becomes invalid, "off" and Blackout
go to the last valid one.

## Buttons

- **Test the node**: sends an ArtPoll and shows the name the node gives in its
  ArtPollReply (3 s at most, once every 10 s). Some nodes answer only to port
  6454, or not at all: this does not stop the DMX frames.
- **Blackout (all fixtures at 0)**: see above.

## Status

- _Ready: N fixture(s), frames go to address:port_: the configuration is valid.
- _Frames do not leave for ... (code)_: the network refuses the datagrams
  (cable, address); they are tried again every second.
- _Configuration not read_: Gladys did not give it, tried again after 5 s,
  then up to every 5 min.
- _Entries skipped_: the position and reason of each entry in error.
- _Storage /data unreadable / not writable_: read again every 10 s; until then
  "off" and Blackout need the configuration.

## Limits

- One node. Several nodes, ArtPoll discovery, ArtSync and RDM are not done.
- 8-bit channels only (no 16-bit "fine" channels), no moving heads, no effects.
- Nothing is read back: the state is the last command sent.

## Privacy

Nothing leaves your local network. `/data` keeps the node address and the
universe, address and profile of each fixture (not their names).
