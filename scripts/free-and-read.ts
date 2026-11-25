/**
 * Measure a table read, optionally freeing the device's data buffer first.
 *
 * Usage: node scripts/free-and-read.ts [host] [table]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const table = process.argv[3] ?? 'user';
const device = new ZkDevice({ host, timeoutMs: 300_000 });

try {
  await device.connect();
  const free = await device.sendRaw(1502);
  console.log(`FREE_DATA -> ack=${free.ack} len=${free.payload.length}`);
  const started = Date.now();
  const rows = await device.readTable(table);
  console.log(`${table}: rows=${rows.length} in ${Date.now() - started}ms`);
} finally {
  await device.disconnect().catch(() => {});
}
