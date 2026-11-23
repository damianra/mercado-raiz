/**
 * Migración de corte sqlite → Postgres (SPEC-25, T25.4).
 *
 *   node server/migrate-sqlite-to-pg.js [ruta/a/app.sqlite]
 *
 * Default de origen: `server/app.sqlite`. Destino: `DATABASE_URL`
 * (default = el compose dev, `mercadoraiz-db`).
 *
 * Qué hace:
 *  - Lee la base vieja con `node:sqlite` (nativo, cero deps extra).
 *  - Aplica schema.sql al destino SIN seed (`openDb({sembrar:false})`)
 *    — el seed solo corre si no se migró nada.
 *  - Copia, en orden de FK: proveedores → productos → usuarios →
 *    ordenes_compra → historial_stock. Solo columnas que existen en
 *    ambos schemas (un sqlite anterior a `marca`/`ean` migra igual;
 *    las columnas nuevas quedan en su default PG).
 *  - NO migra `refresh_tokens`: los usuarios vuelven a loguear.
 *    Los `password_hash` SÍ se preservan (mismas credenciales).
 *  - Fechas: sqlite guardaba 'YYYY-MM-DD HH:MM:SS' en UTC naive; la
 *    sesión de migración fija `TIME ZONE 'UTC'` para que caigan como
 *    timestamptz correcto y no corridas por la TZ local.
 *  - Todo en UNA transacción: si algo falla, el destino queda como
 *    estaba (idempotente por construcción — destino vacío o aborta).
 *  - Termina con un reporte de validación: count por tabla origen
 *    vs destino + muestras.
 *
 * Aborta si el destino ya tiene datos en las tablas del dominio —
 * la migración es un corte único, no un merge.
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDb, closeDb } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const rutaSqlite = resolve(process.argv[2] ?? join(here, 'app.sqlite'));

// Orden de dependencias FK. refresh_tokens queda afuera a propósito.
const TABLAS = ['proveedores', 'productos', 'usuarios', 'ordenes_compra', 'historial_stock'];

if (!existsSync(rutaSqlite)) {
  console.log(`No existe ${rutaSqlite} — nada que migrar.`);
  process.exit(0);
}

const sqlite = new DatabaseSync(rutaSqlite, { readOnly: true });
// Schema PG (sin seed): la migración puebla, no el seed.
const db = await openDb({ sembrar: false }).catch((e) => {
  console.error(`No pude conectar al Postgres destino: ${e.message}`);
  process.exit(1);
});

const filasDe = (t) => sqlite.prepare(`SELECT * FROM ${t}`).all();
const colsPg = async (t) => new Set(
  (await db.all(
    `SELECT column_name AS c FROM information_schema.columns
     WHERE table_name = ? AND table_schema = current_schema()`, [t],
  )).map((r) => r.c),
);

try {
  // Guard de corte único: el destino debe estar vacío.
  for (const t of TABLAS) {
    const { c } = await db.get(`SELECT COUNT(*)::int AS c FROM ${t}`);
    if (c > 0) {
      console.error(`ABORTA: la tabla ${t} ya tiene ${c} filas — la migración es un corte único. ` +
        `Vacía el destino (npm run seed corre TRUNCATE+seed, o hacelo a mano) y reintentá.`);
      process.exit(1);
    }
  }

  const resumen = await db.tx(async (t) => {
    // Los 'YYYY-MM-DD HH:MM:SS' de sqlite son UTC naive — sin esto
    // PG los parsea en la TZ del servidor y los timestamps corren.
    await t.query(`SET LOCAL TIME ZONE 'UTC'`);
    const out = [];
    for (const tabla of TABLAS) {
      const filas = filasDe(tabla);
      if (!filas.length) { out.push([tabla, 0, 0]); continue; }
      const colsDestino = await colsPg(tabla);
      const cols = Object.keys(filas[0]).filter((c) => colsDestino.has(c));
      const stmt = t.prepare(
        `INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      );
      for (const fila of filas) await stmt.run(...cols.map((c) => fila[c]));
      if (cols.includes('id')) {
        await t.query(
          `SELECT setval(pg_get_serial_sequence('${tabla}', 'id'), MAX(id)) FROM ${tabla}`,
        );
      }
      out.push([tabla, filas.length, null]);
    }
    return out;
  });

  // Validación post-commit: counts + muestra representativa.
  console.log('\nMigración completa — validación:');
  let ok = true;
  for (const [tabla, origen] of resumen) {
    const { c: destino } = await db.get(`SELECT COUNT(*)::int AS c FROM ${tabla}`);
    const marca = destino === origen ? 'OK ' : 'FALLO';
    if (destino !== origen) ok = false;
    console.log(`  ${marca} ${tabla}: sqlite=${origen} → pg=${destino}`);
  }
  // Muestras: primer producto y primer usuario, campos clave.
  const p = await db.get(`SELECT sku, ean, precio_unitario FROM productos ORDER BY id LIMIT 1`);
  const u = await db.get(`SELECT email, rol, password_hash IS NOT NULL AS tiene_hash FROM usuarios ORDER BY id LIMIT 1`);
  console.log(`  muestra producto: ${JSON.stringify(p)}`);
  console.log(`  muestra usuario : ${JSON.stringify(u)}`);
  const { c: tokens } = await db.get(`SELECT COUNT(*)::int AS c FROM refresh_tokens`);
  console.log(`  refresh_tokens  : ${tokens} (no se migran — re-login requerido)`);
  if (!ok) { console.error('\nFALLO: counts no coinciden — revisar.'); process.exitCode = 1; }
  else console.log('\nCorte listo: apuntar la app a DATABASE_URL y borrar el .sqlite viejo.');
} catch (e) {
  console.error(`\nMigración abortada (rollback — destino intacto): ${e.message}`);
  process.exitCode = 1;
} finally {
  sqlite.close();
  await closeDb();
}
