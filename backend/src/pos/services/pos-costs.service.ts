import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class PosCostsService {
  constructor(private readonly db: DatabaseService) {}

  private schemaReady = false;

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblpos_costs (
        id             BIGSERIAL PRIMARY KEY,
        org_id         BIGINT NOT NULL,
        amount         NUMERIC(18, 2) NOT NULL,
        reason         TEXT NOT NULL,
        receipt_image  TEXT,
        created_by     BIGINT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_deleted     BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_pos_costs_org_created
        ON public.tblpos_costs (org_id, created_at DESC)
        WHERE COALESCE(is_deleted, FALSE) = FALSE
    `);
    this.schemaReady = true;
  }

  async list(orgId: number, from?: string, to?: string, createdBy?: number) {
    if (!orgId) return { success: false, message: 'Organization context is required' };
    try {
      await this.ensureSchema();
      const params: unknown[] = [orgId];
      let clause = '';
      if (from) {
        params.push(from);
        clause += ` AND c.created_at::date >= $${params.length}::date`;
      }
      if (to) {
        params.push(to);
        clause += ` AND c.created_at::date <= $${params.length}::date`;
      }
      if (createdBy && Number(createdBy) > 0) {
        params.push(Number(createdBy));
        clause += ` AND c.created_by = $${params.length}`;
      }

      const result = await this.db.query<{
        id: number;
        amount: string;
        reason: string;
        receiptImage: string | null;
        createdBy: number | null;
        createdByName: string;
        createdAt: string;
      }>(
        `SELECT c.id,
                c.amount::text AS amount,
                c.reason,
                c.receipt_image AS "receiptImage",
                c.created_by AS "createdBy",
                COALESCE(to_jsonb(u)->>'fullname', u.username, 'Staff') AS "createdByName",
                c.created_at AS "createdAt"
         FROM tblpos_costs c
         LEFT JOIN tblusers u ON u.id = c.created_by
         WHERE c.org_id = $1
           AND COALESCE(c.is_deleted, FALSE) = FALSE
           ${clause}
         ORDER BY c.created_at DESC
         LIMIT 500`,
        params,
      );

      const totalAmount = result.rows.reduce((sum, row) => sum + Number(row.amount), 0);
      return {
        success: true,
        data: {
          items: result.rows.map((row) => ({
            id: row.id,
            amount: Number(row.amount),
            reason: row.reason,
            receiptImage: row.receiptImage,
            createdBy: row.createdBy,
            createdByName: row.createdByName,
            createdAt: row.createdAt,
          })),
          totalAmount,
          count: result.rows.length,
        },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load company costs',
      };
    }
  }

  async create(
    orgId: number,
    userId: number,
    payload: { amount?: number; reason?: string; receiptImage?: string | null },
  ) {
    if (!orgId || !userId) return { success: false, message: 'Invalid session' };
    const amount = Math.round(Math.max(0, Number(payload?.amount ?? 0)) * 100) / 100;
    const reason = String(payload?.reason ?? '').trim();
    const receiptImage = String(payload?.receiptImage ?? '').trim() || null;

    if (!(amount > 0)) return { success: false, message: 'Amount must be greater than zero' };
    if (!reason) return { success: false, message: 'Reason is required' };
    if (receiptImage && receiptImage.length > 6_000_000) {
      return { success: false, message: 'Receipt image is too large' };
    }

    try {
      await this.ensureSchema();
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblpos_costs (org_id, amount, reason, receipt_image, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [orgId, amount, reason, receiptImage, userId],
      );
      return { success: true, data: { id: result.rows[0].id } };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to save company cost',
      };
    }
  }

  async update(
    orgId: number,
    _userId: number,
    id: number,
    payload: { amount?: number; reason?: string; receiptImage?: string | null },
  ) {
    if (!orgId || !id) return { success: false, message: 'Invalid request' };
    const amount = Math.round(Math.max(0, Number(payload?.amount ?? 0)) * 100) / 100;
    const reason = String(payload?.reason ?? '').trim();
    const receiptImage =
      payload?.receiptImage === undefined
        ? undefined
        : String(payload.receiptImage ?? '').trim() || null;

    if (!(amount > 0)) return { success: false, message: 'Amount must be greater than zero' };
    if (!reason) return { success: false, message: 'Reason is required' };

    try {
      await this.ensureSchema();
      const result = await this.db.query(
        `UPDATE tblpos_costs
         SET amount = $1,
             reason = $2,
             receipt_image = CASE WHEN $3::boolean THEN $4 ELSE receipt_image END,
             updated_at = NOW()
         WHERE id = $5
           AND org_id = $6
           AND COALESCE(is_deleted, FALSE) = FALSE`,
        [
          amount,
          reason,
          receiptImage !== undefined,
          receiptImage ?? null,
          id,
          orgId,
        ],
      );
      if (!result.rowCount) return { success: false, message: 'Cost entry not found' };
      return { success: true };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to update company cost',
      };
    }
  }

  async remove(orgId: number, _userId: number, id: number) {
    if (!orgId || !id) return { success: false, message: 'Invalid request' };
    try {
      await this.ensureSchema();
      const result = await this.db.query(
        `UPDATE tblpos_costs
         SET is_deleted = TRUE, updated_at = NOW()
         WHERE id = $1
           AND org_id = $2
           AND COALESCE(is_deleted, FALSE) = FALSE`,
        [id, orgId],
      );
      if (!result.rowCount) return { success: false, message: 'Cost entry not found' };
      return { success: true };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to delete company cost',
      };
    }
  }
}
