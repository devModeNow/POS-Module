import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import {
  kilosToStockGrams,
  stockGramsToKilos,
  tracksStockInGrams,
} from '../utils/weight-stock.util';

@Injectable()
export class PosDailyStockService {
  constructor(private readonly db: DatabaseService) {}

  private schemaReady = false;

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblpos_daily_stock (
        id            BIGSERIAL PRIMARY KEY,
        org_id        BIGINT NOT NULL,
        variant_id    BIGINT NOT NULL,
        business_date DATE NOT NULL,
        opening_qty   NUMERIC(18, 3) NOT NULL DEFAULT 0,
        closing_qty   NUMERIC(18, 3),
        counted_by    BIGINT,
        counted_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, variant_id, business_date)
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_pos_daily_stock_org_date
        ON public.tblpos_daily_stock (org_id, business_date)
    `);
    this.schemaReady = true;
  }

  private businessDate(date?: string): string {
    const raw = String(date ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /** Sold qty converted into stock base units (grams when weight-tracked). */
  private soldStockExpr(alias = 'st'): string {
    return `
      COALESCE(SUM(
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM tblinventory_variant_units vu
            WHERE vu.variant_id = ${alias}.variant_id
              AND vu.org_id = ${alias}.org_id
              AND vu.is_active = TRUE
              AND (
                vu.is_manual_entry = TRUE
                OR LOWER(vu.unit_type) IN ('grams', 'gram', 'manual')
              )
          ) AND LOWER(COALESCE(${alias}.unit_type, '')) IN ('kilo', 'kilogram', 'kilograms', 'kg')
          THEN ${alias}.quantity_sold * 1000
          ELSE ${alias}.quantity_sold
        END
      ), 0)
    `;
  }

  /** Snapshot opening stock for any variants missing a row today. */
  private async ensureOpeningSnapshots(orgId: number, businessDate: string): Promise<void> {
    const soldExpr = this.soldStockExpr('st');
    await this.db.query(
      `INSERT INTO public.tblpos_daily_stock (org_id, variant_id, business_date, opening_qty)
       SELECT v.org_id,
              v.id,
              $2::date,
              (
                COALESCE(v.stock_qty, 0)
                + COALESCE((
                    SELECT ${soldExpr}
                    FROM tblsales_transactions st
                    WHERE st.org_id = v.org_id
                      AND st.variant_id = v.id
                      AND st.sale_date = $2::date
                      AND COALESCE(st.is_voided, FALSE) = FALSE
                  ), 0)
              )
       FROM tblinventory_variants v
       INNER JOIN tblinventory_products p ON p.id = v.product_id
       WHERE v.org_id = $1
         AND v.is_active = TRUE
         AND p.is_active = TRUE
       ON CONFLICT (org_id, variant_id, business_date) DO NOTHING`,
      [orgId, businessDate],
    );
  }

  async listForDate(orgId: number, date?: string) {
    if (!orgId) return { success: false, message: 'Organization context is required' };
    try {
      await this.ensureSchema();
      const businessDate = this.businessDate(date);
      await this.ensureOpeningSnapshots(orgId, businessDate);

      const soldExpr = this.soldStockExpr('st');
      const result = await this.db.query<{
        id: number;
        variantId: number;
        productName: string;
        variantName: string;
        category: string | null;
        unitType: string | null;
        productSource: string;
        openingQty: string;
        closingQty: string | null;
        currentStock: string;
        soldQty: string;
        countedBy: number | null;
        countedAt: string | null;
        businessDate: string;
        hasGramsUnit: boolean;
      }>(
        `SELECT ds.id,
                ds.variant_id AS "variantId",
                p.name AS "productName",
                v.variant_name AS "variantName",
                NULLIF(TRIM(COALESCE(p.category, '')), '') AS "category",
                v.unit_type AS "unitType",
                COALESCE(v.product_source, 'Retail') AS "productSource",
                ds.opening_qty::text AS "openingQty",
                ds.closing_qty::text AS "closingQty",
                COALESCE(v.stock_qty, 0)::text AS "currentStock",
                COALESCE((
                  SELECT ${soldExpr}
                  FROM tblsales_transactions st
                  WHERE st.org_id = ds.org_id
                    AND st.variant_id = ds.variant_id
                    AND st.sale_date = ds.business_date
                    AND COALESCE(st.is_voided, FALSE) = FALSE
                ), 0)::text AS "soldQty",
                ds.counted_by AS "countedBy",
                ds.counted_at AS "countedAt",
                ds.business_date::text AS "businessDate",
                EXISTS (
                  SELECT 1
                  FROM tblinventory_variant_units vu
                  WHERE vu.variant_id = v.id
                    AND vu.org_id = v.org_id
                    AND vu.is_active = TRUE
                    AND (
                      vu.is_manual_entry = TRUE
                      OR LOWER(vu.unit_type) IN ('grams', 'gram', 'manual')
                    )
                ) AS "hasGramsUnit"
         FROM tblpos_daily_stock ds
         INNER JOIN tblinventory_variants v ON v.id = ds.variant_id AND v.org_id = ds.org_id
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE ds.org_id = $1
           AND ds.business_date = $2::date
           AND v.is_active = TRUE
           AND p.is_active = TRUE
         ORDER BY p.name ASC, COALESCE(v.sort_order, 0) ASC, v.variant_name ASC`,
        [orgId, businessDate],
      );

      return {
        success: true,
        data: {
          businessDate,
          items: result.rows.map((row) => {
            const stockInGrams = tracksStockInGrams(
              row.unitType,
              row.hasGramsUnit ? [{ unitType: 'grams' }] : [],
            ) || Boolean(row.hasGramsUnit);
            const openingQty = Number(row.openingQty);
            const closingQty = row.closingQty != null ? Number(row.closingQty) : null;
            const currentStock = Number(row.currentStock);
            const soldQty = Number(row.soldQty);
            return {
              id: row.id,
              variantId: row.variantId,
              productName: row.productName,
              variantName: row.variantName,
              category: row.category,
              unitType: row.unitType,
              productSource: row.productSource,
              stockInGrams,
              // Canonical stock units (grams when weight-tracked).
              openingQty,
              closingQty,
              currentStock,
              soldQty,
              // Convenience display values in kilos for weight products.
              openingQtyKg: stockInGrams ? stockGramsToKilos(openingQty) : null,
              closingQtyKg: stockInGrams && closingQty != null ? stockGramsToKilos(closingQty) : null,
              currentStockKg: stockInGrams ? stockGramsToKilos(currentStock) : null,
              soldQtyKg: stockInGrams ? stockGramsToKilos(soldQty) : null,
              countedBy: row.countedBy,
              countedAt: row.countedAt,
              businessDate: row.businessDate,
            };
          }),
        },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load daily stock',
      };
    }
  }

  async saveClosingCounts(
    orgId: number,
    userId: number,
    payload: {
      businessDate?: string;
      items?: Array<{
        variantId?: number;
        closingQty?: number | null;
        /** When true, closingQty is entered in kilos and stored as grams. */
        closingInKilos?: boolean;
      }>;
    },
  ) {
    if (!orgId || !userId) return { success: false, message: 'Invalid session' };
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length) return { success: false, message: 'No counts to save' };

    try {
      await this.ensureSchema();
      const businessDate = this.businessDate(payload?.businessDate);
      await this.ensureOpeningSnapshots(orgId, businessDate);

      let saved = 0;
      await this.db.withTransaction(async (client) => {
        for (const item of items) {
          const variantId = Number(item.variantId);
          if (!variantId) continue;
          const closingRaw = item.closingQty;
          let closingQty: number | null =
            closingRaw === null || closingRaw === undefined || String(closingRaw).trim() === ''
              ? null
              : Math.max(0, Number(closingRaw));
          if (closingQty != null && !Number.isFinite(closingQty)) {
            throw new Error('Invalid closing quantity');
          }

          if (closingQty != null) {
            const shouldTreatAsKilos = Boolean(item.closingInKilos);
            if (!shouldTreatAsKilos) {
              const meta = await client.query<{ hasGrams: boolean }>(
                `SELECT EXISTS (
                   SELECT 1
                   FROM tblinventory_variant_units vu
                   WHERE vu.variant_id = $1
                     AND vu.org_id = $2
                     AND vu.is_active = TRUE
                     AND (
                       vu.is_manual_entry = TRUE
                       OR LOWER(vu.unit_type) IN ('grams', 'gram', 'manual')
                     )
                 ) AS "hasGrams"`,
                [variantId, orgId],
              );
              if (meta.rows[0]?.hasGrams) {
                // Weight products are counted in kilos in the UI.
                closingQty = kilosToStockGrams(closingQty);
              }
            } else {
              closingQty = kilosToStockGrams(closingQty);
            }
          }

          const result = await client.query(
            `UPDATE tblpos_daily_stock
             SET closing_qty = $1,
                 counted_by = $2,
                 counted_at = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END,
                 updated_at = NOW()
             WHERE org_id = $3
               AND variant_id = $4
               AND business_date = $5::date`,
            [closingQty, userId, orgId, variantId, businessDate],
          );
          saved += result.rowCount ?? 0;
        }
      });

      return { success: true, data: { saved, businessDate } };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to save stock counts',
      };
    }
  }
}
