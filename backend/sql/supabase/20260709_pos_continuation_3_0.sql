-- Continuation 3.0: staff presence, void codes, sale voiding, company description, POS receipt print fields
BEGIN;

ALTER TABLE public.tblorg_settings
  ADD COLUMN IF NOT EXISTS business_description TEXT,
  ADD COLUMN IF NOT EXISTS pos_receipt_paper_width TEXT DEFAULT '80mm',
  ADD COLUMN IF NOT EXISTS pos_receipt_show_logo BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pos_receipt_footer_text TEXT;

CREATE TABLE IF NOT EXISTS public.tblpos_staff_presence (
  user_id    BIGINT NOT NULL REFERENCES public.tblusers(id) ON DELETE CASCADE,
  org_id     BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_staff_presence_org ON public.tblpos_staff_presence(org_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS public.tblpos_void_codes (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT 'Default',
  code_hash  TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_void_codes_org_label
  ON public.tblpos_void_codes(org_id, lower(label))
  WHERE is_active = TRUE;

ALTER TABLE public.tblsales_transactions
  ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by BIGINT REFERENCES public.tblusers(id),
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

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

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON public.tblaudit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.tblaudit_logs(user_id);

INSERT INTO public.tblorg_menus (org_id, menu_key, menu_label, menu_order)
SELECT o.id, v.menu_key, v.menu_label, v.menu_order
FROM public.tblorganizations o
CROSS JOIN (
  VALUES
    ('pos-my-sales', 'My Sales', 5),
    ('pos-staff', 'On-Duty Staff', 6),
    ('pos-audit-trail', 'Audit Trail', 7)
) AS v(menu_key, menu_label, menu_order)
WHERE o.code IN ('point-of-sales', 'pos')
ON CONFLICT (org_id, menu_key) DO NOTHING;

UPDATE public.tblrbac r
SET "roleMenus" = CASE
  WHEN COALESCE(to_jsonb(r)->>'roleMenus', '') ILIKE '%pos-my-sales%' THEN COALESCE(to_jsonb(r)->>'roleMenus', '')
  WHEN LOWER(COALESCE(r."roleName", '')) LIKE '%cashier%'
    THEN COALESCE(to_jsonb(r)->>'roleMenus', '') || ',pos-my-sales'
  WHEN LOWER(COALESCE(r."roleName", '')) NOT LIKE '%cashier%'
    AND r.org_id IN (SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos'))
    THEN COALESCE(to_jsonb(r)->>'roleMenus', '') || ',pos-staff,pos-audit-trail'
  ELSE COALESCE(to_jsonb(r)->>'roleMenus', '')
END
WHERE r.org_id IN (SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos'));

COMMIT;
