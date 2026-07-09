import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export type AuditLogInput = {
  orgId?: number | null;
  userId?: number | null;
  username?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  details?: Record<string, unknown> | null;
};

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  private schemaReady = false;

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblaudit_logs (
        id          BIGSERIAL PRIMARY KEY,
        org_id      BIGINT REFERENCES public.tblorganizations(id) ON DELETE SET NULL,
        user_id     BIGINT REFERENCES public.tblusers(id) ON DELETE SET NULL,
        username    TEXT,
        action      TEXT NOT NULL,
        entity_type TEXT,
        entity_id   TEXT,
        details     JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
        ON public.tblaudit_logs(org_id, created_at DESC)
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user
        ON public.tblaudit_logs(user_id)
    `);
    this.schemaReady = true;
  }

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.ensureSchema();
      await this.db.query(
        `INSERT INTO tblaudit_logs (org_id, user_id, username, action, entity_type, entity_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          input.orgId ?? null,
          input.userId ?? null,
          input.username ?? null,
          input.action,
          input.entityType ?? null,
          input.entityId != null ? String(input.entityId) : null,
          input.details ? JSON.stringify(input.details) : null,
        ],
      );
    } catch {
      /* non-blocking */
    }
  }

  async list(options: {
    orgId?: number | null;
    scope?: 'org' | 'all';
    limit?: number;
    offset?: number;
  }) {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const scope = options.scope ?? 'org';

    try {
      await this.ensureSchema();

      const values: unknown[] = [];
      let where = '';

      if (scope === 'org') {
        if (!options.orgId) {
          return { success: true, data: [] };
        }
        values.push(options.orgId);
        where = `WHERE org_id = $1`;
      }

      values.push(limit, offset);
      const limitIdx = values.length - 1;
      const offsetIdx = values.length;

      const result = await this.db.query<{
        id: number;
        orgId: number | null;
        userId: number | null;
        username: string | null;
        action: string;
        entityType: string | null;
        entityId: string | null;
        details: Record<string, unknown> | null;
        createdAt: string;
      }>(
        `SELECT id,
                org_id AS "orgId",
                user_id AS "userId",
                username,
                action,
                entity_type AS "entityType",
                entity_id AS "entityId",
                details,
                created_at AS "createdAt"
         FROM tblaudit_logs
         ${where}
         ORDER BY created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        values,
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load audit logs',
      };
    }
  }
}
