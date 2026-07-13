import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

/** Idempotent POS org setup — ensures user-management menu and role access exist. */
@Injectable()
export class PosOrgBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(PosOrgBootstrapService.name);
  private ready = false;

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePosUserManagement();
    await this.ensureContinuation30();
    await this.ensureContinuation31();
  }

  private async ensurePosUserManagement(): Promise<void> {
    if (this.ready) return;

    try {
      const orgCheck = await this.db.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'tblorganizations'
         ) AS exists`,
      );
      if (!orgCheck.rows[0]?.exists) return;

      await this.db.query(`
        INSERT INTO public.tblorg_menus (org_id, menu_key, menu_label, menu_order)
        SELECT o.id, 'user-management', 'User Management', 4
        FROM public.tblorganizations o
        WHERE o.code IN ('point-of-sales', 'pos')
        ON CONFLICT (org_id, menu_key) DO NOTHING
      `);

      await this.db.query(`
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
          AND LOWER(COALESCE(r."roleName", '')) NOT LIKE '%cashier%'
      `);

      this.ready = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`POS user-management bootstrap skipped: ${message}`);
    }
  }

  private async ensureContinuation30(): Promise<void> {
    try {
      await this.db.query(`
        ALTER TABLE public.tblsales_transactions
          ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS voided_by BIGINT,
          ADD COLUMN IF NOT EXISTS void_reason TEXT
      `);

      await this.db.query(`
        INSERT INTO public.tblorg_menus (org_id, menu_key, menu_label, menu_order)
        SELECT o.id, v.menu_key, v.menu_label, v.menu_order
        FROM public.tblorganizations o
        CROSS JOIN (
          VALUES
            ('pos-my-sales', 'My Sales', 5),
            ('pos-staff', 'On-Duty Staff', 6),
            ('pos-audit-trail', 'Audit Trail', 7),
            ('pos-company-profile', 'Company Profile', 8)
        ) AS v(menu_key, menu_label, menu_order)
        WHERE o.code IN ('point-of-sales', 'pos')
        ON CONFLICT (org_id, menu_key) DO NOTHING
      `);

      await this.db.query(`
        UPDATE public.tblrbac r
        SET "roleMenus" = CASE
          WHEN LOWER(COALESCE(r."roleName", '')) LIKE '%cashier%'
            AND COALESCE(to_jsonb(r)->>'roleMenus', '') NOT ILIKE '%pos-my-sales%'
          THEN COALESCE(to_jsonb(r)->>'roleMenus', '') || ',pos-my-sales'
          WHEN LOWER(COALESCE(r."roleName", '')) NOT LIKE '%cashier%'
            AND r.org_id IN (SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos'))
            AND COALESCE(to_jsonb(r)->>'roleMenus', '') NOT ILIKE '%pos-staff%'
          THEN COALESCE(to_jsonb(r)->>'roleMenus', '') || ',pos-staff,pos-audit-trail,pos-company-profile'
          ELSE COALESCE(to_jsonb(r)->>'roleMenus', '')
        END
        WHERE r.org_id IN (SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos'))
      `);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`POS continuation 3.0 bootstrap skipped: ${message}`);
    }
  }

  private async ensureContinuation31(): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO public.tblorg_menus (org_id, menu_key, menu_label, menu_order)
        SELECT o.id, 'dashboard', 'Dashboard', 0
        FROM public.tblorganizations o
        WHERE o.code IN ('point-of-sales', 'pos')
        ON CONFLICT (org_id, menu_key) DO NOTHING
      `);

      await this.db.query(`
        UPDATE public.tblrbac r
        SET "roleMenus" = CASE
          WHEN LOWER(COALESCE(r."roleName", '')) NOT LIKE '%cashier%'
            AND r.org_id IN (SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos'))
            AND COALESCE(to_jsonb(r)->>'roleMenus', '') NOT ILIKE '%dashboard%'
          THEN 'dashboard,' || COALESCE(to_jsonb(r)->>'roleMenus', '')
          ELSE COALESCE(to_jsonb(r)->>'roleMenus', '')
        END
        WHERE r.org_id IN (SELECT id FROM public.tblorganizations WHERE code IN ('point-of-sales', 'pos'))
      `);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`POS continuation 3.1 bootstrap skipped: ${message}`);
    }
  }
}
