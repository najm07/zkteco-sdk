/**
 * Wire format for the ZKTeco standalone ("SSR") protocol on TCP/4370.
 *
 * Established empirically against firmware `Ver 6.60 Nov 21 2019`
 * (uFace800 Plus) and verified against 16/16 captured
 * frames. See `scripts/checksum-solver.cjs`.
 *
 * Frame layout (all multi-byte fields little-endian):
 *
 *   0..3    magic     50 50 82 7d
 *   4..7    length    uint32, payload byte length
 *   8..9    command   uint16
 *   10..11  checksum  uint16
 *   12..13  session   uint16
 *   14..15  reply     uint16, request/response correlation id
 *   16..    payload
 *
 * The checksum covers command, session, reply and payload as 16-bit words, with
 * end-around carry, then one's complement. Length and magic are excluded.
 */

export const MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
export const HEADER_SIZE = 16;

export interface Frame {
  command: number;
  session: number;
  reply: number;
  data: Buffer;
}

export function checksum(
  command: number,
  session: number,
  reply: number,
  data: Buffer,
): number {
  let sum = command + session + reply;
  while (sum > 0xffff) sum = (sum & 0xffff) + 1;
  for (let i = 0; i < data.length; i += 2) {
    sum += data[i]! | ((data[i + 1] ?? 0) << 8);
    while (sum > 0xffff) sum = (sum & 0xffff) + 1;
  }
  return ~sum & 0xffff;
}

export function encodeFrame(frame: Frame): Buffer {
  const payloadLength = 8 + frame.data.length;
  const buf = Buffer.alloc(8 + payloadLength);
  MAGIC.copy(buf, 0);
  buf.writeUInt32LE(payloadLength, 4);
  buf.writeUInt16LE(frame.command, 8);
  buf.writeUInt16LE(checksum(frame.command, frame.session, frame.reply, frame.data), 10);
  buf.writeUInt16LE(frame.session, 12);
  buf.writeUInt16LE(frame.reply, 14);
  frame.data.copy(buf, 16);
  return buf;
}

/**
 * Split a byte stream into frames. Returns whole frames plus whatever trailing
 * bytes are not yet a complete frame, for the caller to keep buffering.
 */
export function decodeFrames(buffer: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 8) break;
    const magicIndex = buffer.indexOf(MAGIC, offset);
    if (magicIndex < 0) {
      offset = buffer.length;
      break;
    }
    if (magicIndex + 8 > buffer.length) {
      offset = magicIndex;
      break;
    }
    const length = buffer.readUInt32LE(magicIndex + 4);
    if (length < 8 || length > 64 * 1024 * 1024) {
      offset = magicIndex + 4;
      continue;
    }
    if (magicIndex + 8 + length > buffer.length) {
      offset = magicIndex;
      break;
    }
    const body = buffer.subarray(magicIndex + 8, magicIndex + 8 + length);
    frames.push({
      command: body.readUInt16LE(0),
      session: body.readUInt16LE(4),
      reply: body.readUInt16LE(6),
      data: Buffer.from(body.subarray(8)),
    });
    offset = magicIndex + 8 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}
