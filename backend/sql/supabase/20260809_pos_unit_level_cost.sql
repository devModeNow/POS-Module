-- Per unit-type cost on tblinventory_variant_units
ALTER TABLE public.tblinventory_variant_units
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- Seed from variant cost when unit cost is still 0
UPDATE public.tblinventory_variant_units vu
SET cost_price = COALESCE(v.cost_price, 0),
    updated_at = NOW()
FROM public.tblinventory_variants v
WHERE v.id = vu.variant_id
  AND COALESCE(vu.cost_price, 0) = 0
  AND COALESCE(v.cost_price, 0) > 0;
