# Flujo de datos — qué viaja por el grafo y por HTTP

## El estado del grafo (`state.js`)

Cada nodo devuelve campos que se funden en el estado:

```
leer-inventario    → productosBajos: [ {id, sku, nombre, stock_actual,
                                        stock_minimo, precio_unitario,
                                        proveedor:{id,nombre,tiempo_entrega_dias}, estado} ]
analizar-demanda   → analisisPorProducto: { [id]: {demanda_diaria, tendencia, observacion} }
calcular-cantidad  → decisionPorProducto: { [id]: {cantidad, monto_total} }
generar-analisis   → decisionPorProducto: { [id]: {…, analisis_ia} }
decidir-aprobacion → decisionPorProducto: { [id]: {…, requiere_aprobacion} }
crear-orden        → ordenesCreadas: [orden], ordenesPendientes: [orden_id]
esperar-aprobacion → senalReanudacion: payload del POST /resume
procesar-decision  → ordenesPendientes (achicada), ordenesResueltas: [orden]
cualquier nodo     → errores: [string]  (acumulativo)
```

## Llamadas al backend

| Desde | Endpoint | Para qué |
|---|---|---|
| leer-inventario | `GET /api/productos?estado=STOCK_BAJO` `?estado=CRITICO` | qué reponer |
| analizar-demanda | `GET /api/historial?producto_id=N&tipo=VENTA` | materia prima del LLM |
| crear-orden | `POST /api/ordenes` | `{producto_id, cantidad, requiere_aprobacion, analisis_ia}` |
| procesar-decision | `GET /api/ordenes/:orden_id` | estado real post-aprobación |
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

## La pausa humana, vista como datos

```
estado.ordenesPendientes = ["OC-101", "OC-102"]
        │
        ▼ interrupt() ── checkpoint.sqlite guarda TODO el estado
        │
humano: POST /api/ordenes/OC-101/aprobar   (en el backend, no en el grafo)
        │   └─ el controller persiste y dispara POST :4110/resume
        ▼ (harness-notify.js, fire-and-forget)
procesar-decision: GET OC-101 → APROBADA  → ordenesResueltas
                   GET OC-102 → PENDIENTE → sigue en ordenesPendientes
        │
        ▼ ¿quedan pendientes? → sí → vuelve a esperar-aprobacion (loop)
                                no → fin
```

## Errores que el grafo tolera

| Falla | Qué pasa |
|---|---|
| LLM devuelve JSON roto | retry ×2 → fallback heurístico + error en `state.errores` |
| LLM devuelve texto corto en justificación | retry ×2 → template + error |
| POST /ordenes da 429/5xx | retry con backoff ×3 (backend-client) |
| POST /ordenes da 4xx | no reintenta (error nuestro) → error en estado |
| resume antes de que el humano actúe | procesar-decision ve PENDIENTE → loop → nueva pausa |
