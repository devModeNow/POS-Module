-- Default sell quantity per unit type (used by cashier product popup)
ALTER TABLE public.tblinventory_variant_units
  ADD COLUMN IF NOT EXISTS default_qty NUMERIC(12, 3) NOT NULL DEFAULT 1;

-- Seed sensible defaults for existing rows still at 1 that are grams/manual
UPDATE public.tblinventory_variant_units
SET default_qty = 200,
    updated_at = NOW()
WHERE default_qty = 1
  AND (
    COALESCE(is_manual_entry, FALSE) = TRUE
    OR LOWER(COALESCE(unit_type, '')) IN ('grams', 'gram', 'manual')
  );
