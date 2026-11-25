/**
 * Reconcile biometric chunk rows against the device's own counters.
 *
 * `pers_biotemplate` is a chunked store: one enrolled template is spread over
 * several rows that share a Pin/Type and differ by Index. GET_RECORD_COUNT
 * counts templates, while READ_TABLE returns chunks, so the two numbers must be
 * interpreted together.
 *
 * Usage: node scripts/biometric-audit.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 30_000 });

try {
  await device.connect();

  const rows = await device.readTable('pers_biotemplate');
  console.log(`chunk rows: ${rows.length}`);
  console.log(`count() all: ${await device.count('pers_biotemplate')}`);

  const byType = new Map<number, number>();
  const byPin = new Map<string, number>();
  const templates = new Set<string>();
  const chunkSizes = new Map<number, number>();

  for (const row of rows) {
    const type = Number(row.Type);
    const pin = String(row.Pin);
    byType.set(type, (byType.get(type) ?? 0) + 1);
    byPin.set(pin, (byPin.get(pin) ?? 0) + 1);
    templates.add(`${pin}:${type}`);
    const size = Buffer.isBuffer(row.Tmp) ? row.Tmp.length : 0;
    chunkSizes.set(size, (chunkSizes.get(size) ?? 0) + 1);
  }

  console.log(`distinct pins: ${byPin.size}`);
  console.log(`distinct (pin,type) templates: ${templates.size}`);
  console.log('rows by type:', Object.fromEntries([...byType].sort((a, b) => a[0] - b[0])));
  console.log('chunk size histogram:', Object.fromEntries([...chunkSizes].sort((a, b) => a[0] - b[0])));

  for (const type of [...byType.keys()].sort((a, b) => a - b)) {
    const reported = await device.count('pers_biotemplate', `Type=${type}`);
    const rowsOfType = byType.get(type)!;
    const templatesOfType = [...templates].filter((t) => t.endsWith(`:${type}`)).length;
    console.log(
      `type ${type}: count()=${reported} templates=${templatesOfType} rows=${rowsOfType}`,
    );
  }

  const chunksPerTemplate = new Map<number, number>();
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.Pin}:${row.Type}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  for (const n of grouped.values()) chunksPerTemplate.set(n, (chunksPerTemplate.get(n) ?? 0) + 1);
  console.log('chunks per template histogram:', Object.fromEntries([...chunksPerTemplate].sort((a, b) => a[0] - b[0])));

  const one = await device.readTable('pers_biotemplate', { filter: 'Pin=1\tType=2' });
  console.log(`Pin=1 Type=2 chunks: ${one.length}`);
  for (const row of one) {
    console.log('  index', row.Index, 'bytes', Buffer.isBuffer(row.Tmp) ? row.Tmp.length : 0,
      'head', Buffer.isBuffer(row.Tmp) ? row.Tmp.subarray(0, 6).toString('hex') : '');
  }
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
