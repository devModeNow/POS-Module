-- Continuation 4.3: Beverages sugar level, sub-variants, unit type usage scope

ALTER TABLE public.tblinventory_variants
  ADD COLUMN IF NOT EXISTS has_sugar_level BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.tblinventory_variant_subvariants (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  variant_id    BIGINT NOT NULL REFERENCES public.tblinventory_variants(id) ON DELETE CASCADE,
  temp_type     TEXT,
  size_label    TEXT NOT NULL,
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price    NUMERIC(12,2),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_subvariants_variant
  ON public.tblinventory_variant_subvariants(variant_id)
  WHERE is_active = TRUE;

ALTER TABLE public.tblorg_unit_types
  ADD COLUMN IF NOT EXISTS usage_scope TEXT NOT NULL DEFAULT 'Others';

-- Best-effort normalize scope values (ignore if check already exists).
DO $$
BEGIN
  ALTER TABLE public.tblorg_unit_types
    ADD CONSTRAINT tblorg_unit_types_usage_scope_check
    CHECK (usage_scope IN ('Beverages', 'Others'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
