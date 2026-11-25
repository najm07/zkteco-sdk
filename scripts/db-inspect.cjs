/**
 * Inspect the vendor app's SQLite database to learn how it stores what the
 * device returns. Read-only.
 *
 * Usage: node scripts/db-inspect.cjs "C:/Program Files (x86)/ZKBio Time.Net/TimeNet.db"
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2];
const db = new DatabaseSync(file, { readOnly: true });

const tables = db
  .prepare("select name from sqlite_master where type='table' order by name")
  .all()
  .map((t) => t.name);

console.log(`tables (${tables.length}):`);
console.log(tables.join(', '));

const wanted = tables.filter((name) => /bio|template|att|trans|employee|user|log/i.test(name));
console.log(`\nmatching tables: ${wanted.join(', ')}`);

for (const name of wanted) {
  const info = db.prepare(`pragma table_info(${JSON.stringify(name)})`).all();
  const count = db.prepare(`select count(*) c from ${JSON.stringify(name)}`).get().c;
  console.log(`\n== ${name} (${count} rows)`);
  console.log(
    info.map((c) => `${c.name}:${c.type}${c.pk ? ' PK' : ''}`).join(', '),
  );
}
