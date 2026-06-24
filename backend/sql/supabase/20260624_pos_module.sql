-- ============================================================================
-- Migration: POS Module — menus and permissions
-- Date: 2026-06-24
-- Description: Seeds POS org menus and permission keys for the Point of Sales org.
-- Idempotent — safe to run multiple times.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.auth_menus') IS NOT NULL THEN
    INSERT INTO public.auth_menus (key, label, parent_key, route, icon, order_no)
    VALUES
      ('pos-dashboard', 'POS Dashboard', NULL, '/pos-dashboard', 'dashboard', 1),
      ('pos-terminal',  'POS Terminal',  NULL, '/pos-terminal',  'point_of_sale', 2)
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.auth_permission_keys') IS NOT NULL THEN
    INSERT INTO public.auth_permission_keys (key, label, module, scope)
    VALUES
      ('pos.dashboard.view',   'View POS Dashboard',   'pos', 'feature'),
      ('pos.terminal.view',    'View POS Terminal',    'pos', 'feature'),
      ('pos.terminal.checkout','Process POS Checkout', 'pos', 'action'),
      ('legacy.menu.pos-dashboard', 'Legacy Menu: pos-dashboard', 'legacy', 'menu'),
      ('legacy.menu.pos-terminal',  'Legacy Menu: pos-terminal',  'legacy', 'menu')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

-- Seed POS organization menus
INSERT INTO public.tblorg_menus (org_id, menu_key, menu_label, menu_order)
SELECT o.id, v.menu_key, v.menu_label, v.menu_order
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('pos-dashboard', 'POS Dashboard', 1),
    ('inventory',     'Inventory',     2),
    ('reports',       'Reports',       3),
    ('settings',      'Settings',      99)
) AS v(menu_key, menu_label, menu_order)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, menu_key) DO NOTHING;

-- Prefer POS dashboard menu for existing POS org roles that still use generic dashboard
UPDATE public.tblrbac r
SET "roleMenus" = REPLACE(
  REPLACE(
    COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', ''),
    '"dashboard"',
    '"pos-dashboard"'
  ),
  'dashboard',
  'pos-dashboard'
)
WHERE r.org_id IN (
  SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos')
)
AND (
  COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', '') ILIKE '%dashboard%'
  OR COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', '') = ''
);

-- Fix roles that were seeded with org code instead of menu keys
UPDATE public.tblrbac r
SET "roleMenus" = 'pos-dashboard,inventory,reports,settings'
WHERE r.org_id IN (
  SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos')
)
AND COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', '') IN (
  SELECT code FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos')
);

COMMIT;
