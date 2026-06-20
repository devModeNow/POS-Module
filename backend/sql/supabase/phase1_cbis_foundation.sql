-- =============================================================================
-- CBIS Phase 1 Foundation Migration
-- Centralized Business Information System
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CREATE tblorganizations
-- Replaces tblbranches as the central registry of all business organizations
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2. CREATE tblorg_settings
-- Per-organization business profile and print settings
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 3. CREATE tblorg_menus
-- Per-organization menu definitions — drives the sidebar dynamically
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 4. ADD org_id TO tblusers
-- NULL = platform-level user (Super Admin), non-null = scoped to an org
-- -----------------------------------------------------------------------------
ALTER TABLE public.tblusers
  ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES public.tblorganizations(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 5. ADD org_id TO tblrbac
-- NULL = platform-level role, non-null = role belongs to a specific org
-- -----------------------------------------------------------------------------
ALTER TABLE public.tblrbac
  ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES public.tblorganizations(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 6. SEED: Platform organization (the CBIS platform itself, org_id = NULL users)
--    and Car Expert Auto Repair as the first real organization
-- -----------------------------------------------------------------------------
INSERT INTO public.tblorganizations (id, code, name, description, address, is_active, created_by)
VALUES
  (1, 'car-expert', 'Car Expert Auto Repair', 'Auto repair and maintenance services', '123 Main St, City', TRUE, 1)
ON CONFLICT (id) DO NOTHING;

-- Reset sequence to avoid collision
SELECT setval('tblorganizations_id_seq', (SELECT MAX(id) FROM public.tblorganizations));

-- -----------------------------------------------------------------------------
-- 7. SEED: tblorg_settings for Car Expert
-- -----------------------------------------------------------------------------
INSERT INTO public.tblorg_settings (org_id, business_name, business_address)
VALUES (1, 'Car Expert Auto Repair', '123 Main St, City')
ON CONFLICT (org_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 8. SEED: tblorg_menus for Car Expert
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 9. SEED: Platform-level roles (org_id = NULL)
-- -----------------------------------------------------------------------------
INSERT INTO public.tblrbac (id, "roleName", "roleMenus", "rolePermission", org_id)
VALUES
  (10, 'superadmin',      'ALL', 'ALL', NULL),
  (11, 'platform_admin',  'dashboard,organizations,user_management,settings', 'canRead,canCreate,canUpdate', NULL)
ON CONFLICT (id) DO NOTHING;

-- Seed org-scoped roles for Car Expert (org_id = 1)
INSERT INTO public.tblrbac ("roleName", "roleMenus", "rolePermission", org_id)
VALUES
  ('org_admin', 'dashboard,job-orders,customers,vehicles,inventory,technicians,invoices,service-history', 'canRead,canCreate,canUpdate,canDelete', 1),
  ('org_staff',  'dashboard,job-orders,customers,vehicles,inventory', 'canRead,canCreate,canUpdate', 1)
ON CONFLICT DO NOTHING;

SELECT setval('tblrbac_id_seq', (SELECT MAX(id) FROM public.tblrbac));

-- -----------------------------------------------------------------------------
-- 10. SEED: Platform permission keys
-- -----------------------------------------------------------------------------
INSERT INTO public.auth_permission_keys (key, label, module, scope)
VALUES
  -- Platform menus
  ('platform.dashboard.view',           'View Platform Dashboard',    'platform', 'feature'),
  ('platform.organizations.view',       'View Organizations',         'platform', 'feature'),
  ('platform.organizations.create',     'Create Organization',        'platform', 'action'),
  ('platform.organizations.edit',       'Edit Organization',          'platform', 'action'),
  ('platform.organizations.delete',     'Delete Organization',        'platform', 'action'),
  ('platform.users.view',               'View All Users',             'platform', 'feature'),
  ('platform.users.create',             'Create User',                'platform', 'action'),
  ('platform.users.edit',               'Edit User',                  'platform', 'action'),
  ('platform.users.delete',             'Delete User',                'platform', 'action'),
  ('platform.settings.view',            'View Platform Settings',     'platform', 'feature'),
  ('platform.settings.edit',            'Edit Platform Settings',     'platform', 'action'),
  -- Org menus (Car Expert)
  ('org.dashboard.view',                'View Org Dashboard',         'org',      'feature'),
  ('org.job-orders.view',               'View Job Orders',            'org',      'feature'),
  ('org.job-orders.create',             'Create Job Order',           'org',      'action'),
  ('org.job-orders.edit',               'Edit Job Order',             'org',      'action'),
  ('org.job-orders.delete',             'Delete Job Order',           'org',      'action'),
  ('org.customers.view',                'View Customers',             'org',      'feature'),
  ('org.customers.create',              'Create Customer',            'org',      'action'),
  ('org.customers.edit',                'Edit Customer',              'org',      'action'),
  ('org.vehicles.view',                 'View Vehicles',              'org',      'feature'),
  ('org.vehicles.create',               'Create Vehicle',             'org',      'action'),
  ('org.vehicles.edit',                 'Edit Vehicle',               'org',      'action'),
  ('org.inventory.view',                'View Inventory',             'org',      'feature'),
  ('org.inventory.create',              'Create Inventory Item',      'org',      'action'),
  ('org.inventory.edit',                'Edit Inventory Item',        'org',      'action'),
  ('org.technicians.view',              'View Technicians',           'org',      'feature'),
  ('org.technicians.create',            'Create Technician',          'org',      'action'),
  ('org.technicians.edit',              'Edit Technician',            'org',      'action'),
  ('org.invoices.view',                 'View Invoices',              'org',      'feature'),
  ('org.invoices.create',               'Create Invoice',             'org',      'action'),
  ('org.service-history.view',          'View Service History',       'org',      'feature')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 11. ASSIGN all platform permission keys to superadmin role (id=10)
-- -----------------------------------------------------------------------------
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 10, id FROM public.auth_permission_keys
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Assign platform.* keys to platform_admin (id=11)
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT 11, id FROM public.auth_permission_keys
WHERE key LIKE 'platform.%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Assign org.* keys to org_admin
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT r.id, pk.id
FROM public.tblrbac r
CROSS JOIN public.auth_permission_keys pk
WHERE r."roleName" = 'org_admin' AND r.org_id = 1
  AND pk.key LIKE 'org.%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Assign org.*.view and org.*.create keys to org_staff
INSERT INTO public.auth_role_permissions (role_id, permission_id)
SELECT r.id, pk.id
FROM public.tblrbac r
CROSS JOIN public.auth_permission_keys pk
WHERE r."roleName" = 'org_staff' AND r.org_id = 1
  AND (pk.key LIKE 'org.%.view' OR pk.key LIKE 'org.%.create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 12. MIGRATE existing data
-- Assign existing admin user to Car Expert org
-- Assign existing Car Expert roles (ADMIN, SERVICE_ADVISOR, etc.) to org_id = 1
-- -----------------------------------------------------------------------------
UPDATE public.tblusers
SET org_id = 1
WHERE org_id IS NULL AND id != 1;  -- keep user id=1 as platform superadmin

UPDATE public.tblrbac
SET org_id = 1
WHERE org_id IS NULL AND id IN (1, 2, 3, 4);  -- existing Car Expert roles

-- -----------------------------------------------------------------------------
-- 13. CREATE indexes for performance
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tblusers_org_id ON public.tblusers(org_id);
CREATE INDEX IF NOT EXISTS idx_tblrbac_org_id ON public.tblrbac(org_id);
CREATE INDEX IF NOT EXISTS idx_tblorg_menus_org_id ON public.tblorg_menus(org_id);

COMMIT;
