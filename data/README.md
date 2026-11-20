# `articles_sample.csv` — muestra de artículos canónicos (retail-radar)

1.471 artículos canónicos presentes y activos en las **4 cadenas**
scrapeadas por [retail-radar](https://github.com/damianra/retail-radar)
(Día, Coto, Carrefour, La Anónima) — el universo directamente
comparable contra el mercado propio.

Extraído de la vista gold `v_product_prices` el 2026-11-20. Para
regenerar la muestra: `export_sample.sql` (mismo dir) corre con
`psql` contra la DB de retail-radar (`COPY ... TO STDOUT`).

## Columnas

| Columna | Descripción |
|---|---|
| `product_id` | id canónico en retail-radar (join key con `products`/`product_matches`) |
| `canonical_name`, `brand`, `size`, `unit`, `ean` | identidad del artículo |
| `top_category` | categoría tope más frecuente entre las cadenas |
| `{dia,coto,carrefour,laa}_sku` | SKU del artículo en cada cadena |
| `{...}_price` / `{...}_list_price` | precio actual / precio de lista (ARS) |
| `min_price`, `max_price`, `spread_pct` | rango entre cadenas y spread % sobre el mínimo |

## Notas de calidad del dato

- **Coto** precia por sucursal y casi no tiene `last_price` nacional:
  `coto_price` es la **moda de sus 35 sucursales**
  (`store_price_current`) cuando falta el nacional. 5 artículos sin
  dato Coto en absoluto → `coto_price` vacío.
- Precios `0` tratados como sin dato (afectaba a 4 items de
  Carrefour → `carrefour_price` vacío).
- Snapshot del último crawl, no serie histórica. Para historia:
  `price_snapshots` en la DB de retail-radar.
