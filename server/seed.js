import 'dotenv/config';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { seedData } from './seed-data.js';

// Re-seed: borra la base local y la recrea con el seed de seed-data.js
// (openDb aplica schema.sql + seedIfEmpty por tabla).
const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, 'app.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(dbPath + suffix, { force: true });
}

const db = openDb(dbPath);
for (const table of Object.keys(seedData)) {
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  console.log(`${table}: ${c} filas`);
}
console.log(`seed ok → ${dbPath}`);
