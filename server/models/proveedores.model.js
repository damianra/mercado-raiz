import { openDb } from '../db.js';
import { capString } from '../security.js';

// SPEC-26 (R26.5): CRUD admin de proveedores. DELETE es siempre soft
// delete (activo=0) — el histórico de órdenes conserva la referencia.
// Desactivar está bloqueado (409) solo cuando hay órdenes vivas:
// PENDIENTE_APROBACION o ENVIADA — cortaría el flujo de esas órdenes.
const CAMPOS = `id, nombre, contacto, telefono, email, tiempo_entrega_dias,
  tiempo_entrega_min_dias, tiempo_entrega_max_dias, confiabilidad_pct,
  pedido_minimo_monto, costo_envio, categorias_cubiertas, activo, fecha_creacion`;

// Estados que hacen "vivir" a una orden: desactivar al proveedor
// rompería su flujo. RECIBIDA/RECHAZADA ya están cerradas; APROBADA
// queda fuera del guard por R26.5 (ya está aprobada, no la corta).
const ESTADOS_VIVOS = ['PENDIENTE_APROBACION', 'ENVIADA'];

export async function listProveedores({ activo, search, page, limit }) {
  const db = await openDb();
  const where = [];
  const params = [];

  if (activo !== undefined) {
    where.push('activo = ?');
    params.push(activo);
  }
  if (search) {
    where.push('(nombre ILIKE ? OR contacto ILIKE ? OR email ILIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const fromWhere = `FROM proveedores${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  const { c: total } = await db.get(`SELECT COUNT(*) AS c ${fromWhere}`, params);
  const rows = await db.all(
    `SELECT ${CAMPOS} ${fromWhere} ORDER BY nombre ASC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return {
    data: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getProveedor(id) {
  const db = await openDb();
  const row = await db.get(`SELECT ${CAMPOS} FROM proveedores WHERE id = ?`, [id]);
  return row ?? { status: 404, error: 'proveedor no encontrado' };
}

// Validación compartida POST/PATCH: devuelve { status, error } o un
// objeto con los campos normalizados (solo los presentes).
function validarCampos(body) {
  const out = {};
  const err = (status, error) => ({ status, error });

  // nullable: el campo admite NULL (un string vacío lo limpia);
  // si no, un vacío/null es 400 — son columnas NOT NULL.
  const str = (campo, { requerido = false, max = 200 } = {}) => {
    const v = body[campo];
    if (v === undefined) return;
    if (v === null) {
      if (requerido) return err(400, `${campo} requerido`);
      out[campo] = null;
      return;
    }
    if (typeof v !== 'string') return err(400, `${campo} debe ser un string`);
    if (!v.trim()) {
      if (requerido) return err(400, `${campo} requerido`);
      out[campo] = null;
      return;
    }
    out[campo] = capString(v.trim(), max);
  };

  const entero = (campo, { min = 0, max = 365, nullable = true } = {}) => {
    const v = body[campo];
    if (v === undefined) return;
    if (v === null) {
      if (!nullable) return err(400, `${campo} no puede ser nulo`);
      out[campo] = null;
      return;
    }
    if (!Number.isInteger(v) || v < min || v > max) {
      return err(400, `${campo} debe ser un entero entre ${min} y ${max}`);
    }
    out[campo] = v;
  };

  const monto = (campo) => {
    const v = body[campo];
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return err(400, `${campo} debe ser un número ≥ 0`);
    }
    out[campo] = v;
  };

  return (
    str('nombre', { requerido: true }) ??
    str('contacto') ??
    str('telefono', { max: 50 }) ??
    str('email', { max: 254 }) ??
    entero('tiempo_entrega_dias', { min: 0, nullable: false }) ??
    entero('tiempo_entrega_min_dias', { min: 0 }) ??
    entero('tiempo_entrega_max_dias', { min: 0 }) ??
    entero('confiabilidad_pct', { min: 0, max: 100 }) ??
    monto('pedido_minimo_monto') ??
    monto('costo_envio') ??
    validarCategorias(body.categorias_cubiertas, out) ??
    out
  );
}

function validarCategorias(v, out) {
  if (v === undefined) return;
  if (
    !Array.isArray(v) ||
    v.some((c) => typeof c !== 'string' || !c.trim())
  ) {
    return { status: 400, error: 'categorias_cubiertas debe ser un array de strings' };
  }
  out.categorias_cubiertas = v.map((c) => capString(c.trim(), 100));
}

async function tieneOrdenesVivas(db, id) {
  const { c } = await db.get(
    `SELECT COUNT(*) AS c FROM ordenes_compra
     WHERE proveedor_id = ? AND estado IN (${ESTADOS_VIVOS.map(() => '?').join(',')})`,
    [id, ...ESTADOS_VIVOS],
  );
  return c > 0;
}

export async function crearProveedor(body) {
  const db = await openDb();
  const campos = validarCampos(body);
  if (campos.error) return campos;
  if (!campos.nombre) return { status: 400, error: 'nombre requerido' };

  if (
    campos.tiempo_entrega_min_dias != null &&
    campos.tiempo_entrega_max_dias != null &&
    campos.tiempo_entrega_min_dias > campos.tiempo_entrega_max_dias
  ) {
    return { status: 400, error: 'tiempo_entrega_min_dias no puede superar al máximo' };
  }

  if (await db.get('SELECT id FROM proveedores WHERE LOWER(nombre) = LOWER(?)', [campos.nombre])) {
    return { status: 409, error: 'ya existe un proveedor con ese nombre' };
  }

  const { lastInsertRowid: id } = await db
    .prepare(
      `INSERT INTO proveedores
        (nombre, contacto, telefono, email, tiempo_entrega_dias,
         tiempo_entrega_min_dias, tiempo_entrega_max_dias, confiabilidad_pct,
         pedido_minimo_monto, costo_envio, categorias_cubiertas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      campos.nombre,
      campos.contacto ?? null,
      campos.telefono ?? null,
      campos.email ?? null,
      campos.tiempo_entrega_dias ?? 1,
      campos.tiempo_entrega_min_dias ?? null,
      campos.tiempo_entrega_max_dias ?? null,
      campos.confiabilidad_pct ?? null,
      campos.pedido_minimo_monto ?? 0,
      campos.costo_envio ?? 0,
      campos.categorias_cubiertas ?? [],
    );

  return {
    status: 201,
    data: await db.get(`SELECT ${CAMPOS} FROM proveedores WHERE id = ?`, [id]),
  };
}

export async function patchearProveedor(id, body) {
  const db = await openDb();
  const actual = await db.get('SELECT * FROM proveedores WHERE id = ?', [id]);
  if (!actual) return { status: 404, error: 'proveedor no encontrado' };

  const campos = validarCampos(body);
  if (campos.error) return campos;

  let activo;
  if (body.activo !== undefined) {
    activo = Number(body.activo);
    if (activo !== 0 && activo !== 1) {
      return { status: 400, error: 'activo debe ser 0 o 1' };
    }
  }

  if (Object.keys(campos).length === 0 && activo === undefined) {
    return { status: 400, error: 'nada que actualizar' };
  }

  // min ≤ max sobre los valores fusionados (patch parcial): un
  // campo ausente conserva el valor actual; un null explícito lo limpia.
  const min = 'tiempo_entrega_min_dias' in campos
    ? campos.tiempo_entrega_min_dias
    : actual.tiempo_entrega_min_dias;
  const max = 'tiempo_entrega_max_dias' in campos
    ? campos.tiempo_entrega_max_dias
    : actual.tiempo_entrega_max_dias;
  if (min != null && max != null && min > max) {
    return { status: 400, error: 'tiempo_entrega_min_dias no puede superar al máximo' };
  }

  // Desactivar por PATCH corre el mismo guard que DELETE (R26.5).
  if (activo === 0 && actual.activo === 1 && (await tieneOrdenesVivas(db, id))) {
    return {
      status: 409,
      error: 'el proveedor tiene órdenes pendientes de aprobación o enviadas — no se puede desactivar',
    };
  }

  const sets = [];
  const params = [];
  for (const [campo, valor] of Object.entries(campos)) {
    sets.push(`${campo} = ?`);
    params.push(valor);
  }
  if (activo !== undefined) {
    sets.push('activo = ?');
    params.push(activo);
  }
  params.push(id);

  await db.run(`UPDATE proveedores SET ${sets.join(', ')} WHERE id = ?`, params);
  return { status: 200, data: await getProveedorRow(db, id) };
}

export async function borrarProveedor(id) {
  const db = await openDb();
  const actual = await db.get('SELECT * FROM proveedores WHERE id = ?', [id]);
  if (!actual) return { status: 404, error: 'proveedor no encontrado' };

  if (actual.activo === 0) {
    return { status: 200, data: await getProveedorRow(db, id) };
  }
  if (await tieneOrdenesVivas(db, id)) {
    return {
      status: 409,
      error: 'el proveedor tiene órdenes pendientes de aprobación o enviadas — no se puede desactivar',
    };
  }

  await db.run('UPDATE proveedores SET activo = 0 WHERE id = ?', [id]);
  return { status: 200, data: await getProveedorRow(db, id) };
}

function getProveedorRow(db, id) {
  return db.get(`SELECT ${CAMPOS} FROM proveedores WHERE id = ?`, [id]);
}
