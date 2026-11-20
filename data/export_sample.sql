-- Exporta la muestra de artículos canónicos presentes (activos) en las 4
-- cadenas scrapeadas por retail-radar. Ejecutar contra la DB de retail-radar:
--   podman exec retail-radar-db psql -U retail_radar -d retail_radar \
--     -f /tmp/export_sample.sql > data/articles_sample.csv
-- Notas:
--  * Coto no siempre tiene precio "nacional" (chain_products.last_price);
--    se usa la moda de sus precios por sucursal (store_price_current, 35 suc.).
--  * Precios en 0 se tratan como sin dato (NULL) en todas las cadenas.
--  * Coto upstream: ~14% de las filas store_price_current traen price
--    inflado (>3x list_price — 12k productos, p.ej. 124124.80 vs 5957.99).
--    Regla de sanidad: si el precio efectivo supera 3x el de lista, se
--    toma el de lista como precio (plausible shelf price).
COPY (
  WITH coto_store AS (
    SELECT chain_product_id,
           mode() WITHIN GROUP (ORDER BY price)      AS modal_price,
           mode() WITHIN GROUP (ORDER BY list_price) AS modal_list
      FROM store_price_current
     GROUP BY chain_product_id
  ),
  base AS (
    SELECT v.product_id, v.canonical_name, v.brand, v.size, v.unit, v.ean, v.top_category,
           v.dia_sku, v.coto_sku, v.carrefour_sku, v.laa_sku,
           nullif(v.dia_price, 0)       AS dia_price,
           nullif(v.dia_list_price, 0)  AS dia_list_price,
           nullif(coalesce(v.coto_price, cs.modal_price), 0)     AS coto_price_raw,
           nullif(coalesce(v.coto_list_price, cs.modal_list), 0) AS coto_list,
           nullif(v.carrefour_price, 0)      AS carrefour_price,
           nullif(v.carrefour_list_price, 0) AS carrefour_list_price,
           nullif(v.laa_price, 0)       AS laa_price,
           nullif(v.laa_list_price, 0)  AS laa_list_price
      FROM v_product_prices v
      LEFT JOIN (product_matches pm
                 JOIN chain_products cp
                   ON cp.id = pm.chain_product_id
                  AND cp.chain_id = (SELECT id FROM chains WHERE code='coto'))
             ON pm.product_id = v.product_id
      LEFT JOIN coto_store cs ON cs.chain_product_id = cp.id
     WHERE v.chains_present = 4
  ),
  sane AS (
    SELECT *,
           CASE WHEN coto_price_raw > 3*coto_list THEN coto_list
                ELSE coto_price_raw END AS coto_price
      FROM base
  )
  SELECT product_id, canonical_name, brand, size, unit, ean, top_category,
         dia_sku, dia_price, dia_list_price,
         coto_sku, coto_price, coto_list AS coto_list_price,
         carrefour_sku, carrefour_price, carrefour_list_price,
         laa_sku, laa_price, laa_list_price,
         least(dia_price, coto_price, carrefour_price, laa_price)    AS min_price,
         greatest(dia_price, coto_price, carrefour_price, laa_price) AS max_price,
         round((greatest(dia_price, coto_price, carrefour_price, laa_price)
              - least(dia_price, coto_price, carrefour_price, laa_price))
             / nullif(least(dia_price, coto_price, carrefour_price, laa_price), 0)
             * 100, 1)                                               AS spread_pct
    FROM sane
   ORDER BY product_id
) TO STDOUT WITH CSV HEADER;
