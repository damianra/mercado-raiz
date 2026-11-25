# Flujo de datos — qué viaja por el grafo y por HTTP

## El estado del grafo (`state.js`)

Cada nodo devuelve campos que se funden en el estado:

```
leer-inventario    → productosBajos: [ {id, sku, nombre, stock_actual,
                                        stock_minimo, precio_venta + costo_unitario (producto_proveedor),
                                        proveedor:{id,nombre,tiempo_entrega_dias,lead_dias_esperado}, estado} ]
                      (SPEC-14: pagina todas las páginas del backend, limit=100)
analizar-demanda   → productosBajos: recortada por el guard (T32.5)
                      excluidos: [ {producto_id, sku, nombre, excluido_por, detalle} ]
                                 excluido_por ∈ DEAD_STOCK | SOBRE_MAX
                      analisisPorProducto: { [id]: {demanda_diaria, tendencia, observacion,
                                           desvio_demanda, zona_precio, indice_precio,
                                           revision_precio?} }
                      hashPorProducto: { [id]: hash del input }  (SPEC-16: cache)
                      (guard T32.5: sin ventas en la ventana → DEAD_STOCK, precio sobre el
                       máximo de mercado → SOBRE_MAX, ambos fuera de la OC; SOBRE_MAX en
                       quiebre real (stock ≤0 + demanda viva) sigue con revision_precio;
                       triage SPEC-12: ≥3d y CV < UMBRAL_CV → stats del backend sin LLM;
                       SPEC-16: volátiles en lotes de DEMANDA_BATCH)
calcular-cantidad  → decisionPorProducto: { [id]: {cantidad, monto_total} }
decidir-aprobacion → decisionPorProducto: { [id]: {…, requiere_aprobacion} }
generar-analisis   → decisionPorProducto: { [id]: {…, analisis_ia} }
                      (SPEC-12: LLM solo si requiere_aprobacion; si no, template)
crear-orden        → ordenesCreadas: [orden], ordenesPendientes: [orden_id]
cualquier nodo     → errores: [string]  (acumulativo)
```

## Llamadas al backend

| Desde | Endpoint | Para qué |
|---|---|---|
| leer-inventario | `GET /api/productos?estado=STOCK_BAJO` `?estado=CRITICO` (paginado: todas las páginas, limit=100 — SPEC-14) | qué reponer |
| analizar-demanda | `GET /api/estadisticas/demanda?dias=D` — bulk, TODOS los productos en 1 request (SPEC-26 + T32.5: trae `zona_precio`/`indice_precio`; fallback: `?producto_id=N` por producto) | materia prima del guard + del LLM |
| crear-orden | `POST /api/ordenes/batch` (SPEC-16: hasta 100 por request, una transacción; si el lote falla → `POST /api/ordenes` por producto) | `{producto_id, cantidad, requiere_aprobacion, analisis_ia}` |
| fin | `GET /api/dashboard/stats` | KPIs de cierre |

## Regla del umbral, duplicada a propósito

- El nodo `decidir-aprobacion` marca `requiere_aprobacion` si
  `monto_total >= UMBRAL_APROBACION` (.env, default $50.000).
- El backend tiene la MISMA regla en
  `server/models/ordenes.model.js` (`UMBRAL_APROBACION = 50000`) y la
  aplica solo si el flag no viene — es la red de seguridad si otro
  cliente crea órdenes sin decidir.

Si cambian el umbral, cambiarlo en los dos lados (o centralizarlo
en el backend y que el agente no mande el flag).

## La aprobación humana, vista como datos (SPEC-12)

```
estado.ordenesPendientes = ["OC-101", "OC-102"]   ← al cerrar la corrida
        │
        ▼ fin — el grafo TERMINA (la aprobación quedó fuera)
        │
humano: POST /api/ordenes/OC-101/aprobar   (REST del backend)
        │   └─ el controller persiste estado = APROBADA — fin.
        │
la decisión nunca vuelve al agente: las pendientes se consultan
en el dashboard como cualquier otra orden.
```

## Errores que el grafo tolera

| Falla | Qué pasa |
|---|---|
| LLM devuelve JSON roto | retry ×2 → fallback heurístico + error en `state.errores` |
| LLM devuelve texto corto en justificación | retry ×2 → template + error |
| POST /ordenes/batch da 429/5xx | retry honrando `Retry-After` ×4 (backend-client, SPEC-13); si agota → fallback a POST individual por producto |
| POST /ordenes/batch da 4xx | no reintenta (error nuestro) → lote cae a individuales; el item malo queda en `state.errores` |
| ventas con CV bajo | triage: demanda ponderada del backend, `llm_evitadas+1` — no es error |
| sin ventas en la ventana | demanda 0 determinística, `llm_evitadas+1` — no es error |
