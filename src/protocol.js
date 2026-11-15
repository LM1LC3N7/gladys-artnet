// -----------------------------------------------------------------------------
// Art-Net packets (pure), written from the Art-Net 4 specification of
// Artistic Licence (art-net.org.uk, revision 1.4dp): nothing is ported from
// another implementation.
//
//   ArtDmx   "Art-Net\0", OpCode 0x5000 (low byte first), ProtVer 0/14,
//            Sequence 1..255 (0 = off), Physical 0, SubUni (Port-Address low
//            byte), Net (its top 7 bits), Length (high byte first, even,
//            2..512), then the channel values from channel 1.
//   ArtPoll  "Art-Net\0", OpCode 0x2000, ProtVer 0/14, Flags 0, DiagPriority 0
//            (14 bytes: the shortest an ArtPoll consumer must accept).
//   ArtPollReply (read only, 207 bytes or more): IP at 10, ShortName at 26
//            (18 bytes), LongName at 44 (64 bytes).
//
// Art-Net(TM) Designed by and Copyright Artistic Licence Engineering Ltd.
// -----------------------------------------------------------------------------

import { LIMITS, OPCODES, PROTOCOL_VERSION } from './constants.js';

const ID = Buffer.from('Art-Net\0', 'latin1');
const HEADER = 18;
const POLL_REPLY_MIN = 207;

/** An ArtDmx packet; undefined for a universe, sequence or length out of the specification. */
export function artDmx({ universe, sequence, data }) {
  const length = data?.length ?? 0;
  if (!Number.isInteger(universe) || universe < 0 || universe > LIMITS.portAddress)
    return undefined;
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 255) return undefined;
  if (length < 2 || length > LIMITS.channels || length % 2 !== 0) return undefined;
  const packet = Buffer.alloc(HEADER + length);
  ID.copy(packet, 0);
  packet.writeUInt16LE(OPCODES.DMX, 8);
  packet[10] = 0;
  packet[11] = PROTOCOL_VERSION;
  packet[12] = sequence;
  packet[13] = 0;
  packet[14] = universe & 0xff;
  packet[15] = (universe >> 8) & 0x7f;
  packet[16] = (length >> 8) & 0xff;
  packet[17] = length & 0xff;
  for (let i = 0; i < length; i += 1) packet[HEADER + i] = data[i] & 0xff;
  return packet;
}

/** An ArtPoll asking for nothing but an ArtPollReply. */
export function artPoll() {
  const packet = Buffer.alloc(14);
  ID.copy(packet, 0);
  packet.writeUInt16LE(OPCODES.POLL, 8);
  packet[10] = 0;
  packet[11] = PROTOCOL_VERSION;
  return packet;
}

/** The OpCode of an Art-Net packet, or undefined (not Art-Net, too short or too long). */
export function opcodeOf(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 10 || packet.length > LIMITS.datagram) {
    return undefined;
  }
  if (!packet.subarray(0, 8).equals(ID)) return undefined;
  return packet.readUInt16LE(8);
}

/** A NUL-terminated name, printable ASCII only (anything else becomes a space), trimmed. */
function name(packet, start, size) {
  let text = '';
  for (let i = start; i < start + size; i += 1) {
    const c = packet[i];
    if (c === 0) break;
    text += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ' ';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** `{ ip, shortName, longName }` of an ArtPollReply, or undefined. */
export function parsePollReply(packet) {
  if (opcodeOf(packet) !== OPCODES.POLL_REPLY || packet.length < POLL_REPLY_MIN) return undefined;
  return {
    ip: [...packet.subarray(10, 14)].join('.'),
    shortName: name(packet, 26, 18),
    longName: name(packet, 44, 64),
  };
}

/** The universe, sequence and channel values of an ArtDmx packet (tests and diagnostics), or undefined. */
export function parseDmx(packet) {
  if (opcodeOf(packet) !== OPCODES.DMX || packet.length < HEADER + 2) return undefined;
  const length = (packet[16] << 8) | packet[17];
  if (length < 2 || length > LIMITS.channels || packet.length !== HEADER + length) return undefined;
  return {
    universe: packet[14] | ((packet[15] & 0x7f) << 8),
    sequence: packet[12],
    data: [...packet.subarray(HEADER)],
  };
}
