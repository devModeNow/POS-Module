-- Continuation 2.4: multiple unit types per variant

CREATE TABLE IF NOT EXISTS public.tblinventory_variant_units (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  variant_id      BIGINT NOT NULL REFERENCES public.tblinventory_variants(id) ON DELETE CASCADE,
  unit_type       TEXT NOT NULL,
  selling_price   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sale_price      NUMERIC(12, 2),
  is_manual_entry BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_units_variant_type
  ON public.tblinventory_variant_units (variant_id, lower(unit_type))
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_variant_units_variant
  ON public.tblinventory_variant_units (variant_id, is_active);

ALTER TABLE public.tblsales_transactions
  ADD COLUMN IF NOT EXISTS unit_type TEXT;

-- Seed one unit row per existing variant from legacy unit_type + prices
INSERT INTO public.tblinventory_variant_units (
  org_id, variant_id, unit_type, selling_price, sale_price, is_manual_entry, sort_order
)
SELECT
  v.org_id,
  v.id,
  COALESCE(NULLIF(TRIM(v.unit_type), ''), 'piece'),
  v.selling_price,
  v.sale_price,
  (COALESCE(v.unit_type, '') = 'manual'),
  1
FROM public.tblinventory_variants v
WHERE v.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.tblinventory_variant_units u
    WHERE u.variant_id = v.id AND u.is_active = TRUE
  );
