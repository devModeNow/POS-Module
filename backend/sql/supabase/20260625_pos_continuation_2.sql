-- TASK 1 Continuation 2.0: discounts, sale prices, snack seed data
BEGIN;

CREATE TABLE IF NOT EXISTS public.tbldiscounts (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL,
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed', 'auto_sale', 'auto_bulk')),
  discount_value  NUMERIC(12,2) NOT NULL DEFAULT 0,
  bulk_min_qty    INTEGER,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tbldiscounts_org ON public.tbldiscounts(org_id, is_active);

ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2);

ALTER TABLE public.tblsales_transactions
  ADD COLUMN IF NOT EXISTS discount_id BIGINT REFERENCES public.tbldiscounts(id);

-- Seed discount types for POS organizations
INSERT INTO public.tbldiscounts (org_id, name, code, discount_type, discount_value, bulk_min_qty, sort_order, description)
SELECT o.id, v.name, v.code, v.discount_type, v.discount_value, v.bulk_min_qty, v.sort_order, v.description
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('Senior Citizen Discount', 'senior-citizen', 'percent',    10, NULL::int, 1, '10% discount for senior citizens'),
    ('PWD Discount',            'pwd',            'percent',    10, NULL,       2, '10% discount for persons with disability'),
    ('Sale Price',              'auto-sale',      'auto_sale',   0, NULL,       3, 'Automatically applies product sale price when set'),
    ('Bulk Sale (5+ qty)',      'auto-bulk',      'auto_bulk',   5, 5,          4, '5% off when buying 5 or more of the same item')
) AS v(name, code, discount_type, discount_value, bulk_min_qty, sort_order, description)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, code) DO NOTHING;

-- Seed product categories for POS org
INSERT INTO public.tblinventory_categories (org_id, name)
SELECT o.id, c.name
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('Nuts & Seeds'),
    ('Corn Snacks'),
    ('Gummies & Jelly'),
    ('Beans & Legumes')
) AS c(name)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT DO NOTHING;

-- Seed snack products (skip if part_name already exists for org)
INSERT INTO public.tblinventory
  (org_id, part_name, category, brand, description, stock_qty, stock_warning,
   cost_price, selling_price, sale_price, margin_percent, unit_type, updated_at)
SELECT o.id, p.part_name, p.category, p.brand, p.description, p.stock_qty, p.stock_warning,
       p.cost_price, p.selling_price, p.sale_price, p.margin_percent, p.unit_type, NOW()
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('Roasted Peanuts',      'Nuts & Seeds',    'POS Snacks', 'Classic roasted peanuts',           120, 20, 28.00,  45.00,  39.00, 60.71, 'pack'),
    ('Salted Peanuts',       'Nuts & Seeds',    'POS Snacks', 'Lightly salted peanuts',            95,  15, 25.00,  40.00,  NULL,  60.00, 'pack'),
    ('Honey Cashew Mix',     'Nuts & Seeds',    'POS Snacks', 'Honey roasted cashew blend',        40,  10, 85.00, 140.00, 125.00, 64.71, 'pack'),
    ('Fried Corn',           'Corn Snacks',     'POS Snacks', 'Crunchy fried corn snack',          80,  15, 18.00,  30.00,  25.00, 66.67, 'pack'),
    ('Sweet Corn Chips',     'Corn Snacks',     'POS Snacks', 'Sweet corn chip curls',             70,  12, 15.00,  28.00,  NULL,  86.67, 'pack'),
    ('Spicy Corn Nuts',      'Corn Snacks',     'POS Snacks', 'Spicy chili corn nuts',             55,  10, 20.00,  35.00,  32.00, 75.00, 'grams'),
    ('Gummy Bears',          'Gummies & Jelly', 'POS Snacks', 'Assorted fruit gummy bears',        100, 20, 22.00,  38.00,  34.00, 72.73, 'pack'),
    ('Jellyace Assorted',    'Gummies & Jelly', 'POS Snacks', 'Assorted jellyace cups',            90,  18, 18.00,  32.00,  NULL,  77.78, 'pack'),
    ('Sour Gummy Worms',     'Gummies & Jelly', 'POS Snacks', 'Sour gummy worm strips',            75,  15, 24.00,  42.00,  38.00, 75.00, 'pack'),
    ('Baked Beans',          'Beans & Legumes', 'POS Snacks', 'Sweet baked beans in sauce',        60,  10, 30.00,  50.00,  NULL,  66.67, 'can'),
    ('Crispy Bean Snack',    'Beans & Legumes', 'POS Snacks', 'Crispy roasted bean snack',         65,  12, 16.00,  28.00,  24.00, 75.00, 'pack'),
    ('Garlic Broad Beans',   'Beans & Legumes', 'POS Snacks', 'Garlic flavored broad beans',       50,  10, 19.00,  33.00,  NULL,  73.68, 'pack'),
    ('Mixed Nuts Sack',      'Nuts & Seeds',    'POS Snacks', 'Bulk mixed nuts for parties',       25,   5, 180.00, 320.00, 299.00, 77.78, 'sack'),
    ('Caramel Popcorn',      'Corn Snacks',     'POS Snacks', 'Caramel coated popcorn',            45,   8, 35.00,  58.00,  52.00, 65.71, 'pack'),
    ('Fruit Jelly Sticks',   'Gummies & Jelly', 'POS Snacks', 'Fruit flavored jelly sticks',       85,  15, 12.00,  22.00,  NULL,  83.33, 'tray')
) AS p(part_name, category, brand, description, stock_qty, stock_warning, cost_price, selling_price, sale_price, margin_percent, unit_type)
WHERE o.code IN ('point-of-sales', 'pos')
  AND NOT EXISTS (
    SELECT 1 FROM public.tblinventory i
    WHERE i.org_id = o.id AND LOWER(TRIM(i.part_name)) = LOWER(TRIM(p.part_name))
  );

COMMIT;
