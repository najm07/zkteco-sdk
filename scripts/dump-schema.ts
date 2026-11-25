/**
 * Print the device's raw table schema, exactly as it sends it.
 *
 * Reading the schema out loud beats inferring it from a decode that drifts.
 *
 * Usage: node scripts/dump-schema.cjs [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 20_000 });

try {
  await device.connect();
  const raw = await device.rawSchemaText();
  console.log(`schema payload: ${raw.length} chars`);
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim()) console.log(`  ${JSON.stringify(line)}`);
  }
} finally {
  await device.disconnect().catch(() => {});
}
