-- Dual stock: wholesale stock_qty + retail_stock_qty (grams) for retail/grams units

ALTER TABLE public.tblinventory_variants
  ADD COLUMN IF NOT EXISTS retail_stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0;

ALTER TABLE public.tblinventory_variants
  ADD COLUMN IF NOT EXISTS retail_stock_warning NUMERIC(12, 3) NOT NULL DEFAULT 0;

-- One-time: move gram-pool stock into retail for variants that sell by grams.
UPDATE public.tblinventory_variants v
SET retail_stock_qty = COALESCE(v.stock_qty, 0),
    retail_stock_warning = COALESCE(v.stock_warning, 0),
    stock_qty = 0,
    stock_warning = 0,
    updated_at = NOW()
WHERE COALESCE(v.retail_stock_qty, 0) = 0
  AND COALESCE(v.stock_qty, 0) > 0
  AND EXISTS (
    SELECT 1
    FROM public.tblinventory_variant_units vu
    WHERE vu.variant_id = v.id
      AND COALESCE(vu.is_active, TRUE) = TRUE
      AND (
        COALESCE(vu.is_manual_entry, FALSE) = TRUE
        OR LOWER(COALESCE(vu.unit_type, '')) IN ('grams', 'gram', 'manual')
        OR LOWER(COALESCE(vu.product_source, '')) = 'retail'
      )
  );
