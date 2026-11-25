/**
 * Step-by-step write probe on a harmless table.
 *
 * Sends PREPARE_DATA / DATA / COMMIT individually so a failure names the step
 * instead of surfacing as a dropped socket.
 *
 * Usage: node scripts/probe-write.ts [host] [table]
 */
import { ZkDevice } from '../src/ZkDevice.ts';
import { Command } from '../src/protocol/commands.ts';
import { encodeRow } from '../src/protocol/records.ts';

const host = process.argv[2] ?? '192.168.1.100';
const tableName = process.argv[3] ?? 'workcode';

const device = new ZkDevice({ host, timeoutMs: 20_000 });

const rowsFor = (table: { columns: string[] }): Array<Record<string, string>> => {
  if (table.columns[0] === 'WC_Code') return [{ WC_Code: 'W42', WC_Name: 'probe' }];
  if (table.columns[0] === 'ID') {
    return [{ ID: '1', StartTime: '', ValidTime: '0', Type: '0', Content: 'probe' }];
  }
  return [{ [table.columns[0]!]: '1' }];
};

const label = (ack: number): string => (ack === 2000 ? 'ACK_OK' : `ack ${ack}`);

try {
  await device.connect();
  const table = await device.table(tableName);
  console.log(`${tableName}: ${table.columns.map((c, i) => `${c}=${table.types[i]}`).join(', ')}`);
  console.log(`rows before: ${(await device.readTable(tableName)).length}`);

  const rows = rowsFor(table);
  const body = Buffer.concat([Buffer.from([table.id, rows.length]), ...rows.map((r) => encodeRow(r, table))]);
  console.log(`payload (${body.length} bytes): ${body.toString('hex')}`);

  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length, 0);

  const prepare = await device.sendRaw(Command.PREPARE_DATA, size);
  console.log(`1. PREPARE_DATA -> ${label(prepare.ack)} ${prepare.payload.toString('hex')}`);

  const data = await device.sendRaw(Command.DATA, body);
  console.log(`2. DATA -> ${label(data.ack)} ${data.payload.toString('hex')}`);

  const commit = await device.sendRaw(Command.WRITE_COMMIT);
  console.log(`3. COMMIT -> ${label(commit.ack)} ${commit.payload.toString('hex')} (${commit.payload.readUInt32LE?.(0)})`);

  const refresh = await device.sendRaw(Command.WRITE_REFRESH);
  console.log(`4. REFRESH -> ${label(refresh.ack)} ${refresh.payload.toString('hex')}`);

  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await device.readTable(tableName);
  console.log(`rows after: ${after.length}`);
  for (const row of after.slice(0, 5)) {
    console.log(
      '  ',
      Object.entries(row)
        .map(([k, v]) => `${k}=${Buffer.isBuffer(v) ? `0x${v.toString('hex')}` : String(v)}`)
        .join(' '),
    );
  }

  if (after.length > 0) {
    const key = table.columns[0]!;
    const filter = tableName === 'workcode' ? 'WC_Code=W42' : tableName === 'sms' ? 'ID=1' : `${key}=1`;
    await device.deleteRows(tableName, filter);
    await new Promise((resolve) => setTimeout(resolve, 400));
    console.log(`rows after cleanup: ${(await device.readTable(tableName)).length}`);
  }
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
