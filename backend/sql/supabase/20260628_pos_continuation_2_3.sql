-- Continuation 2.3: manual gram entry at POS, decimal quantities

ALTER TABLE public.tblinventory_variants
  ALTER COLUMN stock_qty TYPE NUMERIC(12, 3) USING stock_qty::numeric,
  ALTER COLUMN stock_warning TYPE NUMERIC(12, 3) USING stock_warning::numeric;

ALTER TABLE public.tblsales_transactions
  ALTER COLUMN quantity_sold TYPE NUMERIC(12, 3) USING quantity_sold::numeric;

-- Example manual (by gram) variant under Peanut for POS org
DO $$
DECLARE
  v_org_id BIGINT;
  v_pid    BIGINT;
BEGIN
  SELECT id INTO v_org_id FROM public.tblorganizations WHERE code = 'point-of-sales' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_pid FROM public.tblinventory_products
  WHERE org_id = v_org_id AND lower(name) = lower('Peanut') AND is_active = TRUE
  LIMIT 1;

  IF v_pid IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tblinventory_variants
    WHERE org_id = v_org_id AND product_id = v_pid AND lower(variant_name) = lower('By weight (manual)')
  ) THEN
    INSERT INTO public.tblinventory_variants (
      org_id, product_id, variant_name, stock_qty, stock_warning,
      cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order
    ) VALUES (
      v_org_id, v_pid, 'By weight (manual)', 50000, 1000,
      0.35, 0.55, 0.45, NULL, 'manual', 99
    );
  END IF;
END $$;
