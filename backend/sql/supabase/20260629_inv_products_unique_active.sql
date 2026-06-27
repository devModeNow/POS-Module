-- Allow reusing product names after soft-delete (active names only must be unique)
DROP INDEX IF EXISTS public.idx_inv_products_org_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_products_org_name
  ON public.tblinventory_products (org_id, lower(name))
  WHERE is_active = TRUE;
