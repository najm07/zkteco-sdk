/**
 * Probe the legacy attendance and free-size commands.
 *
 * The `transaction` table read returns no rows while the device reports 541
 * records, and the vendor shim behaves the same way — so punches must be pulled
 * through the legacy cursor instead. Command 13 (`ATTLOG_RRQ`) is the classic
 * entry point, and command 50 (`GET_FREE_SIZES`) reports the counters.
 *
 * Nothing here is destructive: neither command deletes or clears anything.
 *
 * Usage: node scripts/probe-attlog.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 15_000 });

const hex = (b: Buffer, limit = 96): string =>
  b.length === 0 ? '(empty)' : b.subarray(0, limit).toString('hex') + (b.length > limit ? '…' : '');

const words = (payload: Buffer): string => {
  const out: string[] = [];
  for (let i = 0; i + 4 <= payload.length; i += 4) out.push(String(payload.readUInt32LE(i)));
  return out.join(', ');
};

try {
  await device.connect();
  console.log('connected');

  for (const [label, command, data] of [
    ['GET_FREE_SIZES', 50, undefined],
    ['ATTLOG_RRQ', 13, undefined],
    ['ATTLOG_RRQ with 4-byte zero', 13, Buffer.alloc(4)],
  ] as const) {
    try {
      const reply = await device.sendRaw(command, data);
      console.log(`${label} (${command}) -> ack ${reply.ack}, ${reply.payload.length} bytes`);
      console.log(`  hex: ${hex(reply.payload)}`);
      if (reply.payload.length > 0) console.log(`  u32: ${words(reply.payload)}`);
    } catch (error) {
      console.log(`${label} (${command}) -> FAILED: ${error instanceof Error ? error.message : error}`);
    }
  }
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
