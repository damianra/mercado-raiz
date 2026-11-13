// Generado por MetaBuilder — contrato estático del api-surface.
// Cada endpoint del backend debe seguir registrado en su archivo de
// rutas. Si el dominio elimina/reubica un endpoint, actualizar este
// archivo es honesto — pero que falle = wiring roto.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINTS = [
  {
    "method": "get",
    "path": "/api/dashboard/stats",
    "file": "dashboard.js"
  },
  {
    "method": "get",
    "path": "/api/ordenes/",
    "file": "ordenes.js"
  },
  {
    "method": "post",
    "path": "/api/ordenes/",
    "file": "ordenes.js"
  },
  {
    "method": "get",
    "path": "/api/ordenes/:orden_id",
    "file": "ordenes.js"
  },
  {
    "method": "post",
    "path": "/api/ordenes/:orden_id/aprobar",
    "file": "ordenes.js"
  },
  {
    "method": "post",
    "path": "/api/ordenes/:orden_id/rechazar",
    "file": "ordenes.js"
  },
  {
    "method": "get",
    "path": "/api/productos/",
    "file": "productos.js"
  }
];

const find = (dir, name) => {
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      const hit = find(p, name);
      if (hit) return hit;
    } else if (f === name) return p;
  }
  return null;
};

describe('api contract (endpoints del dominio registrados)', () => {
  for (const e of ENDPOINTS) {
    it(`${e.method.toUpperCase()} ${e.path} (${e.file})`, () => {
      const file = find('server', e.file);
      expect(file, `${e.file} debe existir bajo server/`).toBeTruthy();
      const src = readFileSync(file, 'utf8');
      const re = new RegExp(`router\\.` + e.method + `\\(`);
      expect(src, `${e.file} debe registrar ${e.method.toUpperCase()}`).toMatch(re);
    });
  }
});
