-- Quantity-price tiers per variant unit (e.g. grams 25→₱10, 50→₱20)
ALTER TABLE public.tblinventory_variant_units
  ADD COLUMN IF NOT EXISTS qty_prices JSONB NOT NULL DEFAULT '[]'::jsonb;
