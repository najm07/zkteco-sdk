/**
 * Capture and decode the legacy attendance log (command 13).
 *
 * `readTable('transaction')` returns nothing while the device reports 541
 * records, but `ATTLOG_RRQ` returns 21,644 bytes: 541 records of 40 bytes after
 * a 4-byte declared length. This script saves the raw payload and shows how the
 * fields line up so the layout can be stated rather than guessed.
 *
 * Reading this log does not delete anything — two consecutive requests returned
 * identical bytes.
 *
 * Usage: node scripts/probe-attlog-decode.ts [host]
 */
import { writeFileSync } from 'node:fs';

import { decodeDateTime } from '../src/protocol/time.ts';
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 20_000 });

const printable = (b: Buffer): string =>
  [...b].map((c) => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.')).join('');

try {
  await device.connect();
  const first = await device.sendRaw(13);
  const second = await device.sendRaw(13);
  console.log(`ATTLOG_RRQ -> ${first.payload.length} bytes (stable: ${first.payload.equals(second.payload)})`);

  writeFileSync('C:/Users/mehdi/AppData/Local/Temp/opencode/attlog.bin', first.payload);

  const declared = first.payload.readUInt32LE(0);
  console.log(`declared length: ${declared}, payload: ${first.payload.length}`);
  const body = first.payload.subarray(4);
  const strides = [16, 32, 40, 64].filter((s) => body.length % s === 0);
  console.log(`body ${body.length} bytes; exact strides: ${strides.join(', ') || 'none'}`);

  const stride = strides[0] ?? 40;
  const count = Math.floor(body.length / stride);
  console.log(`stride ${stride} -> ${count} records`);

  for (let i = 0; i < 3; i += 1) {
    const rec = body.subarray(i * stride, (i + 1) * stride);
    console.log(`\nrecord ${i} (${stride} bytes)`);
    console.log(`  hex  ${rec.toString('hex')}`);
    console.log(`  text ${printable(rec)}`);
    for (let off = 0; off + 4 <= stride; off += 4) {
      const u32 = rec.readUInt32LE(off);
      let time = '';
      if (u32 > 1_000_000 && u32 < 10_000_000) {
        try {
          time = ` (as time: ${decodeDateTime(u32).toISOString()})`;
        } catch {
          time = ' (not a valid time)';
        }
      }
      console.log(`  +${String(off).padStart(2)}  u32 ${String(u32).padStart(10)}  u16 ${rec.readUInt16LE(off)}${time}`);
    }
  }
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
