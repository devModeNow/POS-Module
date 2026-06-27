-- TASK 1 Continuation 2.1: product variants, payment methods, restructured seed data
BEGIN;

-- ── Product grouping (POS card level) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tblinventory_products (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT,
  brand       TEXT,
  description TEXT,
  image_url   TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_products_org_name
  ON public.tblinventory_products(org_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_inv_products_org ON public.tblinventory_products(org_id, is_active);

-- ── Sellable SKUs / variants ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tblinventory_variants (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  product_id      BIGINT NOT NULL REFERENCES public.tblinventory_products(id) ON DELETE CASCADE,
  variant_name    TEXT NOT NULL,
  stock_qty       INTEGER NOT NULL DEFAULT 0,
  stock_warning   INTEGER NOT NULL DEFAULT 0,
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price      NUMERIC(12,2),
  unit_type       TEXT,
  margin_percent  NUMERIC(5,2),
  image_url       TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_variants_product_name
  ON public.tblinventory_variants(product_id, lower(variant_name));

CREATE INDEX IF NOT EXISTS idx_inv_variants_org ON public.tblinventory_variants(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_variants_product ON public.tblinventory_variants(product_id);

-- ── Payment methods ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tblpayment_methods (
  id               BIGSERIAL PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  parent_code      TEXT,
  settlement_mode  TEXT NOT NULL DEFAULT 'immediate'
                     CHECK (settlement_mode IN ('immediate', 'floating')),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_org ON public.tblpayment_methods(org_id, is_active);

ALTER TABLE public.tblsales_transactions
  ADD COLUMN IF NOT EXISTS variant_id BIGINT REFERENCES public.tblinventory_variants(id),
  ADD COLUMN IF NOT EXISTS payment_method_id BIGINT REFERENCES public.tblpayment_methods(id),
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'settled'
    CHECK (payment_status IN ('settled', 'floating'));

ALTER TABLE public.tblsales_transactions
  ALTER COLUMN inventory_id DROP NOT NULL;

-- Seed payment methods for POS orgs
INSERT INTO public.tblpayment_methods (org_id, code, name, parent_code, settlement_mode, sort_order)
SELECT o.id, v.code, v.name, v.parent_code, v.settlement_mode, v.sort_order
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('cash',           'Cash',                    NULL,     'immediate', 1),
    ('gcash',          'GCash',                   'online', 'immediate', 2),
    ('maya',           'Maya',                    'online', 'immediate', 3),
    ('bank_transfer',  'Bank Transfer',           'online', 'immediate', 4),
    ('food_panda',     'Food Panda',              NULL,     'floating',  5)
) AS v(code, name, parent_code, settlement_mode, sort_order)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, code) DO NOTHING;

-- Remove legacy flat POS snack rows (replaced by products + variants)
DELETE FROM public.tblsales_transactions st
USING public.tblinventory i, public.tblorganizations o
WHERE st.inventory_id = i.id
  AND i.org_id = o.id
  AND o.code IN ('point-of-sales', 'pos')
  AND i.brand = 'POS Snacks';

DELETE FROM public.tblinventory i
USING public.tblorganizations o
WHERE i.org_id = o.id
  AND o.code IN ('point-of-sales', 'pos')
  AND i.brand = 'POS Snacks';

-- Seed categories (idempotent)
INSERT INTO public.tblinventory_categories (org_id, name)
SELECT o.id, c.name
FROM public.tblorganizations o
CROSS JOIN (
  VALUES ('Nuts & Seeds'), ('Corn Snacks'), ('Gummies & Jelly'), ('Beans & Legumes')
) AS c(name)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT DO NOTHING;

-- Seed products + variants for POS orgs
DO $$
DECLARE
  v_org_id BIGINT;
  v_pid BIGINT;
BEGIN
  FOR v_org_id IN
    SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos')
  LOOP
    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description)
    VALUES (v_org_id, 'Peanut', 'Nuts & Seeds', 'POS Snacks', 'Assorted peanut snacks')
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Peanut');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Roasted', 120, 20, 28.00, 45.00, 39.00, 60.71, 'pack', 1), (v_org_id, v_pid, 'Salted', 95, 15, 25.00, 40.00, NULL, 60.00, 'pack', 2)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Cashew Mix', 'Nuts & Seeds', 'POS Snacks', 'Honey roasted cashew blend') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Cashew Mix');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Honey Roasted', 40, 10, 85.00, 140.00, 125.00, 64.71, 'pack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Mixed Nuts', 'Nuts & Seeds', 'POS Snacks', 'Bulk mixed nuts for parties') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Mixed Nuts');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Party Sack', 25, 5, 180.00, 320.00, 299.00, 77.78, 'sack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Fried Corn', 'Corn Snacks', 'POS Snacks', 'Crunchy fried corn snack') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Fried Corn');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Classic', 80, 15, 18.00, 30.00, 25.00, 66.67, 'pack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Sweet Corn Chips', 'Corn Snacks', 'POS Snacks', 'Sweet corn chip curls') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Sweet Corn Chips');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Original', 70, 12, 15.00, 28.00, NULL, 86.67, 'pack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Spicy Corn Nuts', 'Corn Snacks', 'POS Snacks', 'Spicy chili corn nuts') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Spicy Corn Nuts');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Spicy', 55, 10, 20.00, 35.00, 32.00, 75.00, 'grams', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Caramel Popcorn', 'Corn Snacks', 'POS Snacks', 'Caramel coated popcorn') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Caramel Popcorn');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Classic', 45, 8, 35.00, 58.00, 52.00, 65.71, 'pack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Gummy Bears', 'Gummies & Jelly', 'POS Snacks', 'Assorted fruit gummy bears') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Gummy Bears');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Assorted Fruits', 100, 20, 22.00, 38.00, 34.00, 72.73, 'pack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Gummy Worms', 'Gummies & Jelly', 'POS Snacks', 'Sour gummy worm strips') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Gummy Worms');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Sour', 75, 15, 24.00, 42.00, 38.00, 75.00, 'pack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Jellyace', 'Gummies & Jelly', 'POS Snacks', 'Assorted jellyace cups') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Jellyace');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Assorted Cups', 90, 18, 18.00, 32.00, NULL, 77.78, 'pack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Jelly Sticks', 'Gummies & Jelly', 'POS Snacks', 'Fruit flavored jelly sticks') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Jelly Sticks');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Fruit Flavored', 85, 15, 12.00, 22.00, NULL, 83.33, 'tray', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Baked Beans', 'Beans & Legumes', 'POS Snacks', 'Sweet baked beans in sauce') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Baked Beans');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Sweet', 60, 10, 30.00, 50.00, NULL, 66.67, 'can', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Bean Snack', 'Beans & Legumes', 'POS Snacks', 'Crispy roasted bean snack') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Bean Snack');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Crispy', 65, 12, 16.00, 28.00, 24.00, 75.00, 'pack', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.tblinventory_products (org_id, name, category, brand, description) VALUES (v_org_id, 'Broad Beans', 'Beans & Legumes', 'POS Snacks', 'Garlic flavored broad beans') ON CONFLICT DO NOTHING;
    SELECT id INTO v_pid FROM public.tblinventory_products WHERE org_id = v_org_id AND lower(name) = lower('Broad Beans');
    INSERT INTO public.tblinventory_variants (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type, sort_order)
    VALUES (v_org_id, v_pid, 'Garlic', 50, 10, 19.00, 33.00, NULL, 73.68, 'pack', 1) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

COMMIT;
