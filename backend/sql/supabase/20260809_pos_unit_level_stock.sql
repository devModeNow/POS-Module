-- Per unit-type stock on tblinventory_variant_units

ALTER TABLE public.tblinventory_variant_units
  ADD COLUMN IF NOT EXISTS stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0;

ALTER TABLE public.tblinventory_variant_units
  ADD COLUMN IF NOT EXISTS stock_warning NUMERIC(12, 3) NOT NULL DEFAULT 0;

-- Migrate: grams/retail units get retail_stock_qty; default wholesale unit gets stock_qty.
UPDATE public.tblinventory_variant_units vu
SET stock_qty = CASE
      WHEN COALESCE(vu.is_manual_entry, FALSE) = TRUE
        OR LOWER(COALESCE(vu.unit_type, '')) IN ('grams', 'gram', 'manual')
        OR LOWER(COALESCE(vu.product_source, '')) = 'retail'
      THEN COALESCE(v.retail_stock_qty, 0)
      WHEN COALESCE(vu.is_default, FALSE) = TRUE
      THEN COALESCE(v.stock_qty, 0)
      ELSE COALESCE(vu.stock_qty, 0)
    END,
    stock_warning = CASE
      WHEN COALESCE(vu.is_manual_entry, FALSE) = TRUE
        OR LOWER(COALESCE(vu.unit_type, '')) IN ('grams', 'gram', 'manual')
        OR LOWER(COALESCE(vu.product_source, '')) = 'retail'
      THEN COALESCE(v.retail_stock_warning, 0)
      WHEN COALESCE(vu.is_default, FALSE) = TRUE
      THEN COALESCE(v.stock_warning, 0)
      ELSE COALESCE(vu.stock_warning, 0)
    END,
    updated_at = NOW()
FROM public.tblinventory_variants v
WHERE v.id = vu.variant_id
  AND COALESCE(vu.stock_qty, 0) = 0
  AND (
    COALESCE(v.stock_qty, 0) > 0
    OR COALESCE(v.retail_stock_qty, 0) > 0
  );
