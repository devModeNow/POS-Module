import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export type PosNotificationType = 'sale' | 'message' | 'system';

@Injectable()
export class PosNotificationsService {
  constructor(private readonly db: DatabaseService) {}

  private schemaReady = false;

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblpos_notifications (
        id             BIGSERIAL PRIMARY KEY,
        org_id         BIGINT NOT NULL,
        user_id        BIGINT,
        type           TEXT NOT NULL DEFAULT 'system',
        title          TEXT NOT NULL,
        body           TEXT,
        reference_type TEXT,
        reference_id   BIGINT,
        is_read        BOOLEAN NOT NULL DEFAULT FALSE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pos_notif_org_user ON public.tblpos_notifications (org_id, user_id, created_at DESC);
    `);
    await this.db.query(`
      ALTER TABLE public.tblpos_notifications
        ADD COLUMN IF NOT EXISTS reference_type TEXT,
        ADD COLUMN IF NOT EXISTS reference_id BIGINT
    `);
    this.schemaReady = true;
  }

  async list(orgId: number, userId: number, forAdmin: boolean, limit = 50) {
    try {
      await this.ensureSchema();
      const typeFilter = forAdmin ? '' : `AND type = 'message'`;
      const result = await this.db.query<{
        id: number;
        type: string;
        title: string;
        body: string | null;
        referenceType: string | null;
        referenceId: number | null;
        isRead: boolean;
        createdAt: string;
      }>(
        `SELECT id, type, title, body,
                reference_type AS "referenceType",
                reference_id AS "referenceId",
                is_read AS "isRead", created_at AS "createdAt"
         FROM tblpos_notifications
         WHERE org_id = $1
           AND (user_id IS NULL OR user_id = $2)
           ${typeFilter}
         ORDER BY created_at DESC
         LIMIT $3`,
        [orgId, userId, limit],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load notifications' };
    }
  }

  async unreadCount(orgId: number, userId: number, forAdmin: boolean) {
    try {
      await this.ensureSchema();
      const typeFilter = forAdmin ? '' : `AND type = 'message'`;
      const result = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM tblpos_notifications
         WHERE org_id = $1 AND is_read = FALSE
           AND (user_id IS NULL OR user_id = $2)
           ${typeFilter}`,
        [orgId, userId],
      );
      return { success: true, count: Number(result.rows[0]?.count ?? 0) };
    } catch (e) {
      return { success: false, count: 0 };
    }
  }

  async markRead(orgId: number, userId: number, notificationId?: number) {
    try {
      await this.ensureSchema();
      if (notificationId) {
        await this.db.query(
          `UPDATE tblpos_notifications SET is_read = TRUE
           WHERE org_id = $1 AND id = $2 AND (user_id IS NULL OR user_id = $3)`,
          [orgId, notificationId, userId],
        );
      } else {
        await this.db.query(
          `UPDATE tblpos_notifications SET is_read = TRUE
           WHERE org_id = $1 AND (user_id IS NULL OR user_id = $2)`,
          [orgId, userId],
        );
      }
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to mark notifications read' };
    }
  }

  async notifySale(orgId: number, title: string, body: string, saleId: number) {
    return this.create(orgId, null, 'sale', title, body, 'sale', saleId);
  }

  async notifyMessage(
    orgId: number,
    userId: number | null,
    title: string,
    body: string,
    referenceType: string | null = 'chat',
    referenceId: number | null = null,
  ) {
    return this.create(orgId, userId, 'message', title, body, referenceType, referenceId);
  }

  private async create(
    orgId: number,
    userId: number | null,
    type: PosNotificationType,
    title: string,
    body: string,
    referenceType: string | null = null,
    referenceId: number | null = null,
  ) {
    try {
      await this.ensureSchema();
      await this.db.query(
        `INSERT INTO tblpos_notifications (org_id, user_id, type, title, body, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orgId, userId, type, title, body, referenceType, referenceId],
      );
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create notification' };
    }
  }
}
