-- ============================================================================
-- Migration: Inventory Module Tables
-- Date: 2026-04-20
-- Description: Creates and formalizes all tables for the Inventory Module.
--   - tblinventory: Product/accessories inventory (formalized with timestamps, indexes)
--   - tblsuppliers: Supplier records (formalized with indexes)
--   - tblpurchases: Purchase orders with payment fields
--   - tblpo_items: Purchase order line items (formalized with indexes)
--   - tblsales_transactions: Daily sales tracking (NEW)
--   - tblinventory_actual_counts: Monthly physical inventory counts (NEW)
--
-- This migration is idempotent — safe to run multiple times.
-- All tables are scoped by org_id for multi-tenant isolation.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. tblinventory — Product/accessories inventory
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblinventory (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  part_name       TEXT NOT NULL,
  category        TEXT,
  brand           TEXT,
  description     TEXT,
  stock_qty       INTEGER NOT NULL DEFAULT 0,
  stock_warning   INTEGER NOT NULL DEFAULT 0,
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_discount_price NUMERIC(12,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns that may be missing on pre-existing tables
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS stock_warning INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS max_discount_price NUMERIC(12,2);
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS stock_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_tblinventory_org_id ON public.tblinventory(org_id);
CREATE INDEX IF NOT EXISTS idx_tblinventory_part_name ON public.tblinventory(LOWER(part_name));

-- --------------------------------------------------------------------------
-- 2. tblsuppliers — Supplier records
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblsuppliers (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  name            TEXT NOT NULL,
  contact_info    TEXT,
  email           TEXT,
  address         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblsuppliers_org_id ON public.tblsuppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_tblsuppliers_name ON public.tblsuppliers(LOWER(name));

-- Add columns that may be missing on pre-existing tblsuppliers
ALTER TABLE public.tblsuppliers ADD COLUMN IF NOT EXISTS contact_info TEXT;
ALTER TABLE public.tblsuppliers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.tblsuppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.tblsuppliers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.tblsuppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- --------------------------------------------------------------------------
-- 3. tblpurchases — Purchase orders with payment details
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblpurchases (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  supplier_id     BIGINT REFERENCES public.tblsuppliers(id),
  po_number       TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','cancelled')),
  notes           TEXT,
  order_date      DATE,
  expected_date   DATE,
  payment_type    TEXT,
  payment_date    DATE,
  payment_amount  NUMERIC(12,2) DEFAULT 0,
  reference_number TEXT,
  payment_notes   TEXT,
  created_by      BIGINT REFERENCES public.tblusers(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblpurchases_org_id ON public.tblpurchases(org_id);
CREATE INDEX IF NOT EXISTS idx_tblpurchases_status ON public.tblpurchases(status);
CREATE INDEX IF NOT EXISTS idx_tblpurchases_order_date ON public.tblpurchases(order_date);

-- Add payment columns that may be missing on pre-existing tblpurchases
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS payment_type TEXT;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS payment_date DATE;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS reference_number TEXT;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS payment_notes TEXT;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS expected_date DATE;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS order_date DATE;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE public.tblpurchases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- --------------------------------------------------------------------------
-- 4. tblpo_items — Purchase order line items
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblpo_items (
  id              BIGSERIAL PRIMARY KEY,
  purchase_id     BIGINT NOT NULL REFERENCES public.tblpurchases(id) ON DELETE CASCADE,
  inventory_id    BIGINT REFERENCES public.tblinventory(id),
  item_name       TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblpo_items_purchase_id ON public.tblpo_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_tblpo_items_inventory_id ON public.tblpo_items(inventory_id);

-- --------------------------------------------------------------------------
-- 5. tblsales_transactions — Daily sales tracking (NEW)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblsales_transactions (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  inventory_id    BIGINT NOT NULL REFERENCES public.tblinventory(id),
  quantity_sold   INTEGER NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by      BIGINT REFERENCES public.tblusers(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblsales_transactions_org_date ON public.tblsales_transactions(org_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_tblsales_transactions_inventory ON public.tblsales_transactions(inventory_id, sale_date);

-- --------------------------------------------------------------------------
-- 6. tblinventory_actual_counts — Monthly physical inventory counts (NEW)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblinventory_actual_counts (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  inventory_id    BIGINT NOT NULL REFERENCES public.tblinventory(id),
  month           DATE NOT NULL,
  actual_count    INTEGER NOT NULL DEFAULT 0,
  updated_by      BIGINT REFERENCES public.tblusers(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, inventory_id, month)
);

CREATE INDEX IF NOT EXISTS idx_tblinventory_actual_counts_lookup ON public.tblinventory_actual_counts(org_id, month);

-- --------------------------------------------------------------------------
-- 7. tblinventory_brands — Brand lookup table (NEW)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblinventory_brands (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tblinventory_brands_org ON public.tblinventory_brands(org_id, lower(name));

-- --------------------------------------------------------------------------
-- 8. tblinventory_categories — Category lookup table (NEW)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblinventory_categories (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tblinventory_categories_org ON public.tblinventory_categories(org_id, lower(name);

-- --------------------------------------------------------------------------
-- 9. tbljoborders — Add signature and missing columns
-- --------------------------------------------------------------------------
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS customer_signature_data TEXT;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS mechanic_signature_data TEXT;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS customer_approved_by TEXT;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS customer_approved_at TIMESTAMPTZ;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS mechanic_signatory_name TEXT;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS mechanic_signed_at TIMESTAMPTZ;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS labor_fee NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS technician_id BIGINT;

-- --------------------------------------------------------------------------
-- 10. tbltechnicians — Technicians/Mechanics lookup table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tbltechnicians (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  name            TEXT NOT NULL,
  contact_info    TEXT,
  email           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbltechnicians_org_id ON public.tbltechnicians(org_id);
CREATE INDEX IF NOT EXISTS idx_tbltechnicians_name ON public.tbltechnicians(org_id, LOWER(name));

-- --------------------------------------------------------------------------
-- 11. tblorg_expenses — Organization daily expenses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblorg_expenses (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  category        TEXT,
  created_by      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblorg_expenses_org ON public.tblorg_expenses(org_id, created_at DESC);

-- --------------------------------------------------------------------------
-- 12. tblorg_deposits — Organization deposits
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblorg_deposits (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  source          TEXT,
  created_by      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblorg_deposits_org ON public.tblorg_deposits(org_id, created_at DESC);

-- --------------------------------------------------------------------------
-- 13. tblinventory_adjustments — Stock adjustment history/log
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tblinventory_adjustments (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  inventory_id    BIGINT NOT NULL REFERENCES public.tblinventory(id),
  adjustment_type TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'po_receive', 'job_order', 'correction'
  qty_before      INTEGER NOT NULL DEFAULT 0,
  qty_after       INTEGER NOT NULL DEFAULT 0,
  qty_change      INTEGER NOT NULL DEFAULT 0,
  reference_type  TEXT, -- 'purchase_order', 'job_order', null for manual
  reference_id    BIGINT, -- PO id or JO id
  notes           TEXT,
  created_by      BIGINT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblinventory_adjustments_item ON public.tblinventory_adjustments(inventory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tblinventory_adjustments_org ON public.tblinventory_adjustments(org_id, created_at DESC);

-- --------------------------------------------------------------------------
-- 14. tblinventory — Add margin_percent column
-- --------------------------------------------------------------------------
ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS margin_percent NUMERIC(5,2);

-- --------------------------------------------------------------------------
-- 15. tbljo_change_logs — Job Order movement/change logs
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tbljo_change_logs (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  job_order_id    BIGINT NOT NULL,
  action          TEXT NOT NULL, -- 'created', 'approved', 'modified', 'status_change', 'payment', 'released'
  description     TEXT,
  old_value       TEXT,
  new_value       TEXT,
  created_by      BIGINT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbljo_change_logs_jo ON public.tbljo_change_logs(job_order_id, created_at DESC);

-- --------------------------------------------------------------------------
-- 16. tbljo_services — Job Order Services lookup table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tbljo_services (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  name            TEXT NOT NULL,
  default_fee     NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, LOWER(name))
);

CREATE INDEX IF NOT EXISTS idx_tbljo_services_org ON public.tbljo_services(org_id);

-- --------------------------------------------------------------------------
-- 17. tbljoborders — Add warranty and parts_supplied_by columns
-- --------------------------------------------------------------------------
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS warranty_text TEXT;
ALTER TABLE public.tbljoborders ADD COLUMN IF NOT EXISTS parts_supplied_by TEXT DEFAULT 'car_expert';
