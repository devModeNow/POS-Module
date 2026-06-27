-- Widen margin_percent to avoid numeric field overflow on high markups
ALTER TABLE public.tblinventory_variants
  ALTER COLUMN margin_percent TYPE NUMERIC(10, 2);

ALTER TABLE public.tblinventory
  ALTER COLUMN margin_percent TYPE NUMERIC(10, 2);
