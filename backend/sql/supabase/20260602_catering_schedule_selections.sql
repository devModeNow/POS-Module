-- ============================================================================
-- Migration: Catering Schedule Menu Selections
-- Date: 2026-06-02
-- Description: Stores the customer's menu item selections per schedule.
--   When a customer books a catering event and selects a package, they also
--   pick specific menu items from each category (up to the selection limit).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catering_schedule_selections (
  id              BIGSERIAL PRIMARY KEY,
  schedule_id     BIGINT NOT NULL REFERENCES public.catering_schedules(id) ON DELETE CASCADE,
  menu_item_id    BIGINT NOT NULL REFERENCES public.catering_menu_items(id) ON DELETE RESTRICT,
  category        VARCHAR(20) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catering_schedule_selections_schedule
  ON public.catering_schedule_selections(schedule_id);
