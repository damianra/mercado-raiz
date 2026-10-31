-- MERCADO RAÍZ — schema del dominio. Idempotente: db.js lo ejecuta en
-- cada apertura de la base, por eso todo lleva IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  contacto TEXT,
  telefono TEXT,
  email TEXT,
  tiempo_entrega_dias INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  stock_actual INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER NOT NULL,
  precio_unitario REAL NOT NULL,
  proveedor_id INTEGER NOT NULL,
  ubicacion TEXT,
  estado TEXT NOT NULL DEFAULT 'OK'
    CHECK (estado IN ('OK', 'STOCK_BAJO', 'CRITICO')),
  fecha_actualizacion TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
);

CREATE INDEX IF NOT EXISTS idx_productos_sku ON productos(sku);
CREATE INDEX IF NOT EXISTS idx_productos_estado ON productos(estado);
CREATE INDEX IF NOT EXISTS idx_productos_stock ON productos(stock_actual);

CREATE TABLE IF NOT EXISTS ordenes_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id TEXT UNIQUE NOT NULL,
  producto_id INTEGER NOT NULL,
  proveedor_id INTEGER NOT NULL,
  cantidad INTEGER NOT NULL,
  precio_unitario REAL NOT NULL,
  monto_total REAL NOT NULL,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE_APROBACION'
    CHECK (estado IN ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'ENVIADA', 'RECIBIDA')),
  requiere_aprobacion INTEGER NOT NULL DEFAULT 0,
  analisis_ia TEXT,
  aprobado_por TEXT,
  motivo_rechazo TEXT,
  fecha_aprobacion TEXT,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  fecha_actualizacion TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (producto_id) REFERENCES productos(id),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
);

CREATE INDEX IF NOT EXISTS idx_ordenes_estado ON ordenes_compra(estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_fecha ON ordenes_compra(fecha_creacion);

CREATE TABLE IF NOT EXISTS historial_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL,
  tipo_movimiento TEXT NOT NULL
    CHECK (tipo_movimiento IN ('VENTA', 'REPOSICION', 'AJUSTE', 'DEVOLUCION')),
  cantidad_anterior INTEGER NOT NULL,
  cantidad_nueva INTEGER NOT NULL,
  diferencia INTEGER NOT NULL,
  referencia TEXT,
  usuario TEXT,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (producto_id) REFERENCES productos(id)
);

CREATE INDEX IF NOT EXISTS idx_historial_producto ON historial_stock(producto_id);
CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial_stock(fecha);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('APROBADOR', 'GERENTE', 'ADMIN')),
  avatar_url TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
);
