-- Add odometer_reading column to tbljoborders to store the reading at time of JO creation
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS odometer_reading NUMERIC(12,1);

-- Backfill from vehicle's current reading for existing JOs
UPDATE tbljoborders jo
SET odometer_reading = v.odometer_reading
FROM tblvehicles v
WHERE jo.vehicle_id = v.id AND jo.odometer_reading IS NULL AND v.odometer_reading IS NOT NULL;

-- Add transaction_date column to tbljoborders for user-specified transaction date
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS transaction_date DATE;

-- Backfill transaction_date from created_at for existing JOs
UPDATE tbljoborders SET transaction_date = DATE(created_at) WHERE transaction_date IS NULL;

-- Add expense_date column to tblorg_expenses to allow specifying the date of the expense
ALTER TABLE tblorg_expenses ADD COLUMN IF NOT EXISTS expense_date DATE DEFAULT CURRENT_DATE;

-- Backfill expense_date from created_at for existing records
UPDATE tblorg_expenses SET expense_date = DATE(created_at) WHERE expense_date IS NULL;
