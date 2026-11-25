/**
 * Inspect the vendor app's device-push queues. Read-only.
 *
 * Usage: node scripts/db-queue.cjs "C:/Program Files (x86)/ZKBio Time.Net/TimeNet.db"
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.argv[2], { readOnly: true });

for (const name of ['Pushqueue', 'zkproto_sync_queue', 'zkproto_control_queue']) {
  const info = db.prepare(`pragma table_info(${JSON.stringify(name)})`).all();
  const count = db.prepare(`select count(*) c from ${JSON.stringify(name)}`).get().c;
  console.log(`\n== ${name} (${count} rows)`);
  console.log(info.map((c) => `${c.name}:${c.type}`).join(', '));
  if (count > 0) {
    const rows = db.prepare(`select * from ${JSON.stringify(name)} limit 5`).all();
    for (const row of rows) {
      const trimmed = {};
      for (const [k, v] of Object.entries(row)) {
        trimmed[k] = typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}… (${v.length} chars)` : v;
      }
      console.log('  ', JSON.stringify(trimmed));
    }
  }
}
