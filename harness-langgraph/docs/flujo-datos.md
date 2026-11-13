# Flujo de datos — qué viaja por el grafo y por HTTP

## El estado del grafo (`state.js`)

Cada nodo devuelve campos que se funden en el estado:

```
leer-inventario    → productosBajos: [ {id, sku, nombre, stock_actual,
                                        stock_minimo, precio_unitario,
                                        proveedor:{id,nombre,tiempo_entrega_dias}, estado} ]
                      (SPEC-14: pagina todas las páginas del backend, limit=100)
analizar-demanda   → analisisPorProducto: { [id]: {demanda_diaria, tendencia, observacion} }
                      hashPorProducto: { [id]: hash del input }  (SPEC-16: cache)
                      (triage SPEC-12: CV < UMBRAL_CV → promedio sin LLM;
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
| analizar-demanda | `GET /api/historial?producto_id=N&tipo=VENTA` | materia prima del LLM |
| crear-orden | `POST /api/ordenes/batch` (SPEC-16: hasta 100 por request, una transacción; si el lote falla → `POST /api/ordenes` por producto) | `{producto_id, cantidad, requiere_aprobacion, analisis_ia}` |
| fin | `GET /api/dashboard/stats` | KPIs de cierre |

## Regla del umbral, duplicada a propósito

- El nodo `decidir-aprobacion` marca `requiere_aprobacion` si
  `monto_total >= UMBRAL_APROBACION` (.env, default $100).
- El backend tiene la MISMA regla en
  `server/models/ordenes.model.js` (`UMBRAL_APROBACION = 100`) y la
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
| ventas con CV bajo | triage: promedio histórico, `llm_evitadas+1` — no es error |
