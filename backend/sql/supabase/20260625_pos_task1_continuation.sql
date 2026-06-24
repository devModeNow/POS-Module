-- TASK 1 continuation: unit type + optional POS checkout payment fields
BEGIN;

ALTER TABLE public.tblinventory ADD COLUMN IF NOT EXISTS unit_type TEXT;

ALTER TABLE public.tblsales_transactions ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.tblsales_transactions ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2);
ALTER TABLE public.tblsales_transactions ADD COLUMN IF NOT EXISTS change_amount NUMERIC(12,2);

COMMIT;
