/**
 * Pool Postgres compartido del harness (SPEC-25, T25.3): lo usan el
 * cache de análisis y el checkpointer de LangGraph — ambos contra la
 * misma `mercadoraiz-db` que el backend. Las métricas NO van acá:
 * quedan en memoria (SPEC-16, decisión del review — volátiles por
 * corrida).
 *
 * En tests (vitest) gana DATABASE_URL_TEST → mercadoraiz-db-test, la
 * base hermana de la suite del backend — nunca se toca la dev.
 */
import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;
let pool = null;

export function connectionString() {
  // `||` y no `??`: una var vacía (p.ej. `DATABASE_URL=` en .env)
  // debe caer al default, no entregar '' al Pool.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return (
      process.env.DATABASE_URL_TEST ||
      'postgres://mercadoraiz:dev-local-2026@localhost:5432/mercadoraiz-db-test'
    );
  }
  return process.env.DATABASE_URL || config.databaseUrl;
}

export function poolPg() {
  if (!pool) pool = new Pool({ connectionString: connectionString() });
  return pool;
}

/** Cierra el pool — tests y shutdown limpio del proceso. */
export async function cerrarPg() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
