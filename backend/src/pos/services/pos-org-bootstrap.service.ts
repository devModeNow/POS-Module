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
}
