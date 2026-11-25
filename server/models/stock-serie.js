// Helpers puros del replay de posición de stock — compartidos por
// estadisticas.model (dias_en_quiebre, fill rate, margen_perdido) y
// productos.model (GET /productos/:id/historial, SPEC-32 T32.6).
// Una sola semántica, una sola fuente de verdad:
//
//   · la posición de cada día es el `cantidad_nueva` del último
//     movimiento ≤ ese día; los días anteriores al primer movimiento
//     heredan su `cantidad_anterior` (aproximación documentada);
//   · sin movimientos la fuente no existe → null (R26.7, nunca
//     inventado).
//
// Los movimientos llegan ya ordenados por (fecha, id) con el día en
// `m.f` (ISO date). Las fechas de la ventana también son ISO date —
// la comparación lexicográfica es cronológica.

// Fechas ISO de la ventana [hoy − dias + 1 … hoy], más vieja primero.
// `hoy` viene de la DB (CURRENT_DATE::text) para que la TZ del
// proceso no mueva la ventana.
export function fechasVentana(hoy, dias) {
  const hoyMs = Date.parse(`${hoy}T00:00:00Z`);
  const fechas = [];
  for (let i = dias - 1; i >= 0; i--) {
    fechas.push(new Date(hoyMs - i * 86400000).toISOString().slice(0, 10));
  }
  return fechas;
}

// Replay de la cadena de movimientos sobre las fechas de la ventana
// → [posición por día]. null si no hay movimientos (fuente no
// confiable — el caller decide cómo reportarlo).
export function seriePosicionStock(movs, fechas) {
  if (movs.length === 0) return null;

  let cursor = 0;
  let posicion = movs[0].cantidad_anterior;
  const serie = new Array(fechas.length);

  for (let i = 0; i < fechas.length; i++) {
    while (cursor < movs.length && movs[cursor].f <= fechas[i]) {
      posicion = movs[cursor].cantidad_nueva;
      cursor++;
    }
    serie[i] = posicion;
  }
  return serie;
}
