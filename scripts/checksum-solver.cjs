/**
 * Checksum verification for the ZKTeco standalone ("SSR") protocol.
 *
 * Frame layout, established from a live device:
 *
 *   0..3    magic   50 50 82 7d
 *   4..7    length  uint32 LE, byte length of everything after this field
 *   8..9    command uint16 LE
 *   10..11  checksum uint16 LE
 *   12..13  session uint16 LE
 *   14..15  reply   uint16 LE
 *   16..    data
 *
 * Checksum is the 16-bit one's complement of the sum of 16-bit little-endian
 * words over command, session, reply and data (checksum, length and magic are
 * excluded), with end-around carry.
 */
'use strict';

const MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);

const frames = [
  '5050827d08000000e80317fc00000000',
  '5050827d0c0000004e048aa47aad01003c206f89',
  '5050827d130000000c00b9cc7aad020053444b4275696c643d3100',
  '5050827d160000000b00d1f77aad04005a4b4661636556657273696f6e00',
  '5050827d080000004c04344e7aad0500',
  '5050827d0a0000004500165f7aad060023f3',
  '5050827d0800000010276e2b7aad0700',
  '5050827d1b0000000b00f8b37aad08004d61736b446574656374696f6e46756e4f6e00',
  '5050827d1d0000000b00ad587aad0900495254656d70446574656374696f6e46756e4f6e00',
  '5050827d08000000e903924e7aad0a00',
  '5050827d08000000d507b04a7aad0000',
  '5050827d08000000d007b44a7aad0100',
  '5050827d08000000d007b34a7aad0200',
  '5050827d19000000d007db807aad04005a4b4661636556657273696f6e3d313200',
  '5050827d1d000000d00736e67aad050056657220362e3630204e6f76203231203230313900',
  '5050827d09000000d007a64a7aad060009',
];

function checksum(command, session, reply, data) {
  const words = [command, session, reply];
  for (let i = 0; i < data.length; i += 2) {
    words.push(data[i] | ((data[i + 1] ?? 0) << 8));
  }
  let sum = 0;
  for (const w of words) {
    sum += w;
    if (sum > 0xffff) sum = (sum & 0xffff) + 1;
  }
  return ~sum & 0xffff;
}

let ok = 0;
for (const hex of frames) {
  const buf = Buffer.from(hex, 'hex');
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error(`bad magic: ${hex}`);
  const declared = buf.readUInt32LE(4);
  if (declared !== buf.length - 8) throw new Error(`length mismatch: ${hex}`);
  const command = buf.readUInt16LE(8);
  const stored = buf.readUInt16LE(10);
  const session = buf.readUInt16LE(12);
  const reply = buf.readUInt16LE(14);
  const data = buf.subarray(16);
  const computed = checksum(command, session, reply, data);
  const pass = computed === stored;
  if (pass) ok += 1;
  console.log(
    `${pass ? 'OK  ' : 'FAIL'} cmd=${String(command).padStart(5)} sid=0x${session
      .toString(16)
      .padStart(4, '0')} reply=${reply} len=${data.length} stored=0x${stored
      .toString(16)
      .padStart(4, '0')} computed=0x${computed.toString(16).padStart(4, '0')}`,
  );
}
console.log(`\n${ok}/${frames.length} frames verified`);
process.exit(ok === frames.length ? 0 : 1);
