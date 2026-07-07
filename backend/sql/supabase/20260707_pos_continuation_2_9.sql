-- ============================================================================
-- Migration: POS Continuation 2.9
-- Date: 2026-07-07
-- Description: Org unit types catalog, default unit per variant, POS user-management menu
-- Idempotent — safe to run multiple times.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tblorg_unit_types (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  label           TEXT NOT NULL,
  is_manual_entry BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_org_unit_types_org ON public.tblorg_unit_types(org_id);

ALTER TABLE public.tblinventory_variant_units
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed default unit types for POS orgs
INSERT INTO public.tblorg_unit_types (org_id, code, label, is_manual_entry, sort_order)
SELECT o.id, v.code, v.label, v.is_manual, v.ord
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('piece',  'Piece',  FALSE, 1),
    ('pack',   'Pack',   FALSE, 2),
    ('kilo',   'Kilo',   FALSE, 3),
    ('sack',   'Sack',   FALSE, 4),
    ('grams',  'Grams',  FALSE, 5),
    ('liter',  'Liter',  FALSE, 6),
    ('box',    'Box',    FALSE, 7),
    ('bottle', 'Bottle', FALSE, 8),
    ('can',    'Can',    FALSE, 9),
    ('tray',   'Tray',   FALSE, 10)
) AS v(code, label, is_manual, ord)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, code) DO NOTHING;

-- Mark first active unit per variant as default when none set
UPDATE public.tblinventory_variant_units u
SET is_default = TRUE
FROM (
  SELECT DISTINCT ON (variant_id) id
  FROM public.tblinventory_variant_units
  WHERE is_active = TRUE AND is_default = FALSE
  ORDER BY variant_id, sort_order ASC, id ASC
) first_unit
WHERE u.id = first_unit.id
  AND NOT EXISTS (
    SELECT 1 FROM public.tblinventory_variant_units d
    WHERE d.variant_id = u.variant_id AND d.is_active = TRUE AND d.is_default = TRUE
  );

-- POS org menu: user management
INSERT INTO public.tblorg_menus (org_id, menu_key, menu_label, menu_order)
SELECT o.id, 'user-management', 'User Management', 4
FROM public.tblorganizations o
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, menu_key) DO NOTHING;

-- Add user-management to non-cashier POS org roles
UPDATE public.tblrbac r
SET "roleMenus" = CASE
  WHEN COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', '') ILIKE '%user-management%'
    OR COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', '') ILIKE '%user_management%'
  THEN COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', '')
  WHEN COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', '') = ''
  THEN 'pos-dashboard,inventory,reports,user-management,settings'
  ELSE COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus', '') || ',user-management'
END
WHERE r.org_id IN (SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos'))
  AND LOWER(COALESCE(r."roleName", '')) NOT LIKE '%cashier%';

COMMIT;
