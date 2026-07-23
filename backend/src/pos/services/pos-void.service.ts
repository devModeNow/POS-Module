import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from 'src/database/database.service';
import { AuditService } from 'src/common/audit/audit.service';

@Injectable()
export class PosVoidService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private hashCode(code: string): string {
    return createHash('sha1').update(String(code).trim()).digest('hex');
  }

  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblpos_void_codes (
        id         BIGSERIAL PRIMARY KEY,
        org_id     BIGINT NOT NULL,
        label      TEXT NOT NULL DEFAULT 'Default',
        code_hash  TEXT NOT NULL,
        is_active  BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.db.query(`
      ALTER TABLE public.tblsales_transactions
        ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS voided_by BIGINT,
        ADD COLUMN IF NOT EXISTS void_reason TEXT,
        ADD COLUMN IF NOT EXISTS reference_number TEXT
    `);
  }

  async listCodes(orgId: number) {
    try {
      await this.ensureSchema();
      const result = await this.db.query<{ id: number; label: string; isActive: boolean }>(
        `SELECT id, label, is_active AS "isActive"
         FROM tblpos_void_codes WHERE org_id = $1 ORDER BY id ASC`,
        [orgId],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load void codes' };
    }
  }

  async upsertCode(orgId: number, dto: { id?: number; label: string; code?: string }) {
    const label = String(dto.label ?? '').trim() || 'Default';
    const code = String(dto.code ?? '').trim();
    try {
      await this.ensureSchema();
      if (dto.id) {
        if (code) {
          const hash = this.hashCode(code);
          await this.db.query(
            `UPDATE tblpos_void_codes SET label = $1, code_hash = $2, is_active = TRUE, updated_at = NOW()
             WHERE id = $3 AND org_id = $4`,
            [label, hash, dto.id, orgId],
          );
        } else {
          await this.db.query(
            `UPDATE tblpos_void_codes SET label = $1, updated_at = NOW()
             WHERE id = $2 AND org_id = $3`,
            [label, dto.id, orgId],
          );
        }
        return { success: true, id: dto.id };
      }
      if (!code) return { success: false, message: 'Code is required' };
      const hash = this.hashCode(code);
      const r = await this.db.query<{ id: number }>(
        `INSERT INTO tblpos_void_codes (org_id, label, code_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        [orgId, label, hash],
      );
      return { success: true, id: r.rows[0]?.id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to save void code' };
    }
  }

  async deactivateCode(orgId: number, id: number) {
    await this.ensureSchema();
    await this.db.query(
      `UPDATE tblpos_void_codes SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    return { success: true };
  }

  async setCodeActive(orgId: number, id: number, isActive: boolean) {
    await this.ensureSchema();
    await this.db.query(
      `UPDATE tblpos_void_codes SET is_active = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
      [isActive, id, orgId],
    );
    return { success: true };
  }

  private async verifyCode(orgId: number, code: string): Promise<boolean> {
    const hash = this.hashCode(code);
    const r = await this.db.query<{ id: number }>(
      `SELECT id FROM tblpos_void_codes
       WHERE org_id = $1 AND is_active = TRUE AND code_hash = $2 LIMIT 1`,
      [orgId, hash],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async authorizeAdminCode(
    orgId: number,
    userId: number,
    username: string,
    dto: { adminCode: string; action?: string; saleId?: number },
  ) {
    await this.ensureSchema();
    const codeOk = await this.verifyCode(orgId, dto.adminCode);
    if (!codeOk) return { success: false, message: 'Invalid admin void code' };

    await this.audit.log({
      orgId,
      userId,
      username,
      action: dto.action || 'pos.admin-code.verify',
      entityType: dto.saleId ? 'sale' : 'admin_code',
      entityId: dto.saleId ?? null,
      details: { authorized: true },
    });
    return { success: true };
  }

  async voidCartLine(
    orgId: number,
    userId: number,
    username: string,
    dto: { saleId?: number; cartKey?: string; adminCode: string; reason?: string },
  ) {
    await this.ensureSchema();
    const codeOk = await this.verifyCode(orgId, dto.adminCode);
    if (!codeOk) return { success: false, message: 'Invalid admin void code' };

    if (!dto.saleId) {
      await this.audit.log({
        orgId,
        userId,
        username,
        action: 'pos.cart.void',
        entityType: 'cart_line',
        entityId: dto.cartKey ?? null,
        details: { reason: dto.reason ?? null },
      });
      return { success: true, message: 'Cart line void authorized' };
    }

    try {
      const line = await this.db.query<{
        id: number;
        variantId: number | null;
        quantitySold: string;
        amountPaid: string | null;
        changeAmount: string | null;
        paymentMethodId: number | null;
        paymentStatus: string | null;
        discountAmount: string | null;
        discountId: number | null;
        referenceNumber: string | null;
        createdBy: number | null;
        saleDate: string;
        createdAt: string;
      }>(
        `SELECT id,
                variant_id AS "variantId",
                quantity_sold::text AS "quantitySold",
                amount_paid::text AS "amountPaid",
                change_amount::text AS "changeAmount",
                payment_method_id AS "paymentMethodId",
                payment_status AS "paymentStatus",
                discount_amount::text AS "discountAmount",
                discount_id AS "discountId",
                NULLIF(TRIM(COALESCE(reference_number, '')), '') AS "referenceNumber",
                created_by AS "createdBy",
                sale_date::text AS "saleDate",
                created_at AS "createdAt"
         FROM tblsales_transactions
         WHERE id = $1 AND org_id = $2 AND COALESCE(is_voided, FALSE) = FALSE
         LIMIT 1`,
        [dto.saleId, orgId],
      );

      const saleLine = line.rows[0];
      if (!saleLine) return { success: false, message: 'Sale not found or already voided' };

      await this.db.withTransaction(async (client) => {
        const voided = await client.query<{ id: number }>(
          `UPDATE tblsales_transactions
           SET is_voided = TRUE, voided_at = NOW(), voided_by = $1, void_reason = $2
           WHERE id = $3 AND org_id = $4 AND COALESCE(is_voided, FALSE) = FALSE
           RETURNING id`,
          [userId, dto.reason ?? null, dto.saleId, orgId],
        );
        if (!voided.rowCount) {
          throw new Error('Sale not found or already voided');
        }

        const qty = Number(saleLine.quantitySold) || 0;
        if (saleLine.variantId != null && qty > 0) {
          await client.query(
            `UPDATE tblinventory_variants
             SET stock_qty = stock_qty + $1, updated_at = NOW()
             WHERE id = $2 AND org_id = $3`,
            [qty, saleLine.variantId, orgId],
          );
        }

        // If this row held the checkout payment header, move it to a sibling line in the same batch.
        if (saleLine.amountPaid != null) {
          const sibling = await client.query<{ id: number }>(
            `SELECT id
             FROM tblsales_transactions
             WHERE org_id = $1
               AND created_by IS NOT DISTINCT FROM $2
               AND sale_date = $3::date
               AND created_at >= $4::timestamptz - interval '5 seconds'
               AND created_at <= $4::timestamptz + interval '5 seconds'
               AND id <> $5
               AND COALESCE(is_voided, FALSE) = FALSE
             ORDER BY id ASC
             LIMIT 1`,
            [orgId, saleLine.createdBy, saleLine.saleDate, saleLine.createdAt, saleLine.id],
          );
          const nextId = sibling.rows[0]?.id;
          if (nextId) {
            await client.query(
              `UPDATE tblsales_transactions
               SET amount_paid = $1,
                   change_amount = $2,
                   payment_method_id = $3,
                   payment_status = $4,
                   discount_amount = $5,
                   discount_id = $6,
                   reference_number = $7
               WHERE id = $8 AND org_id = $9`,
              [
                saleLine.amountPaid,
                saleLine.changeAmount,
                saleLine.paymentMethodId,
                saleLine.paymentStatus,
                saleLine.discountAmount,
                saleLine.discountId,
                saleLine.referenceNumber,
                nextId,
                orgId,
              ],
            );
          }
        }
      });

      await this.audit.log({
        orgId,
        userId,
        username,
        action: 'pos.sale.void',
        entityType: 'sale',
        entityId: dto.saleId,
        details: {
          reason: dto.reason ?? null,
          variantId: saleLine.variantId,
          quantityRestored: Number(saleLine.quantitySold) || 0,
        },
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Void failed' };
    }
  }
}
