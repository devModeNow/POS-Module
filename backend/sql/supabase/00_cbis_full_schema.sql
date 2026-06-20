-- =============================================================================
-- CBIS Full Schema Migration
-- Centralized Business Information System - Complete Database Schema
-- Idempotent: safe to run multiple times (uses IF NOT EXISTS / ON CONFLICT)
-- =============================================================================

BEGIN;

-- =============================================================================
-- Section 1: Core Tables (RBAC & Users)
-- =============================================================================

-- 1.1 RBAC Roles
CREATE TABLE IF NOT EXISTS public.tblrbac (
  id BIGSERIAL PRIMARY KEY,
  "roleName" VARCHAR(50) UNIQUE,
  "roleMenus" TEXT,
  "rolePermission" TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  org_id BIGINT
);

-- 1.2 Users
CREATE TABLE IF NOT EXISTS public.tblusers (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  password TEXT,
  fullname VARCHAR(100),
  birthdate DATE,
  address TEXT,
  email VARCHAR(100),
  contact VARCHAR(50),
  status SMALLINT,
  is_deleted BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  created_by BIGINT DEFAULT 1,
  "roleId" BIGINT DEFAULT 1 REFERENCES public.tblrbac(id) ON DELETE SET NULL,
  org_id BIGINT
);

-- 1.3 Permission Dictionary
CREATE TABLE IF NOT EXISTS public.auth_permission_keys (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  module TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'feature',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_permission_keys_scope_check CHECK (scope IN ('feature', 'menu', 'tab', 'action'))
);

-- 1.4 Role -> Permission Mapping
CREATE TABLE IF NOT EXISTS public.auth_role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role_id BIGINT NOT NULL REFERENCES public.tblrbac(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES public.auth_permission_keys(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

-- 1.5 User-level Permission Overrides
CREATE TABLE IF NOT EXISTS public.auth_user_permission_overrides (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.tblusers(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES public.auth_permission_keys(id) ON DELETE CASCADE,
  effect TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_user_permission_overrides_effect_check CHECK (effect IN ('allow', 'deny')),
  UNIQUE(user_id, permission_id)
);

-- 1.6 User -> Role Assignment (normalized)
CREATE TABLE IF NOT EXISTS public.auth_user_roles (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.tblusers(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES public.tblrbac(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);

-- 1.7 Menu Registry
CREATE TABLE IF NOT EXISTS public.auth_menus (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  parent_key TEXT,
  route TEXT,
  icon TEXT,
  order_no INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- Section 2: Organization Tables (Multi-tenant)
-- =============================================================================

-- 2.1 Organizations
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

-- 2.2 Organization Settings
CREATE TABLE IF NOT EXISTS public.tblorg_settings (
  id                        BIGSERIAL PRIMARY KEY,
  org_id                    BIGINT NOT NULL UNIQUE REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  business_name             TEXT,
  business_address          TEXT,
  business_contact          TEXT,
  business_email            TEXT,
  business_owner            TEXT,
  logo_light                TEXT,
  logo_dark                 TEXT,
  website_tab_name          TEXT,
  routing_tab_name          TEXT DEFAULT '{route}',
  print_paper_size          TEXT DEFAULT 'A4',
  print_show_logo           TEXT DEFAULT 'true',
  print_logo_variant        TEXT DEFAULT 'light',
  print_footer_text         TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3 Organization Menus
CREATE TABLE IF NOT EXISTS public.tblorg_menus (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  menu_key    TEXT NOT NULL,
  menu_label  TEXT NOT NULL,
  menu_icon   TEXT,
  menu_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, menu_key)
);


-- =============================================================================
-- Section 3: Customer Management
-- =============================================================================

-- 3.1 Customer table with enhancement columns
CREATE TABLE IF NOT EXISTS public.tblcustomer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  address TEXT,
  customer_type VARCHAR(20) DEFAULT 'regular' CHECK (customer_type IN ('regular', 'sub_dealer')),
  credit_limit NUMERIC(12, 2) DEFAULT 0,
  current_balance NUMERIC(12, 2) DEFAULT 0,
  payment_terms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tblcustomer_type ON public.tblcustomer(customer_type);

COMMENT ON COLUMN public.tblcustomer.customer_type IS 'Customer type: regular or sub_dealer';
COMMENT ON COLUMN public.tblcustomer.credit_limit IS 'Maximum credit allowed for sub-dealers';
COMMENT ON COLUMN public.tblcustomer.current_balance IS 'Current outstanding balance';


-- =============================================================================
-- Section 4: Quotation Feature
-- =============================================================================

-- 4.1 Quotation Header
CREATE TABLE IF NOT EXISTS public.tblquotation (
  id BIGSERIAL PRIMARY KEY,
  quote_no TEXT NOT NULL UNIQUE,
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,

  customer_id UUID REFERENCES public.tblcustomer(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_address TEXT,
  customer_contact_person TEXT,
  customer_contact_number TEXT,
  customer_email TEXT,
  customer_tin_number TEXT,

  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  remarks TEXT,

  converted_sales_id BIGINT,

  created_by BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  branch_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tblquotation_status_check
    CHECK (LOWER(status) IN ('draft', 'finalized', 'converted', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_tblquotation_customer_id ON public.tblquotation(customer_id);
CREATE INDEX IF NOT EXISTS idx_tblquotation_status ON public.tblquotation(status);
CREATE INDEX IF NOT EXISTS idx_tblquotation_quote_date ON public.tblquotation(quote_date);
CREATE INDEX IF NOT EXISTS idx_tblquotation_created_at ON public.tblquotation(created_at DESC);

-- 4.2 Quotation Line Items
CREATE TABLE IF NOT EXISTS public.tblquotation_items (
  id BIGSERIAL PRIMARY KEY,

  quotation_id BIGINT NOT NULL REFERENCES public.tblquotation(id) ON DELETE CASCADE,

  product_id BIGINT,
  capacity_id BIGINT,

  unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount_price NUMERIC(14, 2) NOT NULL DEFAULT 0,

  unit_types_qty JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_set_qty INTEGER NOT NULL DEFAULT 0,
  line_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  remarks TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblquotation_items_quotation_id
  ON public.tblquotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_tblquotation_items_product_id
  ON public.tblquotation_items(product_id);
CREATE INDEX IF NOT EXISTS idx_tblquotation_items_capacity_id
  ON public.tblquotation_items(capacity_id);


-- =============================================================================
-- Section 5: Material Inventory
-- =============================================================================

-- 5.1 Materials
CREATE TABLE IF NOT EXISTS public.tblmaterials (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT NULL,
  material_name TEXT NOT NULL,
  material_code VARCHAR(50) UNIQUE,
  description TEXT,
  unit VARCHAR(20) DEFAULT 'PCS',
  unit_price NUMERIC(12, 2) DEFAULT 0,
  sell_price NUMERIC(12, 2) DEFAULT 0,
  on_hand_stock BIGINT DEFAULT 0,
  reorder_level BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES public.tblusers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT REFERENCES public.tblusers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT tblmaterials_material_name_key UNIQUE (material_name)
);

CREATE INDEX IF NOT EXISTS idx_tblmaterials_brand_id ON public.tblmaterials(brand_id);
CREATE INDEX IF NOT EXISTS idx_tblmaterials_deleted_at ON public.tblmaterials(deleted_at);
CREATE INDEX IF NOT EXISTS idx_tblmaterials_on_hand_stock ON public.tblmaterials(on_hand_stock);

COMMENT ON TABLE public.tblmaterials IS 'Material products inventory (pipes, wires, accessories, etc.)';
COMMENT ON COLUMN public.tblmaterials.on_hand_stock IS 'Current available stock quantity';
COMMENT ON COLUMN public.tblmaterials.reorder_level IS 'Alert threshold for low stock';

-- 5.2 Material Price History
CREATE TABLE IF NOT EXISTS public.tblmaterial_price_history (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES public.tblmaterials(id) ON DELETE CASCADE,
  unit_price NUMERIC(12, 2) NOT NULL,
  sell_price NUMERIC(12, 2) NOT NULL,
  supplier_id UUID,
  purchase_order_id INTEGER,
  purchase_order_no VARCHAR(100),
  created_by BIGINT REFERENCES public.tblusers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_price_history_lookup
  ON public.tblmaterial_price_history(material_id, id DESC);

COMMENT ON TABLE public.tblmaterial_price_history IS 'Historical tracking of material price changes';

-- 5.3 Transaction Material Items
CREATE TABLE IF NOT EXISTS public.tbltransaction_material_items (
  id BIGSERIAL PRIMARY KEY,
  trans_type VARCHAR(20) NOT NULL CHECK (trans_type IN ('purchase', 'sales')),
  material_id BIGINT NOT NULL REFERENCES public.tblmaterials(id) ON UPDATE CASCADE ON DELETE CASCADE,
  quantity BIGINT NOT NULL DEFAULT 0,
  unit_price NUMERIC(12, 2) DEFAULT 0,
  sell_price NUMERIC(12, 2) DEFAULT 0,
  discount_price NUMERIC(12, 2) DEFAULT 0,
  purchase_id INTEGER,
  sales_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_material_purchase ON public.tbltransaction_material_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_transaction_material_sales ON public.tbltransaction_material_items(sales_id);
CREATE INDEX IF NOT EXISTS idx_transaction_material_material_id ON public.tbltransaction_material_items(material_id);

COMMENT ON TABLE public.tbltransaction_material_items IS 'Material items in purchase and sales transactions';


-- =============================================================================
-- Section 6: Project & Service Management
-- =============================================================================

-- 6.1 Projects (Master Table)
CREATE TABLE IF NOT EXISTS public.tblprojects (
  id BIGSERIAL PRIMARY KEY,
  project_code VARCHAR(50) UNIQUE NOT NULL,
  project_name TEXT NOT NULL,
  project_type VARCHAR(50),
  project_owner TEXT,
  project_owner_id BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  project_location TEXT,
  project_start_date DATE,
  project_end_date DATE,
  project_manager TEXT,
  project_manager_id BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  project_status VARCHAR(20) NOT NULL DEFAULT 'planning' CHECK (project_status IN ('planning', 'ongoing', 'completed', 'cancelled')),
  project_notes TEXT,
  branch_id BIGINT,
  created_by BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tblprojects_project_code_key UNIQUE (project_code)
);

CREATE INDEX IF NOT EXISTS idx_tblprojects_project_code ON public.tblprojects(project_code);
CREATE INDEX IF NOT EXISTS idx_tblprojects_project_name ON public.tblprojects(project_name);
CREATE INDEX IF NOT EXISTS idx_tblprojects_project_status ON public.tblprojects(project_status);
CREATE INDEX IF NOT EXISTS idx_tblprojects_branch_id ON public.tblprojects(branch_id);
CREATE INDEX IF NOT EXISTS idx_tblprojects_project_owner_id ON public.tblprojects(project_owner_id);

COMMENT ON TABLE public.tblprojects IS 'Master table for project definitions; supports multiple sales orders per project for staggered unit releases';

-- 6.2 Project Details (per sales order)
CREATE TABLE IF NOT EXISTS public.tblproject_details (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER,
  project_name TEXT NOT NULL,
  project_code VARCHAR(50) UNIQUE,
  project_location TEXT,
  project_start_date DATE,
  project_end_date DATE,
  project_manager TEXT,
  project_status VARCHAR(20) DEFAULT 'ongoing' CHECK (project_status IN ('planning', 'ongoing', 'completed', 'cancelled')),
  project_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT tblproject_details_sales_id_key UNIQUE (sales_id)
);

CREATE INDEX IF NOT EXISTS idx_project_details_sales_id ON public.tblproject_details(sales_id);
CREATE INDEX IF NOT EXISTS idx_project_details_status ON public.tblproject_details(project_status);

COMMENT ON TABLE public.tblproject_details IS 'Project-specific details for project sales type';

-- 6.3 Service Details
CREATE TABLE IF NOT EXISTS public.tblservice_details (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER,
  service_name TEXT NOT NULL,
  service_description TEXT,
  service_type VARCHAR(50),
  technician_assigned TEXT,
  service_date DATE,
  service_duration_hours NUMERIC(5, 2),
  service_cost NUMERIC(12, 2) DEFAULT 0,
  parts_cost NUMERIC(12, 2) DEFAULT 0,
  labor_cost NUMERIC(12, 2) DEFAULT 0,
  service_status VARCHAR(20) DEFAULT 'scheduled' CHECK (service_status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  service_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_service_details_sales_id ON public.tblservice_details(sales_id);
CREATE INDEX IF NOT EXISTS idx_service_details_status ON public.tblservice_details(service_status);
CREATE INDEX IF NOT EXISTS idx_service_details_date ON public.tblservice_details(service_date);

COMMENT ON TABLE public.tblservice_details IS 'Service details for sales orders with service component';

-- 6.4 Concern Details
CREATE TABLE IF NOT EXISTS public.tblconcern_details (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER,
  customer_id UUID REFERENCES public.tblcustomer(id) ON UPDATE CASCADE ON DELETE CASCADE,
  concern_type VARCHAR(50),
  concern_subject TEXT NOT NULL,
  concern_description TEXT NOT NULL,
  concern_status VARCHAR(20) DEFAULT 'open' CHECK (concern_status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to BIGINT REFERENCES public.tblusers(id),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_concern_details_sales_id ON public.tblconcern_details(sales_id);
CREATE INDEX IF NOT EXISTS idx_concern_details_customer_id ON public.tblconcern_details(customer_id);
CREATE INDEX IF NOT EXISTS idx_concern_details_status ON public.tblconcern_details(concern_status);

COMMENT ON TABLE public.tblconcern_details IS 'Customer concerns, complaints, and issues tracking';

-- 6.5 Transfer Details
CREATE TABLE IF NOT EXISTS public.tbltransfer_details (
  id BIGSERIAL PRIMARY KEY,
  sales_id INTEGER,
  from_branch_id BIGINT,
  to_branch_id BIGINT,
  transfer_date DATE,
  expected_delivery_date DATE,
  actual_delivery_date DATE,
  transfer_status VARCHAR(20) DEFAULT 'pending' CHECK (transfer_status IN ('pending', 'in_transit', 'delivered', 'acknowledged', 'cancelled')),
  sent_by BIGINT REFERENCES public.tblusers(id),
  received_by BIGINT REFERENCES public.tblusers(id),
  acknowledged_by BIGINT REFERENCES public.tblusers(id),
  acknowledged_at TIMESTAMPTZ,
  transfer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT tbltransfer_details_sales_id_key UNIQUE (sales_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_details_from_branch ON public.tbltransfer_details(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_transfer_details_to_branch ON public.tbltransfer_details(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_transfer_details_status ON public.tbltransfer_details(transfer_status);

COMMENT ON TABLE public.tbltransfer_details IS 'Branch-to-branch transfer/distribution tracking';

-- 6.6 Expense Details
CREATE TABLE IF NOT EXISTS public.tblexpense_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_id INTEGER,
  transfer_id BIGINT REFERENCES public.tbltransfer_details(id) ON UPDATE CASCADE ON DELETE CASCADE,
  expense_type VARCHAR(50) NOT NULL,
  expense_description TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  expense_date DATE,
  paid_to TEXT,
  payment_method VARCHAR(50),
  reference_no VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_expense_details_sales_id ON public.tblexpense_details(sales_id);
CREATE INDEX IF NOT EXISTS idx_expense_details_transfer_id ON public.tblexpense_details(transfer_id);

COMMENT ON TABLE public.tblexpense_details IS 'Expense tracking for transfers and distributions';


-- =============================================================================
-- Section 7: Customer Payments & SOA
-- =============================================================================

-- 7.1 Customer Payments
CREATE TABLE IF NOT EXISTS public.tblcustomer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.tblcustomer(id) ON UPDATE CASCADE ON DELETE CASCADE,
  sales_id INTEGER,
  payment_amount NUMERIC(12, 2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50),
  reference_no VARCHAR(100),
  payment_notes TEXT,
  applied_to_balance NUMERIC(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id ON public.tblcustomer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_sales_id ON public.tblcustomer_payments(sales_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON public.tblcustomer_payments(payment_date);

COMMENT ON TABLE public.tblcustomer_payments IS 'Customer payment history and tracking';

-- 7.2 Statement of Account
CREATE TABLE IF NOT EXISTS public.tblstatement_of_account (
  id BIGSERIAL PRIMARY KEY,
  soa_number TEXT GENERATED ALWAYS AS ('SOA-' || LPAD(id::TEXT, 6, '0')) STORED,
  customer_id UUID NOT NULL REFERENCES public.tblcustomer(id) ON UPDATE CASCADE ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  opening_balance NUMERIC(12, 2) DEFAULT 0,
  total_charges NUMERIC(12, 2) DEFAULT 0,
  total_payments NUMERIC(12, 2) DEFAULT 0,
  closing_balance NUMERIC(12, 2) DEFAULT 0,
  soa_status VARCHAR(20) DEFAULT 'draft' CHECK (soa_status IN ('draft', 'sent', 'paid', 'overdue')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by BIGINT REFERENCES public.tblusers(id),
  sent_at TIMESTAMPTZ,
  due_date DATE,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_soa_customer_id ON public.tblstatement_of_account(customer_id);
CREATE INDEX IF NOT EXISTS idx_soa_status ON public.tblstatement_of_account(soa_status);
CREATE INDEX IF NOT EXISTS idx_soa_period ON public.tblstatement_of_account(period_from, period_to);

COMMENT ON TABLE public.tblstatement_of_account IS 'Statement of Account for sub-dealers';


-- =============================================================================
-- Section 8: Accounting
-- =============================================================================

-- 8.1 Cheque Voucher (legacy single-entry)
CREATE TABLE IF NOT EXISTS public.tblcheque_voucher (
  id BIGSERIAL PRIMARY KEY,
  cv_number TEXT GENERATED ALWAYS AS ('CV-' || LPAD(id::TEXT, 6, '0')) STORED,
  payee_name TEXT NOT NULL,
  payee_address TEXT,
  payee_tin VARCHAR(50),
  cheque_number VARCHAR(50),
  bank_name VARCHAR(100),
  cheque_date DATE,
  amount NUMERIC(12, 2) NOT NULL,
  amount_in_words TEXT,
  particulars TEXT NOT NULL,
  account_code VARCHAR(50),
  category VARCHAR(50),
  payment_type VARCHAR(50),
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'issued', 'cleared', 'cancelled')),
  approved_by BIGINT REFERENCES public.tblusers(id),
  approved_at TIMESTAMPTZ,
  issued_by BIGINT REFERENCES public.tblusers(id),
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id),
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_cheque_voucher_status ON public.tblcheque_voucher(status);
CREATE INDEX IF NOT EXISTS idx_cheque_voucher_date ON public.tblcheque_voucher(cheque_date);
CREATE INDEX IF NOT EXISTS idx_cheque_voucher_payee ON public.tblcheque_voucher(payee_name);

COMMENT ON TABLE public.tblcheque_voucher IS 'Cheque voucher management for disbursements';

-- 8.2 General Journal
CREATE TABLE IF NOT EXISTS public.tblgeneral_journal (
  id BIGSERIAL PRIMARY KEY,
  journal_number TEXT GENERATED ALWAYS AS ('JE-' || LPAD(id::TEXT, 6, '0')) STORED,
  journal_date DATE NOT NULL,
  reference_type VARCHAR(50),
  reference_id INTEGER,
  reference_number TEXT,
  description TEXT NOT NULL,
  total_debit NUMERIC(12, 2) DEFAULT 0,
  total_credit NUMERIC(12, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  posted_at TIMESTAMPTZ,
  posted_by BIGINT REFERENCES public.tblusers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_general_journal_date ON public.tblgeneral_journal(journal_date);
CREATE INDEX IF NOT EXISTS idx_general_journal_status ON public.tblgeneral_journal(status);
CREATE INDEX IF NOT EXISTS idx_general_journal_reference ON public.tblgeneral_journal(reference_type, reference_id);

COMMENT ON TABLE public.tblgeneral_journal IS 'General journal entries for accounting';

-- 8.3 Journal Entry Lines
CREATE TABLE IF NOT EXISTS public.tbljournal_entry_lines (
  id BIGSERIAL PRIMARY KEY,
  journal_id BIGINT NOT NULL REFERENCES public.tblgeneral_journal(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  account_code VARCHAR(50) NOT NULL,
  account_name TEXT NOT NULL,
  description TEXT,
  debit_amount NUMERIC(12, 2) DEFAULT 0,
  credit_amount NUMERIC(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_journal_id ON public.tbljournal_entry_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.tbljournal_entry_lines(account_code);

COMMENT ON TABLE public.tbljournal_entry_lines IS 'Line items for general journal entries';

-- 8.4 Tax 2307
CREATE TABLE IF NOT EXISTS public.tbltax_2307 (
  id BIGSERIAL PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  tax_quarter INTEGER CHECK (tax_quarter BETWEEN 1 AND 4),
  tax_month INTEGER CHECK (tax_month BETWEEN 1 AND 12),
  payee_name TEXT NOT NULL,
  payee_tin VARCHAR(50) NOT NULL,
  payee_address TEXT,
  income_payment_type VARCHAR(100),
  atc_code VARCHAR(10),
  gross_amount NUMERIC(12, 2) NOT NULL,
  tax_rate NUMERIC(5, 2) NOT NULL,
  tax_withheld NUMERIC(12, 2) NOT NULL,
  payment_date DATE,
  reference_type VARCHAR(50),
  reference_id INTEGER,
  reference_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_tax_2307_year_quarter ON public.tbltax_2307(tax_year, tax_quarter);
CREATE INDEX IF NOT EXISTS idx_tax_2307_payee_tin ON public.tbltax_2307(payee_tin);
CREATE INDEX IF NOT EXISTS idx_tax_2307_date ON public.tbltax_2307(payment_date);

COMMENT ON TABLE public.tbltax_2307 IS 'BIR Form 2307 - Certificate of Creditable Tax Withheld at Source';

-- 8.5 PO Payments
CREATE TABLE IF NOT EXISTS public.tblpo_payments (
  id BIGSERIAL PRIMARY KEY,
  po_id INTEGER,
  payment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payment_date DATE,
  payment_method VARCHAR(50),
  reference_no TEXT,
  notes TEXT,
  bank_name TEXT,
  check_no TEXT,
  cheque_date TIMESTAMPTZ,
  issued_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES public.tblusers(id)
);

CREATE INDEX IF NOT EXISTS idx_po_payments_po_id ON public.tblpo_payments(po_id);

COMMENT ON TABLE public.tblpo_payments IS 'Purchase order payment records';

-- 8.6 Account Titles
CREATE TABLE IF NOT EXISTS public.tblaccount_titles (
  id BIGSERIAL PRIMARY KEY,
  account_number VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblaccount_titles_number_description
  ON public.tblaccount_titles (account_number, description);

-- 8.7 Cheque Vouchers (multi-line workflow)
CREATE TABLE IF NOT EXISTS public.tblcheque_vouchers (
  id BIGSERIAL PRIMARY KEY,
  cv_no VARCHAR(32) NOT NULL UNIQUE,
  voucher_type VARCHAR(120) NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  voucher_date DATE NOT NULL,
  tin_number TEXT,
  address TEXT,
  zip_code TEXT,
  particulars TEXT,
  prepared_by TEXT,
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblcheque_vouchers_voucher_date
  ON public.tblcheque_vouchers (voucher_date);

-- 8.8 Cheque Voucher Deposits
CREATE TABLE IF NOT EXISTS public.tblcheque_voucher_deposits (
  id BIGSERIAL PRIMARY KEY,
  voucher_id BIGINT NOT NULL REFERENCES public.tblcheque_vouchers(id) ON DELETE CASCADE,
  bank_name TEXT,
  cheque_no TEXT,
  cheque_date DATE,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblcheque_voucher_deposits_voucher_id
  ON public.tblcheque_voucher_deposits (voucher_id);

-- 8.9 Cheque Voucher Invoices
CREATE TABLE IF NOT EXISTS public.tblcheque_voucher_invoices (
  id BIGSERIAL PRIMARY KEY,
  voucher_id BIGINT NOT NULL REFERENCES public.tblcheque_vouchers(id) ON DELETE CASCADE,
  invoice_no TEXT,
  invoice_date DATE,
  description TEXT,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblcheque_voucher_invoices_voucher_id
  ON public.tblcheque_voucher_invoices (voucher_id);

-- 8.10 Cheque Voucher Account Titles
CREATE TABLE IF NOT EXISTS public.tblcheque_voucher_account_titles (
  id BIGSERIAL PRIMARY KEY,
  voucher_id BIGINT NOT NULL REFERENCES public.tblcheque_vouchers(id) ON DELETE CASCADE,
  account_title_id BIGINT REFERENCES public.tblaccount_titles(id),
  account_number VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  debit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  credit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tblcheque_voucher_account_titles_voucher_id
  ON public.tblcheque_voucher_account_titles (voucher_id);

-- 8.11 Accounting Report Print Settings
CREATE TABLE IF NOT EXISTS public.tblaccounting_report_print_settings (
  id BIGSERIAL PRIMARY KEY,
  report_key TEXT NOT NULL,
  branch_id BIGINT NOT NULL DEFAULT 0,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblaccounting_report_print_settings_report_branch
  ON public.tblaccounting_report_print_settings (report_key, branch_id);

CREATE INDEX IF NOT EXISTS idx_tblaccounting_report_print_settings_report_key
  ON public.tblaccounting_report_print_settings (report_key);

CREATE INDEX IF NOT EXISTS idx_tblaccounting_report_print_settings_branch_id
  ON public.tblaccounting_report_print_settings (branch_id);


-- =============================================================================
-- Section 9: Audit & Settings
-- =============================================================================

-- 9.1 Audit Log (structured)
CREATE TABLE IF NOT EXISTS public.tblaudit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name VARCHAR(100) NOT NULL,
  record_id TEXT NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'CANCEL')),
  old_values JSONB,
  new_values JSONB,
  changed_by BIGINT REFERENCES public.tblusers(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address VARCHAR(50),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.tblaudit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by ON public.tblaudit_log(changed_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON public.tblaudit_log(changed_at);

COMMENT ON TABLE public.tblaudit_log IS 'System-wide audit trail for tracking changes';

-- 9.2 Audit Logs (action-based)
CREATE TABLE IF NOT EXISTS public.tblaudit_logs (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100),
  user_id INTEGER,
  username VARCHAR(150),
  role_name VARCHAR(100),
  branch_id INTEGER,
  ip_address VARCHAR(60),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.tblaudit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.tblaudit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.tblaudit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.tblaudit_logs(created_at DESC);

-- 9.3 Settings (legacy single-row settings table)
CREATE TABLE IF NOT EXISTS public.tblsettings (
  id BIGSERIAL PRIMARY KEY,
  "businessName" TEXT,
  "businessAddress" TEXT,
  "businessContact" TEXT,
  "businessEmail" TEXT,
  "businessOwner" TEXT,
  "businessLogo" TEXT,
  "businessLogoLight" TEXT,
  "businessLogoDark" TEXT,
  "drTemplatePdf" TEXT,
  website_tab_name TEXT,
  routing_tab_name TEXT,
  cv_number_prefix TEXT DEFAULT 'CV',
  cv_number_suffix TEXT DEFAULT '',
  gj_number_prefix TEXT DEFAULT 'GJ',
  gj_number_suffix TEXT DEFAULT '',
  "printPaperSize" TEXT DEFAULT 'A4',
  "printShowLogo" TEXT DEFAULT 'true',
  "printLogoVariant" TEXT DEFAULT 'light',
  "printFooterText" TEXT,
  "printQuoteHeaderColor" TEXT DEFAULT '#0f9cdf',
  "printQuoteShowTerms" TEXT DEFAULT 'true',
  "printQuoteShowMisc" TEXT DEFAULT 'false',
  "printQuoteShowValidity" TEXT DEFAULT 'true',
  "printSoShowDiscount" TEXT DEFAULT 'false',
  "printSoShowPaymentTerms" TEXT DEFAULT 'true',
  "printSoShowSerials" TEXT DEFAULT 'true',
  "printDrShowSerials" TEXT DEFAULT 'true',
  "printDrShowSignature" TEXT DEFAULT 'true',
  "printReportShowHeader" TEXT DEFAULT 'true',
  "printCvShowPreparedBy" TEXT DEFAULT 'true',
  "printCvShowSignatureLine" TEXT DEFAULT 'false',
  "printAddressDetails" TEXT,
  "printAddressShowSoInvoice" TEXT DEFAULT 'true',
  "printAddressShowQuotation" TEXT DEFAULT 'true',
  "printAddressShowDr" TEXT DEFAULT 'true',
  "printAddressShowAccounting" TEXT DEFAULT 'true',
  "printSignaturePreparedBy" TEXT,
  "printSignatureCheckedBy" TEXT,
  "printSignatureApprovedBy" TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- Section 10: Functions & Triggers
-- =============================================================================

-- 10.1 Generic updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Apply updated_at triggers to tables that need them
DO $$
BEGIN
  -- tblquotation
  DROP TRIGGER IF EXISTS trg_tblquotation_updated_at ON public.tblquotation;
  CREATE TRIGGER trg_tblquotation_updated_at
    BEFORE UPDATE ON public.tblquotation
    FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

  -- tblquotation_items
  DROP TRIGGER IF EXISTS trg_tblquotation_items_updated_at ON public.tblquotation_items;
  CREATE TRIGGER trg_tblquotation_items_updated_at
    BEFORE UPDATE ON public.tblquotation_items
    FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

  -- tblprojects
  DROP TRIGGER IF EXISTS trg_tblprojects_updated_at ON public.tblprojects;
  CREATE TRIGGER trg_tblprojects_updated_at
    BEFORE UPDATE ON public.tblprojects
    FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
END $$;

-- 10.2 Quotation auto-numbering trigger
CREATE OR REPLACE FUNCTION public.tblquotation_set_quote_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := nextval(pg_get_serial_sequence('public.tblquotation', 'id'));
  END IF;

  IF NEW.quote_no IS NULL OR btrim(NEW.quote_no) = '' THEN
    NEW.quote_no :=
      'QT-' ||
      to_char(COALESCE(NEW.quote_date, CURRENT_DATE), 'YYYYMMDD') ||
      '-' ||
      lpad(NEW.id::text, 6, '0');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tblquotation_set_quote_no ON public.tblquotation;
CREATE TRIGGER trg_tblquotation_set_quote_no
  BEFORE INSERT ON public.tblquotation
  FOR EACH ROW EXECUTE FUNCTION public.tblquotation_set_quote_no();

-- 10.3 Customer balance update on payment
CREATE OR REPLACE FUNCTION public.update_customer_balance_on_customer_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE public.tblcustomer
    SET current_balance = (
      - COALESCE(
        (SELECT SUM(payment_amount) FROM public.tblcustomer_payments WHERE customer_id = NEW.customer_id),
        0
      )
    ),
    updated_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_customer_balance_on_payment ON public.tblcustomer_payments;
CREATE TRIGGER trg_update_customer_balance_on_payment
  AFTER INSERT OR UPDATE ON public.tblcustomer_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_customer_balance_on_customer_payment();


-- =============================================================================
-- Section 11: Additional Indexes
-- =============================================================================

-- Organization indexes
CREATE INDEX IF NOT EXISTS idx_tblusers_org_id ON public.tblusers(org_id);
CREATE INDEX IF NOT EXISTS idx_tblrbac_org_id ON public.tblrbac(org_id);
CREATE INDEX IF NOT EXISTS idx_tblorg_menus_org_id ON public.tblorg_menus(org_id);

-- PO Payments indexes
CREATE INDEX IF NOT EXISTS idx_po_payments_date ON public.tblpo_payments(payment_date);


-- =============================================================================
-- Section 12: Seed Data
-- =============================================================================

-- 12.1 Default Roles
INSERT INTO public.tblrbac (id, "roleName", "roleMenus", "rolePermission", org_id)
VALUES
  (10, 'superadmin', 'ALL', 'ALL', NULL),
  (11, 'platform_admin', 'dashboard,organizations,user_management,settings', 'canRead,canCreate,canUpdate', NULL)
ON CONFLICT (id) DO NOTHING;

-- Org-scoped roles for Car Expert (org_id = 1)
INSERT INTO public.tblrbac ("roleName", "roleMenus", "rolePermission", org_id)
VALUES
  ('org_admin', 'dashboard,job-orders,customers,vehicles,inventory,technicians,invoices,service-history', 'canRead,canCreate,canUpdate,canDelete', 1),
  ('org_staff', 'dashboard,job-orders,customers,vehicles,inventory', 'canRead,canCreate,canUpdate', 1)
ON CONFLICT DO NOTHING;

-- 12.2 Default Organization (Car Expert Auto Repair)
INSERT INTO public.tblorganizations (id, code, name, description, address, is_active, created_by)
VALUES
  (1, 'car-expert', 'Car Expert Auto Repair', 'Auto repair and maintenance services', '123 Main St, City', TRUE, 1)
ON CONFLICT (id) DO NOTHING;

-- Reset organization sequence
SELECT setval('tblorganizations_id_seq', GREATEST((SELECT MAX(id) FROM public.tblorganizations), 1));

-- Org settings for Car Expert
INSERT INTO public.tblorg_settings (org_id, business_name, business_address)
VALUES (1, 'Car Expert Auto Repair', '123 Main St, City')
ON CONFLICT (org_id) DO NOTHING;

-- Org menus for Car Expert
INSERT INTO public.tblorg_menus (org_id, menu_key, menu_label, menu_order)
VALUES
  (1, 'dashboard',       'Dashboard',       1),
  (1, 'job-orders',      'Job Orders',      2),
  (1, 'customers',       'Customers',       3),
  (1, 'vehicles',        'Vehicles',        4),
  (1, 'inventory',       'Inventory',       5),
  (1, 'technicians',     'Technicians',     6),
  (1, 'invoices',        'Invoices',        7),
  (1, 'service-history', 'Service History', 8)
ON CONFLICT (org_id, menu_key) DO NOTHING;

-- 12.3 Default Menus (auth_menus)
INSERT INTO public.auth_menus (key, label, parent_key, route, icon, order_no)
VALUES
  ('dashboard',       'Dashboard',       NULL, '/dashboard',       'dashboard',     1),
  ('projects',        'Projects',        NULL, '/projects',        'folder',        2),
  ('sales',           'Sales Orders',    NULL, '/sales',           'shopping_cart',  3),
  ('inventory',       'Inventory',       NULL, '/inventory',       'inventory',     4),
  ('settings',        'Settings',        NULL, '/settings',        'settings',      99)
ON CONFLICT (key) DO NOTHING;

-- 12.4 Default Permission Keys
INSERT INTO public.auth_permission_keys (key, label, module, scope)
VALUES
  -- Platform permissions
  ('platform.dashboard.view',       'View Platform Dashboard',  'platform', 'feature'),
  ('platform.organizations.view',   'View Organizations',       'platform', 'feature'),
  ('platform.organizations.create', 'Create Organization',      'platform', 'action'),
  ('platform.organizations.edit',   'Edit Organization',        'platform', 'action'),
  ('platform.organizations.delete', 'Delete Organization',      'platform', 'action'),
  ('platform.users.view',           'View All Users',           'platform', 'feature'),
  ('platform.users.create',         'Create User',              'platform', 'action'),
  ('platform.users.edit',           'Edit User',                'platform', 'action'),
  ('platform.users.delete',         'Delete User',              'platform', 'action'),
  ('platform.settings.view',        'View Platform Settings',   'platform', 'feature'),
  ('platform.settings.edit',        'Edit Platform Settings',   'platform', 'action'),
  -- Org permissions
  ('org.dashboard.view',            'View Org Dashboard',       'org', 'feature'),
  ('org.job-orders.view',           'View Job Orders',          'org', 'feature'),
  ('org.job-orders.create',         'Create Job Order',         'org', 'action'),
  ('org.job-orders.edit',           'Edit Job Order',           'org', 'action'),
  ('org.job-orders.delete',         'Delete Job Order',         'org', 'action'),
  ('org.customers.view',            'View Customers',           'org', 'feature'),
  ('org.customers.create',          'Create Customer',          'org', 'action'),
  ('org.customers.edit',            'Edit Customer',            'org', 'action'),
  ('org.vehicles.view',             'View Vehicles',            'org', 'feature'),
  ('org.vehicles.create',           'Create Vehicle',           'org', 'action'),
  ('org.vehicles.edit',             'Edit Vehicle',             'org', 'action'),
  ('org.inventory.view',            'View Inventory',           'org', 'feature'),
  ('org.inventory.create',          'Create Inventory Item',    'org', 'action'),
  ('org.inventory.edit',            'Edit Inventory Item',      'org', 'action'),
  ('org.technicians.view',          'View Technicians',         'org', 'feature'),
  ('org.technicians.create',        'Create Technician',        'org', 'action'),
  ('org.technicians.edit',          'Edit Technician',          'org', 'action'),
  ('org.invoices.view',             'View Invoices',            'org', 'feature'),
  ('org.invoices.create',           'Create Invoice',           'org', 'action'),
  ('org.service-history.view',      'View Service History',     'org', 'feature'),
  -- Quotation permissions
  ('quotation.view',                'View Quotations',          'quotation', 'feature'),
  ('quotation.create',              'Create Quotation',         'quotation', 'action'),
  ('quotation.edit',                'Edit Quotation',           'quotation', 'action'),
  ('quotation.finalize',            'Finalize Quotation',       'quotation', 'action'),
  ('quotation.convert',             'Convert Quotation to SO',  'quotation', 'action'),
  ('quotation.print',               'Print Quotation',          'quotation', 'action'),
  -- Legacy menu bridge
  ('legacy.menu.quotation',         'Legacy Menu: quotation',   'legacy', 'menu')
ON CONFLICT (key) DO NOTHING;

-- 12.5 Role-Permission Assignments
-- Superadmin gets all permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 10, id FROM public.auth_permission_keys
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Platform admin gets platform.* permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 11, id FROM public.auth_permission_keys
WHERE key LIKE 'platform.%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Org admin gets org.* permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT r.id, pk.id
FROM public.tblrbac r
CROSS JOIN public.auth_permission_keys pk
WHERE r."roleName" = 'org_admin' AND r.org_id = 1
  AND pk.key LIKE 'org.%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Org staff gets org.*.view and org.*.create permissions
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT r.id, pk.id
FROM public.tblrbac r
CROSS JOIN public.auth_permission_keys pk
WHERE r."roleName" = 'org_staff' AND r.org_id = 1
  AND (pk.key LIKE 'org.%.view' OR pk.key LIKE 'org.%.create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 12.6 Default Superadmin User
INSERT INTO public.tblusers (id, username, password, fullname, email, "roleId", status, org_id)
VALUES (
  1,
  'superadmin',
  '$2b$10$wJvQwQwQwQwQwQwQwQwQwOeQwQwQwQwQwQwQwQwQwQwQwQwQwQw',
  'System Superadmin',
  'superadmin@yourdomain.com',
  10,
  1,
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- 12.7 Default Account Titles
INSERT INTO public.tblaccount_titles (account_number, description, is_active)
VALUES
  ('11001', 'Cash In Bank', TRUE),
  ('14001', 'Purchases', TRUE),
  ('14010', 'Input Tax', TRUE),
  ('12001', 'Expanded Withholding Tax', TRUE),
  ('15001', 'DC-Outside Services', TRUE),
  ('15002', 'DC-Materials', TRUE),
  ('15003', 'DC-Others', TRUE)
ON CONFLICT (account_number, description) DO NOTHING;

-- Reset sequences
SELECT setval('tblrbac_id_seq', GREATEST((SELECT MAX(id) FROM public.tblrbac), 1));
SELECT setval('tblusers_id_seq', GREATEST((SELECT MAX(id) FROM public.tblusers), 1));

COMMIT;
