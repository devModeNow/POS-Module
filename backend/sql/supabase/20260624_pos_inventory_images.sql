-- POS inventory product images
BEGIN;

ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMIT;
