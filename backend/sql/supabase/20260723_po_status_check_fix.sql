-- Align tblpurchases.status check with app statuses (draft|ordered|received|cancelled).
-- IMPORTANT: drop the old check BEFORE normalizing values (draft may be rejected by legacy CHECK).

ALTER TABLE public.tblpurchases DROP CONSTRAINT IF EXISTS tblpurchases_status_check;

UPDATE public.tblpurchases
SET status = CASE lower(trim(COALESCE(status, '')))
  WHEN 'pending' THEN 'draft'
  WHEN 'completed' THEN 'received'
  WHEN 'complete' THEN 'received'
  WHEN 'canceled' THEN 'cancelled'
  WHEN 'draft' THEN 'draft'
  WHEN 'ordered' THEN 'ordered'
  WHEN 'received' THEN 'received'
  WHEN 'cancelled' THEN 'cancelled'
  ELSE 'draft'
END
WHERE status IS NULL
   OR lower(trim(status)) NOT IN ('draft', 'ordered', 'received', 'cancelled');

ALTER TABLE public.tblpurchases
  ADD CONSTRAINT tblpurchases_status_check
  CHECK (status IN ('draft', 'ordered', 'received', 'cancelled'));

ALTER TABLE public.tblpurchases
  ALTER COLUMN status SET DEFAULT 'draft';
