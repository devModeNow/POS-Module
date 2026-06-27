-- POS variant checkout: inventory_id optional when variant_id is used
BEGIN;

ALTER TABLE public.tblsales_transactions
  ALTER COLUMN inventory_id DROP NOT NULL;

COMMIT;
