# Prompts — qué le pedimos al LLM y por qué así

El modelo es `llama3.2:1b`: chico, local, gratis. Las reglas de
diseño de prompts para modelos chicos son distintas a las de un
GPT-4: cortos, formato explícito, un solo trabajo por llamada, y
NUNCA aritmética libre.

## Prompt 1 — análisis de demanda

`src/langgraph/prompts/analisis-demanda.js`

**Entrada**: nombre, SKU, categoría, stock actual/mínimo, lista de
ventas recientes (`fecha: N unidades`).

**Salida esperada** (validada con zod):

```json
{"demanda_diaria": 3.5, "tendencia": "estable", "observacion": "ventas regulares de fin de semana"}
```

**Decisiones**:
- `format: 'json'` de Ollama fuerza salida JSON — sin eso el modelo
  a veces agrega prosa alrededor.
- El schema fija `tendencia` a tres valores — sin enum, inventa
  palabras ("alta", "creciente") que rompen la lógica.
- Le pasamos las ventas crudas y pedimos una ESTIMACIÓN — el
  promedio exacto lo puede hacer el fallback; el valor del LLM es
  leer patrones (fines de semana, rachas).
- Fallback si falla: promedio simple de unidades/días del historial.

## Prompt 2 — justificación para el aprobador

`src/langgraph/prompts/generar-analisis.js`

**Entrada**: todos los números YA decididos (demanda, cantidad,
monto, proveedor, lead time).

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
- **Decidir la aprobación**: es una política ($100). Código.
- **Crear la orden**: es escritura en sistema real. HTTP.

Regla práctica para contar en la demo: *el LLM maneja incertidumbre
(estimar, redactar); el código maneja certidumbre (calcular, decidir,
escribir).*
