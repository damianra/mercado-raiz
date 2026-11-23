import 'dotenv/config';
import { closeDb, openDb, seedIfEmpty } from './db.js';
import { seedData } from './seed-data.js';
import { seedVentas } from './seed-ventas.js';

// Re-seed (SPEC-25): vacía las tablas del dominio y las repuebla con
// seed-data.js vía seedIfEmpty (schema.sql ya corrió en openDb).
// RESTART IDENTITY reinicia las secuencias; CASCADE resuelve las FKs.
const db = await openDb();
const tablas = [
  'ventas',
  'refresh_tokens',
  'historial_stock',
  'ordenes_compra',
  'productos',
  'usuarios',
  'proveedores',
];
await db.query(`TRUNCATE ${tablas.join(', ')} RESTART IDENTITY CASCADE`);

for (const [table, rows] of Object.entries(seedData)) {
  await seedIfEmpty(db, table, rows);
}
await seedVentas(db); // generadas, no vienen en seedData
for (const table of [...Object.keys(seedData), 'ventas']) {
  const { c } = await db.get(`SELECT COUNT(*) AS c FROM ${table}`);
  console.log(`${table}: ${c} filas`);
}
console.log('seed ok → mercadoraiz-db');
await closeDb();
