-- Continuation 4.4: Retail / Wholesale product source (variant + per unit type)
-- Rule: grams/gram/manual → Retail; all other unit types → Wholesale.

ALTER TABLE public.tblinventory_variants
  ADD COLUMN IF NOT EXISTS product_source TEXT NOT NULL DEFAULT 'Wholesale';

ALTER TABLE public.tblinventory_variant_units
  ADD COLUMN IF NOT EXISTS product_source TEXT NOT NULL DEFAULT 'Wholesale';

ALTER TABLE public.tblinventory_variants
  ALTER COLUMN product_source SET DEFAULT 'Wholesale';

ALTER TABLE public.tblinventory_variant_units
  ALTER COLUMN product_source SET DEFAULT 'Wholesale';

DO $$
BEGIN
  ALTER TABLE public.tblinventory_variants
    ADD CONSTRAINT tblinventory_variants_product_source_check
    CHECK (product_source IN ('Retail', 'Wholesale'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.tblinventory_variant_units
    ADD CONSTRAINT tblinventory_variant_units_product_source_check
    CHECK (product_source IN ('Retail', 'Wholesale'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.tblpo_items
  ADD COLUMN IF NOT EXISTS product_source TEXT;

DO $$
BEGIN
  ALTER TABLE public.tblpo_items
    ADD CONSTRAINT tblpo_items_product_source_check
    CHECK (product_source IS NULL OR product_source IN ('Retail', 'Wholesale'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Assign source strictly from unit type.
UPDATE public.tblinventory_variant_units
SET product_source = CASE
  WHEN LOWER(COALESCE(unit_type, '')) IN ('grams', 'gram', 'manual')
    OR COALESCE(is_manual_entry, FALSE) = TRUE
  THEN 'Retail'
  ELSE 'Wholesale'
END;

-- Variant-level source mirrors the default unit only.
UPDATE public.tblinventory_variants v
SET product_source = COALESCE(
  (
    SELECT vu.product_source
    FROM public.tblinventory_variant_units vu
    WHERE vu.variant_id = v.id
      AND COALESCE(vu.is_active, TRUE) = TRUE
      AND COALESCE(vu.is_default, FALSE) = TRUE
    ORDER BY vu.id ASC
    LIMIT 1
  ),
  CASE
    WHEN LOWER(COALESCE(v.unit_type, '')) IN ('grams', 'gram', 'manual') THEN 'Retail'
    ELSE 'Wholesale'
  END
);
