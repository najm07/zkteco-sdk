/**
 * Classify `pers_biotemplate` bio types by the shape of their chunk streams.
 *
 * Face templates are large (≈19 KB) and use 2016-byte chunks. Palm and
 * fingerprint templates are far smaller, so the chunk count and payload size
 * identify which is which.
 *
 * Usage: node scripts/bio-types.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 30_000 });

try {
  await device.connect();
  const rows = await device.readTable('pers_biotemplate');

  const templates = new Map<string, { type: number; chunks: Buffer[] }>();
  for (const row of rows) {
    const key = `${row.Pin}:${row.Type}`;
    const entry = templates.get(key) ?? { type: Number(row.Type), chunks: [] };
    entry.chunks.push(row.Tmp as Buffer);
    templates.set(key, entry);
  }

  const byType = new Map<
    number,
    { templates: number; chunkCounts: Map<number, number>; payloadSizes: number[]; chunkSizes: Map<number, number> }
  >();

  for (const { type, chunks } of templates.values()) {
    const entry: {
      templates: number;
      chunkCounts: Map<number, number>;
      payloadSizes: number[];
      chunkSizes: Map<number, number>;
    } = byType.get(type) ?? {
      templates: 0,
      chunkCounts: new Map<number, number>(),
      payloadSizes: [],
      chunkSizes: new Map<number, number>(),
    };
    entry.templates += 1;
    entry.chunkCounts.set(chunks.length, (entry.chunkCounts.get(chunks.length) ?? 0) + 1);
    entry.payloadSizes.push(chunks.reduce((sum, c) => sum + Math.max(0, c.length - 6), 0));
    for (const c of chunks) entry.chunkSizes.set(c.length, (entry.chunkSizes.get(c.length) ?? 0) + 1);
    byType.set(type, entry);
  }

  for (const [type, entry] of [...byType].sort((a, b) => a[0] - b[0])) {
    const sizes = [...entry.payloadSizes].sort((a, b) => a - b);
    const min = sizes[0];
    const max = sizes[sizes.length - 1];
    const median = sizes[Math.floor(sizes.length / 2)];
    console.log(`\ntype ${type}: ${entry.templates} templates`);
    console.log('  chunks per template:', Object.fromEntries([...entry.chunkCounts].sort((a, b) => a[0] - b[0])));
    console.log('  chunk sizes:', Object.fromEntries([...entry.chunkSizes].sort((a, b) => a[0] - b[0])));
    console.log(`  payload bytes (median ${median}, min ${min}, max ${max})`);
    const first = templates.values().next().value as { type: number; chunks: Buffer[] } | undefined;
    if (first && first.type === type) {
      console.log('  sample chunk head:', first.chunks[0]!.subarray(0, 12).toString('hex'));
    }
  }
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
