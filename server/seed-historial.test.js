// @vitest-environment node
// SPEC-30 (T30.3): historialDeProducto reconstruye la cadena de
// stock desde las ventas del seed — termina en stock_actual, la
// cadena anterior→nueva es continua, y los quiebres aparecen
// cuando la demanda agota antes de que llegue la reposición.
import { describe, expect, it } from 'vitest';
import { historialDeProducto, seedHistorial } from './seed-historial.js';
import { estadisticasDemandaBulk } from './models/estadisticas.model.js';
import { ventasDeProducto } from './seed-ventas.js';
import { seedData } from './seed-data.js';
import { closeDb, openDb } from './db.js';

const HOY = new Date('2026-11-24T12:00:00Z');
const P = (i) => seedData.productos[i];

const cadenaContinua = (movs) =>
  movs.every((m, i) => i === 0 || m.cantidad_anterior === movs[i - 1].cantidad_nueva);

describe('historialDeProducto (pura)', () => {
  it('determinística: mismo producto + mismas ventas → misma cadena', () => {
    const p = P(30);
    const ventas = ventasDeProducto(p, HOY);
    expect(historialDeProducto(p, ventas, HOY)).toEqual(
      historialDeProducto(p, ventas, HOY),
    );
  });

  it('la cadena es continua (anterior_i == nueva_{i-1}) y termina en stock_actual', () => {
    const p = P(31);
    const ventas = ventasDeProducto(p, HOY);
    const movs = historialDeProducto(p, ventas, HOY);
    expect(cadenaContinua(movs)).toBe(true);
    expect(movs.at(-1).cantidad_nueva).toBe(p.stock_actual);
  });

  it('produce días de quiebre reales cuando la demanda agota antes de la reposición', () => {
    // Producto fabricado: demanda alta sostenida vs stock acotado —
    // la reposición de 2-6d no puede evitar el cero.
    const p = { id: 9, sku: 'T1', ean: 't1', stock_actual: 40, stock_minimo: 10 };
    const ventas = Array.from({ length: 60 }, (_, i) => ({
      fecha: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      unidades: 8,
    })).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const movs = historialDeProducto(p, ventas, HOY);
    expect(movs.some((m) => m.cantidad_nueva <= 0)).toBe(true);
    expect(movs.some((m) => m.tipo_movimiento === 'REPOSICION' && m.referencia === 'SEED-RECONSTRUCCION'))
      .toBe(true);
  });

  it('una sola reposición en tránsito (no se acumulan)', () => {
    const p = { id: 10, sku: 'T2', ean: 't2', stock_actual: 40, stock_minimo: 10 };
    const ventas = [
      { fecha: '2026-10-01', unidades: 15 },
      { fecha: '2026-10-02', unidades: 15 },
      { fecha: '2026-10-03', unidades: 15 },
      { fecha: '2026-10-04', unidades: 15 },
    ];
    const movs = historialDeProducto(p, ventas, HOY);
    // Una sola entrega se dispara en el tramo (lead 2-6 cae después
    // de la última venta → entrega en la cola de la ventana).
    const reposiciones = movs.filter((m) => m.tipo_movimiento === 'REPOSICION');
    expect(reposiciones.length).toBe(1);
  });

  it('la reposición llega en su propia fecha aunque ese día no haya venta (gap-day)', () => {
    // Venta en D, próxima en D+10: cualquier lead 2-6 cae en un día
    // sin venta — si la entrega exigiera v.fecha === llegada, se
    // perdía y la cadena colapsaba a quiebre permanente.
    const p = { id: 11, sku: 'T2b', ean: 't2b', stock_actual: 40, stock_minimo: 10 };
    const ventas = [
      { fecha: '2026-10-01', unidades: 30 }, // cae a/bajo mínimo
      { fecha: '2026-10-11', unidades: 5 },
      { fecha: '2026-10-20', unidades: 5 },
    ];
    const movs = historialDeProducto(p, ventas, HOY);
    const repo = movs.find(
      (m) => m.tipo_movimiento === 'REPOSICION' && m.fecha.slice(0, 10) !== '2026-10-01',
    );
    expect(repo).toBeDefined();
    // Llegó ENTRE las dos ventas, en un día sin venta propio.
    const f = repo.fecha.slice(0, 10);
    expect(f > '2026-10-01' && f <= '2026-10-11').toBe(true);
    // Y la cadena siguió sana después (termina en stock_actual).
    expect(movs.at(-1).cantidad_nueva).toBe(40);
  });

  it('el primer mov declara la posición pre-ventana (anterior = objetivo)', () => {
    // quiebreDesde hereda movs[0].anterior a los días anteriores a
    // la ventana — si fuera 0, dias>91 contaría quiebre fantasma.
    const p = P(32);
    const movs = historialDeProducto(p, ventasDeProducto(p, HOY), HOY);
    expect(movs[0].cantidad_anterior).toBeGreaterThan(0);
  });

  it('sin ventas → un conteo con la posición constante', () => {
    const p = { id: 12, sku: 'T3', ean: 't3', stock_actual: 25, stock_minimo: 5 };
    const movs = historialDeProducto(p, [], HOY);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({
      tipo_movimiento: 'AJUSTE',
      motivo: 'CONTEO',
      cantidad_anterior: 25,
      cantidad_nueva: 25,
      referencia: 'SEED-RECONSTRUCCION',
    });
  });

  it('sin ventas y stock 0 → la posición queda en 0 toda la ventana', () => {
    const p = { id: 13, sku: 'T4', ean: 't4', stock_actual: 0, stock_minimo: 5 };
    const movs = historialDeProducto(p, [], HOY);
    expect(movs).toHaveLength(1);
    expect(movs[0].cantidad_nueva).toBe(0);
  });
});

describe('seedHistorial (integración, schema con seed completo)', () => {
  it('puebla historial para todo el catálogo y las stats dejan de ser null', async () => {
    // Schema de test CON seed de ventas+historial (sembrarVentas
    // explícito — el default en test lo saltea por costo).
    const db = await openDb({ searchPath: 't_hist', sembrarVentas: true });
    try {
      const { c } = await db.get(
        `SELECT COUNT(*)::int AS c FROM historial_stock WHERE referencia = 'SEED-RECONSTRUCCION'`,
      );
      // ~1 fila por venta + reposiciones + ajustes ≫ productos
      const { cp } = await db.get('SELECT COUNT(*)::int AS cp FROM productos');
      expect(c).toBeGreaterThan(cp);

      // La cadena de cada producto termina en su stock_actual —
      // último movimiento de CUALQUIER referencia (las VENTA llevan
      // la referencia de la venta VTA-*, no SEED-RECONSTRUCCION).
      // Se excluyen los 7 productos del fixture: su fila hecha a
      // mano no siempre cierra en stock_actual (convive, no rompe).
      const fixtureIds = seedData.historial_stock.map((m) => m.producto_id);
      const rotos = await db.all(
        `SELECT producto_id FROM (
           SELECT DISTINCT ON (producto_id) producto_id, cantidad_nueva
           FROM historial_stock
           ORDER BY producto_id, fecha DESC, id DESC
         ) ult
         JOIN productos p ON p.id = ult.producto_id
         WHERE ult.cantidad_nueva != p.stock_actual
           AND NOT (ult.producto_id = ANY(?))`,
        [fixtureIds],
      );
      expect(rotos).toHaveLength(0);

      // Los 7 productos del fixture NO tienen filas reconstruidas
      // (su cadena hecha a mano convive con los tests).
      const { f } = await db.get(
        `SELECT COUNT(*)::int AS f FROM historial_stock
         WHERE referencia = 'SEED-RECONSTRUCCION' AND producto_id = ANY(?)`,
        [fixtureIds],
      );
      expect(f).toBe(0);

      // Las stats dejan de ser null end-to-end — el propósito de
      // la tarea: con cadena para todo el catálogo, cada producto
      // reporta dias_en_quiebre numérico (y hay quiebres reales).
      const stats = await estadisticasDemandaBulk(90);
      expect(stats).toHaveLength(cp);
      expect(stats.every((s) => typeof s.dias_en_quiebre === 'number')).toBe(
        true,
      );
      expect(stats.some((s) => s.dias_en_quiebre > 0)).toBe(true);

      // Idempotente: segunda corrida no duplica.
      expect(await seedHistorial(db)).toBe(0);
    } finally {
      await closeDb(true);
    }
  }, 120_000);
});
