-- POS barcode scanning: unique barcode per org on sellable variants
ALTER TABLE public.tblinventory_variants
  ADD COLUMN IF NOT EXISTS barcode TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_variants_org_barcode
  ON public.tblinventory_variants (org_id, lower(btrim(barcode)))
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';
