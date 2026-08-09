-- Continuation 4.4: daily stock count, company costs, payment proof
-- Runtime Nest ensureSchema/ALTER also creates these; this file is optional/manual.

CREATE TABLE IF NOT EXISTS public.tblpos_daily_stock (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL,
  variant_id    BIGINT NOT NULL,
  business_date DATE NOT NULL,
  opening_qty   NUMERIC(18, 3) NOT NULL DEFAULT 0,
  closing_qty   NUMERIC(18, 3),
  counted_by    BIGINT,
  counted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, variant_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_pos_daily_stock_org_date
  ON public.tblpos_daily_stock (org_id, business_date);

CREATE TABLE IF NOT EXISTS public.tblpos_costs (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT NOT NULL,
  amount         NUMERIC(18, 2) NOT NULL,
  reason         TEXT NOT NULL,
  receipt_image  TEXT,
  created_by     BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_pos_costs_org_created
  ON public.tblpos_costs (org_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

ALTER TABLE public.tblsales_transactions
  ADD COLUMN IF NOT EXISTS payment_proof_image TEXT;
