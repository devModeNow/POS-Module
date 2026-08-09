-- Allow multiple unit rows with the same unit_type on one variant
DROP INDEX IF EXISTS public.idx_variant_units_variant_type;

CREATE INDEX IF NOT EXISTS idx_variant_units_variant_type_nonunique
  ON public.tblinventory_variant_units (variant_id, lower(unit_type))
  WHERE is_active = TRUE;

-- Point sales at a specific variant unit row (needed when unit_type is duplicated)
ALTER TABLE public.tblsales_transactions
  ADD COLUMN IF NOT EXISTS variant_unit_id BIGINT;
