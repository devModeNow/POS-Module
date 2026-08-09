-- Per sub-variant stock for beverages (Hot/Iced × size availability).
ALTER TABLE public.tblinventory_variant_subvariants
  ADD COLUMN IF NOT EXISTS stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_warning NUMERIC(12, 3) NOT NULL DEFAULT 0;
