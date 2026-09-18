-- =============================================================================
-- 000_migration_new_full_schema.sql
-- POS + Organizational centralization — bundled schema for a new database
--
-- Scope kept:
--   organizations, users, RBAC, settings, inventory, purchasing, POS
-- Scope excluded (legacy CBIS / unrelated):
--   catering, quotations, job orders, vehicles, technicians, projects,
--   materials ledger, accounting / cheque vouchers / journals / BIR 2307
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT. Safe to re-run on an empty or
-- partially-created public schema. CREATE tables first (final columns baked in).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- Section 1: Organizations, RBAC, Users
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tblorganizations (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  address       TEXT,
  contact       TEXT,
  email         TEXT,
  logo_url      TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tblrbac (
  id                BIGSERIAL PRIMARY KEY,
  "roleName"        VARCHAR(50) NOT NULL,
  "roleMenus"       TEXT,
  "rolePermission"  TEXT,
  created_by        BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  org_id            BIGINT REFERENCES public.tblorganizations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tblrbac_org_rolename
  ON public.tblrbac (COALESCE(org_id, 0), lower("roleName"));

CREATE INDEX IF NOT EXISTS idx_tblrbac_org_id ON public.tblrbac(org_id);

CREATE TABLE IF NOT EXISTS public.tblusers (
  id                BIGSERIAL PRIMARY KEY,
  username          VARCHAR(50) UNIQUE,
  password          TEXT,
  fullname          VARCHAR(100),
  birthdate         DATE,
  address           TEXT,
  email             VARCHAR(100),
  contact           VARCHAR(50),
  profile_picture   TEXT,
  status            SMALLINT DEFAULT 1,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  created_by        BIGINT DEFAULT 1,
  "roleId"          BIGINT DEFAULT 1 REFERENCES public.tblrbac(id) ON DELETE SET NULL,
  org_id            BIGINT REFERENCES public.tblorganizations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tblusers_org_id ON public.tblusers(org_id);
CREATE INDEX IF NOT EXISTS idx_tblusers_role_id ON public.tblusers("roleId");


-- =============================================================================
-- Section 2: Normalized auth (permissions, menus, overrides)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.auth_permission_keys (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  module      TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'feature',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_permission_keys_scope_check
    CHECK (scope IN ('feature', 'menu', 'tab', 'action'))
);

CREATE TABLE IF NOT EXISTS public.auth_role_permissions (
  id              BIGSERIAL PRIMARY KEY,
  role_id         BIGINT NOT NULL REFERENCES public.tblrbac(id) ON DELETE CASCADE,
  permission_id   BIGINT NOT NULL REFERENCES public.auth_permission_keys(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_role_permissions_role_id
  ON public.auth_role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_auth_role_permissions_permission_id
  ON public.auth_role_permissions(permission_id);

CREATE TABLE IF NOT EXISTS public.auth_user_permission_overrides (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES public.tblusers(id) ON DELETE CASCADE,
  permission_id   BIGINT NOT NULL REFERENCES public.auth_permission_keys(id) ON DELETE CASCADE,
  effect          TEXT NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_user_permission_overrides_effect_check
    CHECK (effect IN ('allow', 'deny')),
  UNIQUE (user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_permission_overrides_user_id
  ON public.auth_user_permission_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_user_permission_overrides_permission_id
  ON public.auth_user_permission_overrides(permission_id);

CREATE TABLE IF NOT EXISTS public.auth_user_roles (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES public.tblusers(id) ON DELETE CASCADE,
  role_id     BIGINT NOT NULL REFERENCES public.tblrbac(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_roles_user_id ON public.auth_user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_user_roles_role_id ON public.auth_user_roles(role_id);

CREATE TABLE IF NOT EXISTS public.auth_menus (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  parent_key  TEXT,
  route       TEXT,
  icon        TEXT,
  order_no    INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW public.v_auth_user_effective_permissions AS
WITH role_grants AS (
  SELECT ur.user_id, rp.permission_id, TRUE AS granted_by_role
  FROM public.auth_user_roles ur
  JOIN public.auth_role_permissions rp ON rp.role_id = ur.role_id
), user_overrides AS (
  SELECT
    user_id,
    permission_id,
    MAX(CASE WHEN effect = 'allow' THEN 1 ELSE 0 END) AS has_allow,
    MAX(CASE WHEN effect = 'deny' THEN 1 ELSE 0 END) AS has_deny
  FROM public.auth_user_permission_overrides
  GROUP BY user_id, permission_id
), all_candidates AS (
  SELECT user_id, permission_id FROM role_grants
  UNION
  SELECT user_id, permission_id FROM user_overrides
)
SELECT
  c.user_id,
  pk.key AS permission_key,
  pk.label AS permission_label,
  pk.module,
  pk.scope,
  CASE
    WHEN COALESCE(uo.has_deny, 0) = 1 THEN FALSE
    WHEN COALESCE(uo.has_allow, 0) = 1 THEN TRUE
    WHEN rg.granted_by_role IS TRUE THEN TRUE
    ELSE FALSE
  END AS is_allowed,
  CASE
    WHEN COALESCE(uo.has_deny, 0) = 1 THEN 'user-deny'
    WHEN COALESCE(uo.has_allow, 0) = 1 THEN 'user-allow'
    WHEN rg.granted_by_role IS TRUE THEN 'role'
    ELSE 'none'
  END AS source
FROM all_candidates c
JOIN public.auth_permission_keys pk ON pk.id = c.permission_id
LEFT JOIN role_grants rg ON rg.user_id = c.user_id AND rg.permission_id = c.permission_id
LEFT JOIN user_overrides uo ON uo.user_id = c.user_id AND uo.permission_id = c.permission_id;


-- =============================================================================
-- Section 3: Organization settings, menus, unit types, cash movement
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tblorg_settings (
  id                            BIGSERIAL PRIMARY KEY,
  org_id                        BIGINT NOT NULL UNIQUE REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  business_name                 TEXT,
  business_address              TEXT,
  business_contact              TEXT,
  business_email                TEXT,
  business_owner                TEXT,
  business_description          TEXT,
  logo_light                    TEXT,
  logo_dark                     TEXT,
  website_tab_name              TEXT,
  routing_tab_name              TEXT DEFAULT '{route}',
  dr_template_pdf               TEXT,
  print_paper_size              TEXT DEFAULT 'A4',
  print_show_logo               TEXT DEFAULT 'true',
  print_logo_variant            TEXT DEFAULT 'light',
  print_footer_text             TEXT,
  print_quote_header_color      TEXT DEFAULT '#0f9cdf',
  print_quote_show_terms        TEXT DEFAULT 'true',
  print_quote_show_misc         TEXT DEFAULT 'false',
  print_quote_show_validity     TEXT DEFAULT 'true',
  print_so_show_discount        TEXT DEFAULT 'false',
  print_so_show_payment_terms   TEXT DEFAULT 'true',
  print_so_show_serials         TEXT DEFAULT 'true',
  print_dr_show_serials         TEXT DEFAULT 'true',
  print_dr_show_signature       TEXT DEFAULT 'true',
  print_address_details         TEXT,
  print_address_show_so_invoice TEXT DEFAULT 'true',
  print_address_show_quotation  TEXT DEFAULT 'true',
  print_address_show_dr         TEXT DEFAULT 'true',
  print_signature_prepared_by   TEXT,
  print_signature_checked_by    TEXT,
  print_signature_approved_by   TEXT,
  pos_receipt_paper_width       TEXT DEFAULT '80mm',
  pos_receipt_show_logo         BOOLEAN DEFAULT TRUE,
  pos_receipt_footer_text       TEXT,
  pos_printer_name              TEXT,
  pos_receipt_template_json     TEXT,
  pos_printer_connection_type   TEXT DEFAULT 'printhub',
  pos_printer_host              TEXT,
  pos_printer_port              TEXT DEFAULT '9100',
  pos_printer_usb_vendor_id     TEXT,
  pos_printer_usb_product_id    TEXT,
  pos_printer_usb_product_name  TEXT,
  pos_printer_bt_device_id      TEXT,
  pos_printer_bt_device_name    TEXT,
  pos_cash_drawer_enabled       BOOLEAN DEFAULT FALSE,
  pos_cash_drawer_open_on       TEXT DEFAULT 'before_receipt',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tblorg_menus (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  menu_key    TEXT NOT NULL,
  menu_label  TEXT NOT NULL,
  menu_icon   TEXT,
  menu_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, menu_key)
);

CREATE INDEX IF NOT EXISTS idx_tblorg_menus_org_id ON public.tblorg_menus(org_id);

CREATE TABLE IF NOT EXISTS public.tblorg_unit_types (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  label           TEXT NOT NULL,
  is_manual_entry BOOLEAN NOT NULL DEFAULT FALSE,
  usage_scope     TEXT NOT NULL DEFAULT 'Others',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, code),
  CONSTRAINT tblorg_unit_types_usage_scope_check
    CHECK (usage_scope IN ('Beverages', 'Others'))
);

CREATE INDEX IF NOT EXISTS idx_org_unit_types_org ON public.tblorg_unit_types(org_id);

CREATE TABLE IF NOT EXISTS public.tblorg_expenses (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  category        TEXT,
  expense_date    DATE,
  created_by      BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  deleted_reason  TEXT,
  deleted_by      BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tblorg_expenses_org
  ON public.tblorg_expenses(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tblorg_expenses_deleted
  ON public.tblorg_expenses(org_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.tblorg_deposits (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  source      TEXT,
  created_by  BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblorg_deposits_org
  ON public.tblorg_deposits(org_id, created_at DESC);


-- =============================================================================
-- Section 4: Inventory (parts + POS products / variants)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tblinventory (
  id                  BIGSERIAL PRIMARY KEY,
  org_id              BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  part_name           TEXT NOT NULL,
  category            TEXT,
  brand               TEXT,
  description         TEXT,
  image_url           TEXT,
  unit_type           TEXT,
  stock_qty           INTEGER NOT NULL DEFAULT 0,
  stock_warning       INTEGER NOT NULL DEFAULT 0,
  cost_price          NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price          NUMERIC(12,2),
  max_discount_price  NUMERIC(12,2),
  margin_percent      NUMERIC(10,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblinventory_org_id ON public.tblinventory(org_id);
CREATE INDEX IF NOT EXISTS idx_tblinventory_part_name ON public.tblinventory(LOWER(part_name));

CREATE TABLE IF NOT EXISTS public.tblinventory_brands (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tblinventory_brands_org
  ON public.tblinventory_brands(org_id, lower(name));

CREATE TABLE IF NOT EXISTS public.tblinventory_categories (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tblinventory_categories_org
  ON public.tblinventory_categories(org_id, lower(name));

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
  ON public.tblinventory_products (org_id, lower(name))
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_inv_products_org
  ON public.tblinventory_products(org_id, is_active);

CREATE TABLE IF NOT EXISTS public.tblinventory_variants (
  id                    BIGSERIAL PRIMARY KEY,
  org_id                BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  product_id            BIGINT NOT NULL REFERENCES public.tblinventory_products(id) ON DELETE CASCADE,
  variant_name          TEXT NOT NULL,
  barcode               TEXT,
  stock_qty             NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_warning         NUMERIC(12,3) NOT NULL DEFAULT 0,
  retail_stock_qty      NUMERIC(12,3) NOT NULL DEFAULT 0,
  retail_stock_warning  NUMERIC(12,3) NOT NULL DEFAULT 0,
  cost_price            NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price            NUMERIC(12,2),
  unit_type             TEXT,
  margin_percent        NUMERIC(10,2),
  image_url             TEXT,
  product_source        TEXT NOT NULL DEFAULT 'Wholesale',
  has_sugar_level       BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tblinventory_variants_product_source_check
    CHECK (product_source IN ('Retail', 'Wholesale'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_variants_product_name
  ON public.tblinventory_variants(product_id, lower(variant_name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_variants_org_barcode
  ON public.tblinventory_variants (org_id, lower(btrim(barcode)))
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';
CREATE INDEX IF NOT EXISTS idx_inv_variants_org
  ON public.tblinventory_variants(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_variants_product
  ON public.tblinventory_variants(product_id);

CREATE TABLE IF NOT EXISTS public.tblinventory_variant_units (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  variant_id      BIGINT NOT NULL REFERENCES public.tblinventory_variants(id) ON DELETE CASCADE,
  unit_type       TEXT NOT NULL,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price      NUMERIC(12,2),
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_qty       NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_warning   NUMERIC(12,3) NOT NULL DEFAULT 0,
  default_qty     NUMERIC(12,3) NOT NULL DEFAULT 1,
  qty_prices      JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_source  TEXT NOT NULL DEFAULT 'Wholesale',
  is_manual_entry BOOLEAN NOT NULL DEFAULT FALSE,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tblinventory_variant_units_product_source_check
    CHECK (product_source IN ('Retail', 'Wholesale'))
);

CREATE INDEX IF NOT EXISTS idx_variant_units_variant
  ON public.tblinventory_variant_units (variant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_variant_units_variant_type_nonunique
  ON public.tblinventory_variant_units (variant_id, lower(unit_type))
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.tblinventory_variant_subvariants (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  variant_id      BIGINT NOT NULL REFERENCES public.tblinventory_variants(id) ON DELETE CASCADE,
  temp_type       TEXT,
  size_label      TEXT NOT NULL,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price      NUMERIC(12,2),
  stock_qty       NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_warning   NUMERIC(12,3) NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_subvariants_variant
  ON public.tblinventory_variant_subvariants(variant_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.tblinventory_actual_counts (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  inventory_id  BIGINT NOT NULL REFERENCES public.tblinventory(id) ON DELETE CASCADE,
  month         DATE NOT NULL,
  actual_count  INTEGER NOT NULL DEFAULT 0,
  updated_by    BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, inventory_id, month)
);

CREATE INDEX IF NOT EXISTS idx_tblinventory_actual_counts_lookup
  ON public.tblinventory_actual_counts(org_id, month);

CREATE TABLE IF NOT EXISTS public.tblinventory_adjustments (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  inventory_id    BIGINT NOT NULL REFERENCES public.tblinventory(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL DEFAULT 'manual',
  qty_before      INTEGER NOT NULL DEFAULT 0,
  qty_after       INTEGER NOT NULL DEFAULT 0,
  qty_change      INTEGER NOT NULL DEFAULT 0,
  reference_type  TEXT,
  reference_id    BIGINT,
  notes           TEXT,
  created_by      BIGINT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblinventory_adjustments_item
  ON public.tblinventory_adjustments(inventory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tblinventory_adjustments_org
  ON public.tblinventory_adjustments(org_id, created_at DESC);


-- =============================================================================
-- Section 5: Suppliers and purchase orders
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tblsuppliers (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  contact_info  TEXT,
  email         TEXT,
  address       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblsuppliers_org_id ON public.tblsuppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_tblsuppliers_name ON public.tblsuppliers(LOWER(name));

CREATE TABLE IF NOT EXISTS public.tblpurchases (
  id                BIGSERIAL PRIMARY KEY,
  org_id            BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  supplier_id       BIGINT REFERENCES public.tblsuppliers(id) ON DELETE SET NULL,
  po_number         TEXT,
  status            TEXT NOT NULL DEFAULT 'draft',
  notes             TEXT,
  order_date        DATE,
  expected_date     DATE,
  payment_type      TEXT,
  payment_date      DATE,
  payment_amount    NUMERIC(12,2) DEFAULT 0,
  reference_number  TEXT,
  payment_notes     TEXT,
  created_by        BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tblpurchases_status_check
    CHECK (status IN ('draft', 'ordered', 'received', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_tblpurchases_org_id ON public.tblpurchases(org_id);
CREATE INDEX IF NOT EXISTS idx_tblpurchases_status ON public.tblpurchases(status);
CREATE INDEX IF NOT EXISTS idx_tblpurchases_order_date ON public.tblpurchases(order_date);

CREATE TABLE IF NOT EXISTS public.tblpo_items (
  id              BIGSERIAL PRIMARY KEY,
  purchase_id     BIGINT NOT NULL REFERENCES public.tblpurchases(id) ON DELETE CASCADE,
  inventory_id    BIGINT REFERENCES public.tblinventory(id) ON DELETE SET NULL,
  variant_id      BIGINT REFERENCES public.tblinventory_variants(id) ON DELETE SET NULL,
  item_name       TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(12,2) NOT NULL DEFAULT 0,
  product_source  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tblpo_items_product_source_check
    CHECK (product_source IS NULL OR product_source IN ('Retail', 'Wholesale'))
);

CREATE INDEX IF NOT EXISTS idx_tblpo_items_purchase_id ON public.tblpo_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_tblpo_items_inventory_id ON public.tblpo_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_tblpo_items_variant_id ON public.tblpo_items(variant_id);


-- =============================================================================
-- Section 6: POS — discounts, payments, sales, staff, chat, costs
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tbldiscounts (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL,
  discount_type   TEXT NOT NULL,
  discount_value  NUMERIC(12,2) NOT NULL DEFAULT 0,
  bulk_min_qty    INTEGER,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, code),
  CONSTRAINT tbldiscounts_discount_type_check
    CHECK (discount_type IN ('percent', 'fixed', 'auto_sale', 'auto_bulk'))
);

CREATE INDEX IF NOT EXISTS idx_tbldiscounts_org ON public.tbldiscounts(org_id, is_active);

CREATE TABLE IF NOT EXISTS public.tblpayment_methods (
  id               BIGSERIAL PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  parent_code      TEXT,
  settlement_mode  TEXT NOT NULL DEFAULT 'immediate',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (org_id, code),
  CONSTRAINT tblpayment_methods_settlement_mode_check
    CHECK (settlement_mode IN ('immediate', 'floating'))
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_org
  ON public.tblpayment_methods(org_id, is_active);

CREATE TABLE IF NOT EXISTS public.tblsales_transactions (
  id                   BIGSERIAL PRIMARY KEY,
  org_id               BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  inventory_id         BIGINT REFERENCES public.tblinventory(id) ON DELETE SET NULL,
  variant_id           BIGINT REFERENCES public.tblinventory_variants(id) ON DELETE SET NULL,
  variant_unit_id      BIGINT REFERENCES public.tblinventory_variant_units(id) ON DELETE SET NULL,
  sub_variant_id       BIGINT REFERENCES public.tblinventory_variant_subvariants(id) ON DELETE SET NULL,
  unit_type            TEXT,
  quantity_sold        NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_id          BIGINT REFERENCES public.tbldiscounts(id) ON DELETE SET NULL,
  discount_amount      NUMERIC(12,2) DEFAULT 0,
  amount_paid          NUMERIC(12,2),
  change_amount        NUMERIC(12,2),
  payment_method_id    BIGINT REFERENCES public.tblpayment_methods(id) ON DELETE SET NULL,
  payment_status       TEXT NOT NULL DEFAULT 'settled',
  payment_proof_image  TEXT,
  reference_number     TEXT,
  customer_full_name   TEXT,
  sale_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  is_voided            BOOLEAN NOT NULL DEFAULT FALSE,
  voided_at            TIMESTAMPTZ,
  voided_by            BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  void_reason          TEXT,
  created_by           BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tblsales_transactions_payment_status_check
    CHECK (payment_status IN ('settled', 'floating'))
);

CREATE INDEX IF NOT EXISTS idx_tblsales_transactions_org_date
  ON public.tblsales_transactions(org_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_tblsales_transactions_inventory
  ON public.tblsales_transactions(inventory_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_tblsales_transactions_variant
  ON public.tblsales_transactions(variant_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_tblsales_transactions_created_by
  ON public.tblsales_transactions(created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tblpos_staff_presence (
  user_id    BIGINT NOT NULL REFERENCES public.tblusers(id) ON DELETE CASCADE,
  org_id     BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_staff_presence_org
  ON public.tblpos_staff_presence(org_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS public.tblpos_void_codes (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'Default',
  code_hash   TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_void_codes_org_label
  ON public.tblpos_void_codes(org_id, lower(label))
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.tblpos_daily_stock (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  variant_id     BIGINT NOT NULL REFERENCES public.tblinventory_variants(id) ON DELETE CASCADE,
  business_date  DATE NOT NULL,
  opening_qty    NUMERIC(18,3) NOT NULL DEFAULT 0,
  closing_qty    NUMERIC(18,3),
  counted_by     BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  counted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, variant_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_pos_daily_stock_org_date
  ON public.tblpos_daily_stock (org_id, business_date);

CREATE TABLE IF NOT EXISTS public.tblpos_costs (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  amount         NUMERIC(18,2) NOT NULL,
  reason         TEXT NOT NULL,
  receipt_image  TEXT,
  created_by     BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_pos_costs_org_created
  ON public.tblpos_costs (org_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

CREATE TABLE IF NOT EXISTS public.tblpos_chat_messages (
  id               BIGSERIAL PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  sender_id        BIGINT NOT NULL REFERENCES public.tblusers(id) ON DELETE CASCADE,
  recipient_id     BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  message          TEXT NOT NULL,
  attachment_url   TEXT,
  attachment_type  TEXT,
  seen_at          TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_chat_org_created
  ON public.tblpos_chat_messages (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tblpos_notifications (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES public.tblusers(id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'system',
  title           TEXT NOT NULL,
  body            TEXT,
  reference_type  TEXT,
  reference_id    BIGINT,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_notif_org_user
  ON public.tblpos_notifications (org_id, user_id, created_at DESC);


-- =============================================================================
-- Section 7: Audit
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tblaudit_logs (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT REFERENCES public.tblorganizations(id) ON DELETE SET NULL,
  user_id     BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  username    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
  ON public.tblaudit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user
  ON public.tblaudit_logs(user_id);


-- =============================================================================
-- Section 8: updated_at triggers
-- =============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tblorganizations',
    'tblusers',
    'auth_permission_keys',
    'auth_user_permission_overrides',
    'tblorg_settings',
    'tblorg_unit_types',
    'tblinventory',
    'tblinventory_products',
    'tblinventory_variants',
    'tblinventory_variant_units',
    'tblinventory_variant_subvariants',
    'tblsuppliers',
    'tblpurchases',
    'tblpos_void_codes',
    'tblpos_daily_stock',
    'tblpos_costs'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at()',
      t, t
    );
  END LOOP;
END $$;


-- =============================================================================
-- Section 9: Seed — platform + POS organization
-- =============================================================================

INSERT INTO public.tblorganizations (id, code, name, description, is_active, created_by)
VALUES (1, 'point-of-sales', 'Point of Sales', 'Central POS organization', TRUE, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tblrbac (id, "roleName", "roleMenus", "rolePermission", org_id)
VALUES
  (10, 'superadmin', 'ALL', 'ALL', NULL),
  (11, 'platform_admin', 'dashboard,organizations,user_management,settings', 'canRead,canCreate,canUpdate', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tblrbac (id, "roleName", "roleMenus", "rolePermission", org_id)
SELECT
  12,
  'org_admin',
  'dashboard,pos-dashboard,pos-terminal,inventory,reports,user-management,settings,pos-staff,pos-audit-trail,pos-company-profile,pos-stock-count,pos-company-costs,pos-my-sales',
  'canRead,canCreate,canUpdate,canDelete',
  o.id
FROM public.tblorganizations o
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tblrbac (id, "roleName", "roleMenus", "rolePermission", org_id)
SELECT
  13,
  'cashier',
  'pos-dashboard,pos-terminal,pos-my-sales,pos-stock-count,pos-company-costs',
  'canRead,canCreate',
  o.id
FROM public.tblorganizations o
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tblorg_settings (org_id, business_name, website_tab_name)
SELECT o.id, o.name, o.name
FROM public.tblorganizations o
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO public.tblorg_menus (org_id, menu_key, menu_label, menu_order)
SELECT o.id, v.menu_key, v.menu_label, v.menu_order
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('dashboard',            'Dashboard',           0),
    ('pos-dashboard',        'POS Sales',           1),
    ('pos-terminal',         'POS Terminal',        2),
    ('inventory',            'Inventory',           3),
    ('reports',              'Reports',             4),
    ('user-management',      'User Management',     5),
    ('pos-my-sales',         'My Sales',            6),
    ('pos-staff',            'On-Duty Staff',       7),
    ('pos-audit-trail',      'Audit Trail',         8),
    ('pos-company-profile',  'Company Profile',     9),
    ('pos-stock-count',      'End-of-Day Stock',   10),
    ('pos-company-costs',    'Company Costs',      11),
    ('settings',             'Settings',           99)
) AS v(menu_key, menu_label, menu_order)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, menu_key) DO NOTHING;

INSERT INTO public.auth_menus (key, label, parent_key, route, icon, order_no)
VALUES
  ('dashboard',           'Dashboard',          NULL, '/dashboard',           'dashboard',      1),
  ('pos-dashboard',       'POS Sales',          NULL, '/pos-dashboard',       'point_of_sale',  2),
  ('pos-terminal',        'POS Terminal',       NULL, '/pos-terminal',        'point_of_sale',  3),
  ('inventory',           'Inventory',          NULL, '/inventory',           'inventory',      4),
  ('reports',             'Reports',            NULL, '/reports',             'assessment',     5),
  ('user-management',     'User Management',    NULL, '/user-management',     'people',         6),
  ('pos-my-sales',        'My Sales',           NULL, '/pos-my-sales',        'receipt',        7),
  ('pos-staff',           'On-Duty Staff',      NULL, '/pos-staff',           'badge',          8),
  ('pos-audit-trail',     'Audit Trail',        NULL, '/pos-audit-trail',     'history',        9),
  ('pos-company-profile', 'Company Profile',    NULL, '/pos-company-profile', 'store',         10),
  ('pos-stock-count',     'End-of-Day Stock',   NULL, '/pos-stock-count',     'inventory_2',   11),
  ('pos-company-costs',   'Company Costs',      NULL, '/pos-company-costs',   'payments',      12),
  ('organizations',       'Organizations',      NULL, '/organizations',       'business',      13),
  ('settings',            'Settings',           NULL, '/settings',            'settings',      99)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.auth_permission_keys (key, label, module, scope)
VALUES
  ('platform.dashboard.view',        'View Platform Dashboard',   'platform',    'feature'),
  ('platform.organizations.view',    'View Organizations',        'platform',    'feature'),
  ('platform.organizations.create',  'Create Organization',       'platform',    'action'),
  ('platform.organizations.edit',    'Edit Organization',         'platform',    'action'),
  ('platform.organizations.delete',  'Delete Organization',       'platform',    'action'),
  ('platform.users.view',            'View All Users',            'platform',    'feature'),
  ('platform.users.create',          'Create User',               'platform',    'action'),
  ('platform.users.edit',            'Edit User',                 'platform',    'action'),
  ('platform.users.delete',          'Delete User',               'platform',    'action'),
  ('platform.settings.view',         'View Platform Settings',    'platform',    'feature'),
  ('platform.settings.edit',         'Edit Platform Settings',    'platform',    'action'),

  ('user-management.view',           'View User Management',      'user-management', 'feature'),
  ('user-management.create',         'Create User',               'user-management', 'action'),
  ('user-management.edit',           'Edit User',                 'user-management', 'action'),
  ('user-management.delete',         'Delete User',               'user-management', 'action'),

  ('inventory.view',                 'View Inventory',            'inventory',   'feature'),
  ('inventory.create',               'Create Inventory Item',     'inventory',   'action'),
  ('inventory.edit',                 'Edit Inventory Item',       'inventory',   'action'),
  ('inventory.delete',               'Delete Inventory Item',     'inventory',   'action'),
  ('purchase-order.view',            'View Purchase Orders',      'purchase-order', 'feature'),
  ('purchase-order.create',          'Create Purchase Order',     'purchase-order', 'action'),
  ('purchase-order.edit',            'Edit Purchase Order',       'purchase-order', 'action'),
  ('purchase-order.approve',         'Approve Purchase Order',    'purchase-order', 'action'),

  ('reports.view',                   'View Reports',              'reports',     'feature'),
  ('settings.view',                  'View Settings',             'settings',    'feature'),
  ('settings.edit',                  'Edit Settings',             'settings',    'action'),

  ('pos.dashboard.view',             'View POS Dashboard',        'pos',         'feature'),
  ('pos.terminal.view',              'View POS Terminal',         'pos',         'feature'),
  ('pos.terminal.checkout',          'Process POS Checkout',      'pos',         'action'),
  ('pos.void',                       'Void POS Sale',             'pos',         'action'),
  ('pos.reports.view',               'View POS Reports',          'pos',         'feature'),
  ('pos.staff.view',                 'View On-Duty Staff',        'pos',         'feature'),
  ('pos.audit.view',                 'View POS Audit Trail',      'pos',         'feature'),
  ('pos.stock-count.view',           'View End-of-Day Stock',     'pos',         'feature'),
  ('pos.costs.view',                 'View Company Costs',        'pos',         'action'),
  ('pos.costs.manage',               'Manage Company Costs',      'pos',         'action'),

  ('legacy.menu.dashboard',          'Legacy Menu: dashboard',    'legacy',      'menu'),
  ('legacy.menu.pos-dashboard',      'Legacy Menu: pos-dashboard','legacy',      'menu'),
  ('legacy.menu.pos-terminal',       'Legacy Menu: pos-terminal', 'legacy',      'menu'),
  ('legacy.menu.inventory',          'Legacy Menu: inventory',    'legacy',      'menu'),
  ('legacy.menu.reports',            'Legacy Menu: reports',      'legacy',      'menu'),
  ('legacy.menu.user-management',    'Legacy Menu: user-management','legacy',    'menu'),
  ('legacy.menu.settings',           'Legacy Menu: settings',     'legacy',      'menu')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 10, id FROM public.auth_permission_keys
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 11, id FROM public.auth_permission_keys
WHERE key LIKE 'platform.%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT r.id, pk.id
FROM public.tblrbac r
CROSS JOIN public.auth_permission_keys pk
WHERE r.id = 12
  AND (
    pk.key LIKE 'inventory.%'
    OR pk.key LIKE 'purchase-order.%'
    OR pk.key LIKE 'user-management.%'
    OR pk.key LIKE 'pos.%'
    OR pk.key IN ('reports.view', 'settings.view', 'settings.edit')
    OR pk.key LIKE 'legacy.menu.%'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT r.id, pk.id
FROM public.tblrbac r
CROSS JOIN public.auth_permission_keys pk
WHERE r.id = 13
  AND pk.key IN (
    'pos.dashboard.view',
    'pos.terminal.view',
    'pos.terminal.checkout',
    'pos.stock-count.view',
    'pos.costs.view',
    'legacy.menu.pos-dashboard',
    'legacy.menu.pos-terminal'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Default superadmin. Change this password immediately after first login.
INSERT INTO public.tblusers (id, username, password, fullname, email, "roleId", status, org_id, is_deleted)
VALUES (
  1,
  'superadmin',
  '$2b$10$wJvQwQwQwQwQwQwQwQwQwOeQwQwQwQwQwQwQwQwQwQwQwQwQwQw',
  'System Superadmin',
  'superadmin@yourdomain.com',
  10,
  1,
  NULL,
  FALSE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.auth_user_roles (user_id, role_id, is_primary)
VALUES (1, 10, TRUE)
ON CONFLICT (user_id, role_id) DO NOTHING;

INSERT INTO public.tblorg_unit_types (org_id, code, label, is_manual_entry, usage_scope, sort_order)
SELECT o.id, v.code, v.label, v.is_manual, v.scope, v.ord
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('piece',  'Piece',  FALSE, 'Others',    1),
    ('pack',   'Pack',   FALSE, 'Others',    2),
    ('kilo',   'Kilo',   FALSE, 'Others',    3),
    ('sack',   'Sack',   FALSE, 'Others',    4),
    ('grams',  'Grams',  FALSE, 'Others',    5),
    ('liter',  'Liter',  FALSE, 'Beverages', 6),
    ('box',    'Box',    FALSE, 'Others',    7),
    ('bottle', 'Bottle', FALSE, 'Beverages', 8),
    ('can',    'Can',    FALSE, 'Beverages', 9),
    ('tray',   'Tray',   FALSE, 'Others',   10)
) AS v(code, label, is_manual, scope, ord)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO public.tblpayment_methods (org_id, code, name, parent_code, settlement_mode, sort_order)
SELECT o.id, v.code, v.name, v.parent_code, v.settlement_mode, v.sort_order
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('cash',          'Cash',          NULL,     'immediate', 1),
    ('gcash',         'GCash',         'online', 'immediate', 2),
    ('maya',          'Maya',          'online', 'immediate', 3),
    ('bank_transfer', 'Bank Transfer', 'online', 'immediate', 4),
    ('food_panda',    'Food Panda',    NULL,     'floating',  5)
) AS v(code, name, parent_code, settlement_mode, sort_order)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO public.tbldiscounts (org_id, name, code, discount_type, discount_value, bulk_min_qty, sort_order, description)
SELECT o.id, v.name, v.code, v.discount_type, v.discount_value, v.bulk_min_qty, v.sort_order, v.description
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('Senior Citizen Discount', 'senior-citizen', 'percent',   10, NULL::int, 1, '10% discount for senior citizens'),
    ('PWD Discount',            'pwd',            'percent',   10, NULL,       2, '10% discount for persons with disability'),
    ('Sale Price',              'auto-sale',      'auto_sale',  0, NULL,       3, 'Automatically applies product sale price when set'),
    ('Bulk Sale (5+ qty)',      'auto-bulk',      'auto_bulk',  5, 5,          4, '5% off when buying 5 or more of the same item')
) AS v(name, code, discount_type, discount_value, bulk_min_qty, sort_order, description)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, code) DO NOTHING;

SELECT setval('tblorganizations_id_seq', GREATEST((SELECT MAX(id) FROM public.tblorganizations), 1));
SELECT setval('tblrbac_id_seq', GREATEST((SELECT MAX(id) FROM public.tblrbac), 1));
SELECT setval('tblusers_id_seq', GREATEST((SELECT MAX(id) FROM public.tblusers), 1));

COMMIT;
