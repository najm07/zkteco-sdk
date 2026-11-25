/**
 * Compare the vendor app's stored biometric chunks with what the device
 * returns, to prove the field mapping the HRMS integration will rely on.
 *
 * Usage: node scripts/compare-db.ts "C:/Program Files (x86)/ZKBio Time.Net/TimeNet.db" [host] [pin]
 */
import { DatabaseSync } from 'node:sqlite';

import { ZkDevice } from '../src/ZkDevice.ts';

const dbPath = process.argv[2] ?? 'C:/Program Files (x86)/ZKBio Time.Net/TimeNet.db';
const host = process.argv[3] ?? '192.168.1.100';
const pin = process.argv[4] ?? '1';

const db = new DatabaseSync(dbPath, { readOnly: true });

const byType = db
  .prepare('select bio_type, count(*) c from hr_biotemplate group by bio_type order by bio_type')
  .all() as Array<{ bio_type: number; c: number }>;
console.log('hr_biotemplate rows by bio_type:', byType);

const employee = db
  .prepare('select id, emp_pin from hr_employee where emp_pin = ?')
  .get(pin) as { id: number; emp_pin: string } | undefined;
if (!employee) throw new Error(`no employee with pin ${pin} in the app db`);
console.log(`employee ${pin} -> id ${employee.id}`);

const stored = db
  .prepare(
    'select bio_type, template_no_index, size, template_data from hr_biotemplate where employee_id = ? order by bio_type, template_no_index',
  )
  .all(employee.id) as Array<{
  bio_type: number;
  template_no_index: number;
  size: number;
  template_data: string;
}>;

console.log(`stored chunks for pin ${pin}: ${stored.length}`);
for (const row of stored.slice(0, 4)) {
  const bytes = Buffer.from(row.template_data, 'base64');
  console.log(
    `  type ${row.bio_type} index ${row.template_no_index} size ${row.size} chars ${row.template_data.length} decoded ${bytes.length} head ${bytes.subarray(0, 8).toString('hex')}`,
  );
}

const device = new ZkDevice({ host, timeoutMs: 30_000 });
try {
  await device.connect();
  const rows = await device.readTable('pers_biotemplate', { filter: `Pin=${pin}` });
  console.log(`device chunks for pin ${pin}: ${rows.length}`);

  let compared = 0;
  let identical = 0;
  for (const row of rows) {
    const type = Number(row.Type);
    const index = Number(row.Index);
    const tmp = row.Tmp as Buffer;
    const match = stored.find((s) => s.bio_type === type && s.template_no_index === index);
    if (!match) continue;
    compared += 1;
    const storedBytes = Buffer.from(match.template_data, 'base64');
    const same = storedBytes.equals(tmp);
    if (same) identical += 1;
    if (compared <= 5) {
      console.log(
        `  type ${type} index ${index}: device ${tmp.length}B db ${storedBytes.length}B size ${match.size} identical=${same}`,
      );
      if (!same) {
        console.log(`    device head ${tmp.subarray(0, 12).toString('hex')}`);
        console.log(`    db     head ${storedBytes.subarray(0, 12).toString('hex')}`);
      }
    }
  }
  console.log(`compared ${compared} chunks, byte-identical ${identical}`);
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
  db.close();
}
