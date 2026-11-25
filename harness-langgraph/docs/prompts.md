# Prompts — qué le pedimos al LLM y por qué así

El modelo se configura en `OLLAMA_MODEL` (hoy `qwen3:8b`, chico,
local, gratis). Las reglas de diseño de prompts para modelos
chicos son distintas a las de un GPT-4: cortos, formato explícito,
un solo trabajo por llamada, y NUNCA aritmética libre.

## Prompt 1 — análisis de demanda

`src/langgraph/prompts/analisis-demanda.js`

**Entrada**: nombre, SKU, categoría, stock actual/mínimo y las
estadísticas de demanda del backend (SPEC-26): media ponderada,
desvío σ, CV, pendiente, días con venta/quiebre, última venta y
posición competitiva del precio (T32.5: `zona_precio` +
`indice_precio` — más barato del mercado / en rango / sobre el
máximo — para que el modelo la mencione en `observacion` cuando
es relevante para la reposición).

**Salida esperada** (validada con zod):

```json
{"demanda_diaria": 3.5, "tendencia": "estable", "observacion": "ventas regulares de fin de semana"}
```

**Decisiones**:
- `format: 'json'` de Ollama fuerza salida JSON — sin eso el modelo
  a veces agrega prosa alrededor.
- El schema fija `tendencia` a tres valores — sin enum, inventa
  palabras ("alta", "creciente") que rompen la lógica.
- Le pasamos las estadísticas ya calculadas y pedimos un AJUSTE —
  la media ponderada la calcula el backend; el valor del LLM es
  ponderar contexto que el promedio no ve (quiebres, tendencia,
  volatilidad). Los días en quiebre se explicitan como censurados
  para que el modelo no los lea como demanda cero.
- Fallback si falla: la `demanda_diaria` del backend tal cual.

## Prompt 1b — análisis de demanda EN LOTE (SPEC-16)

`src/langgraph/prompts/analisis-demanda-batch.js`

Variante de Prompt 1 para `DEMANDA_BATCH` productos por llamada:
mismo schema por item más `producto_id` repetido (matcheo
respuesta ↔ producto). **Salida esperada**:

```json
{"resultados": [{"producto_id": 7, "demanda_diaria": 3, "tendencia": "estable", "observacion": "..."}]}
```

**Decisiones medidas en benchmark**:
- El array va DENTRO de `{"resultados": [...]}` — con
  `format:'json'` Ollama sesga la salida a objetos: pedir el array
  desnudo hacía que el 100% de los lotes devolviera un objeto
  suelto de UN item. El parser (`llm-json.js`) acepta las 3 formas
  reales: array, objeto-envuelto, objeto suelto.
- `observacion` pide máx 12 palabras — es lo más verboso y el
  `numPredict` escala con el lote (100 tok/item).
- Por producto van las stats compactas en una línea (`statsTxt`)
  — mucho más acotado que la lista cruda de movimientos del
  historial que se usaba antes (SPEC-26).
- Un item faltante/inválido NO tira el lote: ese producto cae a la
  llamada individual (Prompt 1). Solo si la respuesta entera no
  parsea, todos caen a individual.

## Prompt 2 — justificación para el aprobador

`src/langgraph/prompts/generar-analisis.js`

**Entrada**: todos los números YA decididos (demanda, cantidad,
monto, proveedor, lead time) + posición competitiva (T32.5: si el
análisis trae `revision_precio` — SOBRE_MAX en quiebre real — la
justificación DEBE recomendar revisar el precio antes de reponer;
el template fallback la agrega siempre).

**Salida**: texto libre de 2-3 oraciones para `analisis_ia` de la
orden — lo que lee el humano en el modal del dashboard.

**Decisiones**:
- "Usá SOLO estos datos, no inventes otros" — los modelos chicos
  alucinan cifras si les das espacio.
- Sin JSON: acá el texto ES el producto.
- Fallback: template con los mismos datos.

## Lo que deliberadamente NO se le pide al LLM

- **Calcular la cantidad a ordenar**: es aritmética con una regla
  de negocio (cobertura, mínimos). Código — exacto y explicable.
- **Decidir la aprobación**: es una política ($50.000). Código.
- **Crear la orden**: es escritura en sistema real. HTTP.

Regla práctica para contar en la demo: *el LLM maneja incertidumbre
(estimar, redactar); el código maneja certidumbre (calcular, decidir,
escribir).*
