import pg from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedData } from './seed-data.js';
import { seedHistorial } from './seed-historial.js';
import { seedLotes } from './seed-lotes.js';
import { seedVentas } from './seed-ventas.js';

const { Pool } = pg;

// COUNT(*) y SUM(int) vuelven como bigint → node-pg los devuelve
// string. Los parseamos a number: el dominio nunca supera 2^53.
pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // int8

const here = dirname(fileURLToPath(import.meta.url));
let state; // { pool, prepare, get, all, run, tx }
let opening; // promise memoizada — evita dobles pools en imports concurrentes

const esTest = () => process.env.VITEST || process.env.NODE_ENV === 'test';

// Conexión: en test gana DATABASE_URL_TEST y el default apunta a la
// base hermana -test (nunca al dev DB); en runtime gana DATABASE_URL.
export function connectionString() {
  // `||` y no `??`: un .env con `DATABASE_URL=` vacía debe caer al
  // default, no entregar '' al Pool (que caería a defaults libpq).
  if (esTest()) {
    return (
      process.env.DATABASE_URL_TEST ||
      'postgres://mercadoraiz:dev-local-2026@localhost:5432/mercadoraiz-db-test'
    );
  }
  return (
    process.env.DATABASE_URL ||
    'postgres://mercadoraiz:dev-local-2026@localhost:5432/mercadoraiz-db'
  );
}

// Solo identificadores seguros como nombre de schema (tests).
const IDENT_RE = /^[a-z][a-z0-9_]*$/;

// Traduce placeholders '?' (estilo SQLite, que usan los modelos) a
// '$1..$n'. Respeta literales entre comillas simples — un '?' dentro
// de un string SQL no es placeholder.
// Limitación conocida: no reconoce '?' dentro de comentarios SQL,
// identificadores "...", dollar-quoting ni el operador jsonb ? —
// ninguna query del dominio usa esas formas; si apareciera una,
// escribir el $n literal y no pasar por prepare/run/get.
function aPostgres(sql) {
  let i = 0;
  let out = '';
  let enComilla = false;
  for (const ch of sql) {
    if (ch === "'") enComilla = !enComilla;
    out += ch === '?' && !enComilla ? `$${++i}` : ch;
  }
  return out;
}

const wrap = (queryFn) => ({
  query: (sql, params = []) => queryFn(aPostgres(sql), params),
  prepare: (sql) => {
    const pgSql = aPostgres(sql);
    return {
      get: async (...params) => (await queryFn(pgSql, params)).rows[0],
      all: async (...params) => (await queryFn(pgSql, params)).rows,
      // INSERT con RETURNING devuelve sus filas en `rows`; `changes`
      // es rowCount (equivalente al changes de better-sqlite3).
      run: async (...params) => {
        const r = await queryFn(pgSql, params);
        return { changes: r.rowCount, rows: r.rows, lastInsertRowid: r.rows[0]?.id };
      },
    };
  },
  get: async (sql, params = []) => (await queryFn(aPostgres(sql), params)).rows[0],
  all: async (sql, params = []) => (await queryFn(aPostgres(sql), params)).rows,
  run: async (sql, params = []) => {
    const r = await queryFn(aPostgres(sql), params);
    return { changes: r.rowCount, rows: r.rows, lastInsertRowid: r.rows[0]?.id };
  },
});

/**
 * Pool singleton sobre Postgres. `openDb()` abre el pool, aplica
 * schema.sql (idempotente) y corre el seed de las tablas vacías.
 *
 * Tests: `openDb({ searchPath: 't_xxx' })` crea/usa un schema
 * aislado dentro de mercadoraiz-db-test — el equivalente al viejo
 * ':memory:' por archivo. `closeDb(true)` lo dropea.
 */
export async function openDb({ searchPath, connString, sembrar = true, sembrarVentas } = {}) {
  if (state) return state;
  opening ??= (async () => {
    if (searchPath && !IDENT_RE.test(searchPath)) {
      throw new Error(`searchPath inválido: ${searchPath}`);
    }
    const pool = new Pool({
      connectionString: connString ?? connectionString(),
      ...(searchPath ? { options: `-c search_path=${searchPath}` } : {}),
    });
    // Lock de DDL (advisory, cluster-wide): los tests abren schemas
    // paralelos y closeDb los dropea con CASCADE — un DROP concurrente
    // puede tumbar el schema.sql de otra sesión ("could not open
    // relation with OID" al resolver constraints en pg_constraint).
    // El lock serializa DDL inicial y drops entre todos los pools.
    // En prod es no-op práctico (un solo pool, un solo openDb).
    const DDL_LOCK_KEY = 0x4d524c44; // 'MRLD'
    const ddlClient = await pool.connect();
    try {
      await ddlClient.query('SELECT pg_advisory_lock($1)', [DDL_LOCK_KEY]);
      if (searchPath) {
        await ddlClient.query(`CREATE SCHEMA IF NOT EXISTS ${searchPath}`);
      }
      const schemaPath = join(here, 'schema.sql');
      if (existsSync(schemaPath)) {
        await ddlClient.query(readFileSync(schemaPath, 'utf8'));
      }
    } finally {
      try {
        await ddlClient.query('SELECT pg_advisory_unlock($1)', [DDL_LOCK_KEY]);
      } finally {
        ddlClient.release();
      }
    }
    const db = { pool, ...wrap(pool.query.bind(pool)) };
    db.tx = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn(wrap(client.query.bind(client)));
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };
    if (sembrar) {
      for (const [table, rows] of Object.entries(seedData)) {
        await seedIfEmpty(db, table, rows);
      }
      // ventas se generan (no vienen en seedData): dependen del
      // catálogo ya poblado — por eso van después del loop. En
      // schemas de test se saltea por defecto (~60k filas por
      // schema sería lento); los tests siembran fixtures propias.
      // SPEC-30 (T30.3): el historial se deriva de las ventas —
      // mismo path, mismo criterio de salteo en test.
      // SPEC-33 (T33.1): los lotes se derivan del stock sembrado —
      // mismo path, mismo salteo (los tests siembran fixtures).
      if (sembrarVentas ?? !searchPath) {
        await seedVentas(db);
        await seedHistorial(db);
        await seedLotes(db);
      }
    }
    state = db;
    return state;
  })();
  // Un openDb fallido no debe envenenar el singleton: sin el reset,
  // los próximos llamados re-tiran la misma promesa rechazada para
  // siempre y el pool parcial queda leaked.
  opening.catch(() => {
    opening = undefined;
  });
  return opening;
}

export async function seedIfEmpty(db, table, rows) {
  if (!rows?.length) return;
  const { c } = await db.get(`SELECT COUNT(*) AS c FROM ${table}`);
  if (c > 0) return;
  const cols = Object.keys(rows[0]);
  await db.tx(async (t) => {
    // El stmt se crea sobre el CLIENTE de la tx — prepararlo con
    // db.prepare correría por el pool, fuera del BEGIN/COMMIT.
    const stmt = t.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    );
    for (const row of rows) await stmt.run(...cols.map((col) => row[col]));
    // Los seeds traen ids explícitos — IDENTITY no avanza con
    // valores manuales; hay que dejar la secuencia en MAX(id) o el
    // próximo insert sin id choca con las filas sembradas.
    if (cols.includes('id')) {
      await t.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), MAX(id)) FROM ${table}`,
      );
    }
  });
}

export async function closeDb(dropSchema = false) {
  const db = state ?? (await opening);
  if (!db) return;
  const options = db.pool.options?.options ?? '';
  state = undefined;
  opening = undefined;
  if (dropSchema) {
    const schema = options.match(/search_path=(\S+)/)?.[1];
    if (schema && IDENT_RE.test(schema)) {
      // Mismo lock de DDL que openDb: el DROP CASCADE compite con
      // el schema.sql de otro archivo de test en paralelo.
      const DDL_LOCK_KEY = 0x4d524c44; // 'MRLD'
      const client = await db.pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [DDL_LOCK_KEY]);
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [DDL_LOCK_KEY]);
        } finally {
          client.release();
        }
      }
    }
  }
  await db.pool.end();
}
