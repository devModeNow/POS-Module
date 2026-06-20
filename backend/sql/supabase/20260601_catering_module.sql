-- ============================================================================
-- Migration: Catering Module Tables
-- Date: 2026-06-01
-- Description: Creates all tables for the Catering Management Module.
--   - catering_packages: Bundled catering offerings with pricing
--   - catering_menu_items: Individual food items by category
--   - catering_package_items: Junction table linking packages to menu items
--   - catering_schedules: Catering event bookings with lifecycle status
--   - catering_expenses: Operational expenses per completed schedule
--   - catering_feedback: Customer feedback and satisfaction ratings
--
-- This migration is idempotent — safe to run multiple times.
-- All tables are scoped by org_id for multi-tenant isolation.
-- Tables are created in dependency order:
--   1. catering_packages & catering_menu_items (reference only tblorganizations)
--   2. catering_package_items (references packages & menu_items)
--   3. catering_schedules (references packages)
--   4. catering_expenses & catering_feedback (reference schedules)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. catering_packages — Bundled catering offerings with pricing
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catering_packages (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  name            VARCHAR(100) NOT NULL,
  price_per_head  NUMERIC(12,2) NOT NULL CHECK (price_per_head > 0),
  min_pax         INTEGER NOT NULL CHECK (min_pax >= 1),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_catering_packages_org ON public.catering_packages(org_id);

-- --------------------------------------------------------------------------
-- 2. catering_menu_items — Individual food items organized by category
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catering_menu_items (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  name            VARCHAR(100) NOT NULL,
  category        VARCHAR(20) NOT NULL
    CHECK (category IN ('chicken', 'pork', 'vegetable', 'seafood', 'beef',
                        'soup', 'pasta', 'salad', 'drinks', 'dessert',
                        'appetizer', 'freebie')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_catering_menu_items_org ON public.catering_menu_items(org_id);

-- --------------------------------------------------------------------------
-- 3. catering_package_items — Junction table linking packages to menu items
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catering_package_items (
  package_id      BIGINT NOT NULL REFERENCES public.catering_packages(id) ON DELETE CASCADE,
  menu_item_id    BIGINT NOT NULL REFERENCES public.catering_menu_items(id) ON DELETE CASCADE,
  selection_limit INTEGER NOT NULL CHECK (selection_limit >= 1),
  UNIQUE (package_id, menu_item_id)
);

-- --------------------------------------------------------------------------
-- 4. catering_schedules — Catering event bookings with lifecycle status
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catering_schedules (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id),
  customer_name   VARCHAR(100) NOT NULL,
  contact_number  VARCHAR(50) NOT NULL,
  venue           TEXT NOT NULL,
  event_date      DATE NOT NULL,
  pax             INTEGER NOT NULL CHECK (pax >= 1),
  package_id      BIGINT NOT NULL REFERENCES public.catering_packages(id) ON DELETE RESTRICT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  total_expense   NUMERIC(12,2) DEFAULT 0.00,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_catering_schedules_org ON public.catering_schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_catering_schedules_status ON public.catering_schedules(org_id, status);

-- --------------------------------------------------------------------------
-- 5. catering_expenses — Operational expenses per completed schedule
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catering_expenses (
  id              BIGSERIAL PRIMARY KEY,
  schedule_id     BIGINT NOT NULL REFERENCES public.catering_schedules(id) ON DELETE CASCADE,
  category        VARCHAR(50) NOT NULL
    CHECK (category IN ('Purchases', 'Rental', 'Electricity & Water',
                        'Communication', 'Salaries & Wages', 'Supplies & Materials',
                        'Repair & Maintenance', 'Travel & Transportation',
                        'Representation', 'SSS', 'Philhealth', 'Pag IBIG',
                        'Taxes', 'Licenses', 'Professional Fee', 'Miscellaneous')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_catering_expenses_schedule ON public.catering_expenses(schedule_id);

-- --------------------------------------------------------------------------
-- 6. catering_feedback — Customer feedback and satisfaction ratings
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catering_feedback (
  id              BIGSERIAL PRIMARY KEY,
  schedule_id     BIGINT NOT NULL REFERENCES public.catering_schedules(id) ON DELETE CASCADE,
  feedback_type   VARCHAR(30) NOT NULL
    CHECK (feedback_type IN ('scheduling_experience', 'satisfaction_rating')),
  rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review          TEXT,
  link_token      VARCHAR(64) UNIQUE,
  link_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catering_feedback_schedule ON public.catering_feedback(schedule_id);
CREATE INDEX IF NOT EXISTS idx_catering_feedback_token ON public.catering_feedback(link_token) WHERE link_token IS NOT NULL;


-- --------------------------------------------------------------------------
-- 7. catering_schedule_selections — Customer menu item choices per schedule
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catering_schedule_selections (
  id              BIGSERIAL PRIMARY KEY,
  schedule_id     BIGINT NOT NULL REFERENCES public.catering_schedules(id) ON DELETE CASCADE,
  menu_item_id    BIGINT NOT NULL REFERENCES public.catering_menu_items(id) ON DELETE CASCADE,
  category        VARCHAR(20) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catering_schedule_selections_schedule ON public.catering_schedule_selections(schedule_id);


-- --------------------------------------------------------------------------
-- 8. Add image_url column to catering_menu_items for thumbnail storage
-- --------------------------------------------------------------------------
ALTER TABLE public.catering_menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;


-- --------------------------------------------------------------------------
-- 9. Update status CHECK constraint to include 'cancelled'
-- --------------------------------------------------------------------------
ALTER TABLE public.catering_schedules DROP CONSTRAINT IF EXISTS catering_schedules_status_check;
ALTER TABLE public.catering_schedules ADD CONSTRAINT catering_schedules_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));


-- --------------------------------------------------------------------------
-- 10. Add package branding columns for enhanced card display
-- --------------------------------------------------------------------------
ALTER TABLE public.catering_packages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.catering_packages ADD COLUMN IF NOT EXISTS is_best_seller BOOLEAN DEFAULT FALSE;
ALTER TABLE public.catering_packages ADD COLUMN IF NOT EXISTS promo_text VARCHAR(100);


-- --------------------------------------------------------------------------
-- 11. Add is_top_pick column to catering_menu_items
-- --------------------------------------------------------------------------
ALTER TABLE public.catering_menu_items ADD COLUMN IF NOT EXISTS is_top_pick BOOLEAN DEFAULT FALSE;


-- --------------------------------------------------------------------------
-- 12. Add payment, event time, and discount columns to catering_schedules
-- --------------------------------------------------------------------------
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS event_time VARCHAR(10);
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0.00;
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) DEFAULT 'fixed';
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS notes TEXT;


-- --------------------------------------------------------------------------
-- 13. Add payment detail columns for various payment methods
-- --------------------------------------------------------------------------
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS cheque_issued_by VARCHAR(100);
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS cheque_post_dated DATE;
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS cheque_amount NUMERIC(12,2);
ALTER TABLE public.catering_schedules ADD COLUMN IF NOT EXISTS is_floating_sales BOOLEAN DEFAULT FALSE;
