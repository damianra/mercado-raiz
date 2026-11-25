import 'dotenv/config';
import { closeDb, openDb, seedIfEmpty } from './db.js';
import { seedData } from './seed-data.js';
import { seedLotes } from './seed-lotes.js';
import { seedVentas } from './seed-ventas.js';

// Re-seed (SPEC-25): vacía las tablas del dominio y las repuebla con
// seed-data.js vía seedIfEmpty (schema.sql ya corrió en openDb).
// RESTART IDENTITY reinicia las secuencias; CASCADE resuelve las FKs.
const db = await openDb();
const tablas = [
  'lotes', // desglose físico del stock (SPEC-33) — explícita para
  // el reporte; el CASCADE de productos ya la vaciaría igual.
  'alertas', // derivadas del dominio — el CASCADE ya las vacía,
  'alertas_meta', // pero la meta no tiene FKs: sin esto la lazy-eval
  // ve ultima_eval reciente y nunca regenera alertas tras el re-seed
  'ventas',
  'refresh_tokens',
  'historial_stock',
  'ordenes_compra',
  'producto_proveedor',
  'productos',
  'usuarios',
  'proveedores',
];
await db.query(`TRUNCATE ${tablas.join(', ')} RESTART IDENTITY CASCADE`);

for (const [table, rows] of Object.entries(seedData)) {
  await seedIfEmpty(db, table, rows);
}
await seedVentas(db); // generadas, no vienen en seedData
await seedLotes(db); // SPEC-33: desglose del stock en lotes
for (const table of [...Object.keys(seedData), 'ventas', 'lotes']) {
  const { c } = await db.get(`SELECT COUNT(*) AS c FROM ${table}`);
  console.log(`${table}: ${c} filas`);
}
console.log('seed ok → mercadoraiz-db');
await closeDb();
