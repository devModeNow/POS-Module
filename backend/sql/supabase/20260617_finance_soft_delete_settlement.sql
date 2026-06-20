-- Finance Module: Expense soft-delete and Receivable settlement columns
-- 2026-06-17

-- Add soft-delete columns to tblorg_expenses
ALTER TABLE tblorg_expenses
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT,
  ADD COLUMN IF NOT EXISTS deleted_by BIGINT;

CREATE INDEX IF NOT EXISTS idx_tblorg_expenses_deleted
  ON tblorg_expenses (org_id) WHERE deleted_at IS NULL;

-- Add settlement columns to tbljo_payments (for PO/Cheque receivables)
ALTER TABLE tbljo_payments
  ADD COLUMN IF NOT EXISTS settlement_mode VARCHAR(50),
  ADD COLUMN IF NOT EXISTS settlement_date DATE,
  ADD COLUMN IF NOT EXISTS settlement_reference TEXT,
  ADD COLUMN IF NOT EXISTS settlement_by BIGINT;

COMMENT ON COLUMN tbljo_payments.settlement_mode IS 'How the receivable was settled: cash, cheque, bank_transfer';
COMMENT ON COLUMN tbljo_payments.settlement_date IS 'Date the receivable was settled/collected';
COMMENT ON COLUMN tbljo_payments.settlement_reference IS 'Reference number for the settlement transaction';
