import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class PosStoreReportsService {
  constructor(private readonly db: DatabaseService) {}

  private salesVoidSchemaReady = false;

  private async ensureSalesVoidSchema(): Promise<void> {
    if (this.salesVoidSchemaReady) return;
    await this.db.query(`
      ALTER TABLE public.tblsales_transactions
        ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS voided_by BIGINT,
        ADD COLUMN IF NOT EXISTS void_reason TEXT
    `);
    this.salesVoidSchemaReady = true;
  }

  private dateClause(params: unknown[], from?: string, to?: string, alias = 'st') {
    let clause = '';
    if (from) {
      params.push(from);
      clause += ` AND ${alias}.sale_date >= $${params.length}::date`;
    }
    if (to) {
      params.push(to);
      clause += ` AND ${alias}.sale_date <= $${params.length}::date`;
    }
    return clause;
  }

  async listTransactions(
    orgId: number,
    from?: string,
    to?: string,
    paymentStatus?: string,
    limit = 50,
    offset = 0,
  ) {
    try {
      const params: unknown[] = [orgId];
      let dateClause = this.dateClause(params, from, to);
      let statusClause = '';
      if (paymentStatus === 'settled' || paymentStatus === 'floating') {
        params.push(paymentStatus);
        statusClause = ` AND st.payment_status = $${params.length}`;
      }
      params.push(limit, offset);

      const result = await this.db.query<{
        id: number;
        saleDate: string;
        totalAmount: string;
        amountPaid: string | null;
        changeAmount: string | null;
        paymentStatus: string;
        paymentMethod: string;
        cashier: string;
        createdAt: string;
        itemCount: string;
      }>(
        `SELECT st.id,
                st.sale_date::text AS "saleDate",
                (
                  SELECT COALESCE(SUM(s2.total_amount), 0)
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                )::text AS "totalAmount",
                st.amount_paid::text AS "amountPaid",
                st.change_amount::text AS "changeAmount",
                COALESCE(st.payment_status, 'settled') AS "paymentStatus",
                COALESCE(pm.name, 'Unknown') AS "paymentMethod",
                COALESCE(to_jsonb(u)->>'fullname', u.username, 'Unknown') AS cashier,
                st.created_at AS "createdAt",
                (
                  SELECT COUNT(*)::text
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                ) AS "itemCount"
         FROM tblsales_transactions st
         LEFT JOIN tblpayment_methods pm ON pm.id = st.payment_method_id
         LEFT JOIN tblusers u ON u.id = st.created_by
         WHERE st.org_id = $1
           AND st.amount_paid IS NOT NULL
           AND COALESCE(st.is_voided, FALSE) = FALSE
           ${dateClause} ${statusClause}
         ORDER BY st.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      return {
        success: true,
        data: result.rows.map((row) => ({
          id: row.id,
          saleDate: row.saleDate,
          totalAmount: Number(row.totalAmount),
          amountPaid: row.amountPaid != null ? Number(row.amountPaid) : null,
          changeAmount: row.changeAmount != null ? Number(row.changeAmount) : null,
          paymentStatus: row.paymentStatus,
          paymentMethod: row.paymentMethod,
          cashier: row.cashier,
          createdAt: row.createdAt,
          itemCount: Number(row.itemCount),
        })),
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load transactions',
      };
    }
  }

  async updatePaymentStatus(
    orgId: number,
    transactionId: number,
    paymentStatus: 'settled' | 'floating',
  ) {
    if (paymentStatus !== 'settled' && paymentStatus !== 'floating') {
      return { success: false, message: 'Invalid payment status' };
    }
    try {
      const header = await this.db.query<{
        createdBy: number | null;
        saleDate: string;
        paymentMethodId: number | null;
        amountPaid: string | null;
        createdAt: string;
      }>(
        `SELECT created_by AS "createdBy",
                sale_date::text AS "saleDate",
                payment_method_id AS "paymentMethodId",
                amount_paid::text AS "amountPaid",
                created_at AS "createdAt"
         FROM tblsales_transactions
         WHERE id = $1 AND org_id = $2`,
        [transactionId, orgId],
      );
      const row = header.rows[0];
      if (!row) {
        return { success: false, message: 'Transaction not found' };
      }

      await this.db.query(
        `UPDATE tblsales_transactions
         SET payment_status = $1
         WHERE org_id = $2
           AND created_by IS NOT DISTINCT FROM $3
           AND sale_date = $4::date
           AND payment_method_id IS NOT DISTINCT FROM $5
           AND amount_paid IS NOT DISTINCT FROM $6
           AND created_at >= $7::timestamptz - interval '10 seconds'
           AND created_at <= $7::timestamptz + interval '10 seconds'`,
        [
          paymentStatus,
          orgId,
          row.createdBy,
          row.saleDate,
          row.paymentMethodId,
          row.amountPaid,
          row.createdAt,
        ],
      );

      return { success: true, message: `Payment status updated to ${paymentStatus}` };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to update payment status',
      };
    }
  }

  async getTransactionDetail(orgId: number, transactionId: number) {
    try {
      await this.ensureSalesVoidSchema();
      const header = await this.db.query<{
        id: number;
        saleDate: string;
        createdAt: string;
        createdBy: number | null;
        paymentMethodId: number | null;
        amountPaid: string | null;
        changeAmount: string | null;
        paymentStatus: string;
        discountAmount: string | null;
      }>(
        `SELECT id,
                sale_date::text AS "saleDate",
                created_at AS "createdAt",
                created_by AS "createdBy",
                payment_method_id AS "paymentMethodId",
                amount_paid::text AS "amountPaid",
                change_amount::text AS "changeAmount",
                COALESCE(payment_status, 'settled') AS "paymentStatus",
                discount_amount::text AS "discountAmount"
         FROM tblsales_transactions
         WHERE id = $1 AND org_id = $2`,
        [transactionId, orgId],
      );
      const h = header.rows[0];
      if (!h) return { success: false, message: 'Transaction not found' };

      const lines = await this.db.query<{
        id: number;
        variantId: number;
        productName: string;
        variantName: string;
        quantitySold: string;
        unitType: string;
        unitPrice: string;
        totalAmount: string;
      }>(
        `SELECT st.id,
                st.variant_id AS "variantId",
                COALESCE(p.name, 'Product') AS "productName",
                COALESCE(v.variant_name, 'Variant') AS "variantName",
                st.quantity_sold::text AS "quantitySold",
                COALESCE(st.unit_type, 'piece') AS "unitType",
                st.unit_price::text AS "unitPrice",
                st.total_amount::text AS "totalAmount"
         FROM tblsales_transactions st
         LEFT JOIN tblinventory_variants v ON v.id = st.variant_id
         LEFT JOIN tblinventory_products p ON p.id = v.product_id
         WHERE st.org_id = $1
           AND st.created_by IS NOT DISTINCT FROM $2
           AND st.sale_date = $3::date
           AND st.payment_method_id IS NOT DISTINCT FROM $4
           AND st.amount_paid IS NOT DISTINCT FROM $5
           AND st.created_at >= $6::timestamptz - interval '10 seconds'
           AND st.created_at <= $6::timestamptz + interval '10 seconds'
           AND COALESCE(st.is_voided, FALSE) = FALSE
         ORDER BY st.id ASC`,
        [orgId, h.createdBy, h.saleDate, h.paymentMethodId, h.amountPaid, h.createdAt],
      );

      const meta = await this.db.query<{
        cashier: string;
        paymentMethod: string;
      }>(
        `SELECT COALESCE(u.fullname, u.username, 'Unknown') AS cashier,
                COALESCE(pm.name, 'Unknown') AS "paymentMethod"
         FROM tblsales_transactions st
         LEFT JOIN tblusers u ON u.id = st.created_by
         LEFT JOIN tblpayment_methods pm ON pm.id = st.payment_method_id
         WHERE st.id = $1`,
        [transactionId],
      );

      const totalAmount = lines.rows.reduce((sum, row) => sum + Number(row.totalAmount), 0);

      return {
        success: true,
        data: {
          id: h.id,
          saleDate: h.saleDate,
          createdAt: h.createdAt,
          cashier: meta.rows[0]?.cashier ?? 'Unknown',
          paymentMethod: meta.rows[0]?.paymentMethod ?? 'Unknown',
          paymentStatus: h.paymentStatus,
          amountPaid: h.amountPaid != null ? Number(h.amountPaid) : null,
          changeAmount: h.changeAmount != null ? Number(h.changeAmount) : null,
          discountAmount: h.discountAmount != null ? Number(h.discountAmount) : 0,
          totalAmount,
          itemCount: lines.rows.length,
          items: lines.rows.map((row) => ({
            id: row.id,
            variantId: row.variantId,
            productName: row.productName,
            variantName: row.variantName,
            quantitySold: Number(row.quantitySold),
            unitType: row.unitType,
            unitPrice: Number(row.unitPrice),
            totalAmount: Number(row.totalAmount),
          })),
        },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load transaction detail',
      };
    }
  }

  async dashboard(orgId: number, from?: string, to?: string, paymentStatus?: string) {
    try {
      const params: unknown[] = [orgId];
      let dateClause = this.dateClause(params, from, to);
      let statusClause = '';
      if (paymentStatus === 'settled' || paymentStatus === 'floating') {
        params.push(paymentStatus);
        statusClause = ` AND st.payment_status = $${params.length}`;
      }

      const summary = await this.db.query<{
        totalSales: string;
        settledSales: string;
        floatingSales: string;
        transactionCount: string;
        totalDiscount: string;
      }>(
        `SELECT COALESCE(SUM(st.total_amount), 0)::text AS "totalSales",
                COALESCE(SUM(st.total_amount) FILTER (WHERE st.payment_status = 'settled'), 0)::text AS "settledSales",
                COALESCE(SUM(st.total_amount) FILTER (WHERE st.payment_status = 'floating'), 0)::text AS "floatingSales",
                COUNT(*)::text AS "transactionCount",
                COALESCE(SUM(st.discount_amount), 0)::text AS "totalDiscount"
         FROM tblsales_transactions st
         WHERE st.org_id = $1 ${dateClause} ${statusClause}`,
        params,
      );

      const byDay = await this.db.query<{
        saleDate: string;
        totalSales: string;
        settledSales: string;
        floatingSales: string;
      }>(
        `SELECT st.sale_date::text AS "saleDate",
                COALESCE(SUM(st.total_amount), 0)::text AS "totalSales",
                COALESCE(SUM(st.total_amount) FILTER (WHERE st.payment_status = 'settled'), 0)::text AS "settledSales",
                COALESCE(SUM(st.total_amount) FILTER (WHERE st.payment_status = 'floating'), 0)::text AS "floatingSales"
         FROM tblsales_transactions st
         WHERE st.org_id = $1 ${dateClause} ${statusClause}
         GROUP BY st.sale_date
         ORDER BY st.sale_date ASC
         LIMIT 31`,
        params,
      );

      const byPayment = await this.db.query<{
        methodName: string;
        paymentStatus: string;
        totalAmount: string;
        transactionCount: string;
      }>(
        `SELECT COALESCE(pm.name, 'Unknown') AS "methodName",
                st.payment_status AS "paymentStatus",
                COALESCE(SUM(st.total_amount), 0)::text AS "totalAmount",
                COUNT(*)::text AS "transactionCount"
         FROM tblsales_transactions st
         LEFT JOIN tblpayment_methods pm ON pm.id = st.payment_method_id
         WHERE st.org_id = $1 ${dateClause} ${statusClause}
         GROUP BY pm.name, st.payment_status
         ORDER BY SUM(st.total_amount) DESC`,
        params,
      );

      const byCategory = await this.db.query<{
        category: string;
        totalAmount: string;
        quantitySold: string;
      }>(
        `SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized') AS category,
                COALESCE(SUM(st.total_amount), 0)::text AS "totalAmount",
                COALESCE(SUM(st.quantity_sold), 0)::text AS "quantitySold"
         FROM tblsales_transactions st
         INNER JOIN tblinventory_variants v ON v.id = st.variant_id
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE st.org_id = $1 ${dateClause} ${statusClause}
         GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized')
         ORDER BY SUM(st.total_amount) DESC`,
        params,
      );

      return {
        success: true,
        data: {
          summary: {
            totalSales: Number(summary.rows[0]?.totalSales ?? 0),
            settledSales: Number(summary.rows[0]?.settledSales ?? 0),
            floatingSales: Number(summary.rows[0]?.floatingSales ?? 0),
            transactionCount: Number(summary.rows[0]?.transactionCount ?? 0),
            totalDiscount: Number(summary.rows[0]?.totalDiscount ?? 0),
          },
          byDay: byDay.rows.map((r) => ({
            saleDate: r.saleDate,
            totalSales: Number(r.totalSales),
            settledSales: Number(r.settledSales),
            floatingSales: Number(r.floatingSales),
          })),
          byPayment: byPayment.rows.map((r) => ({
            methodName: r.methodName,
            paymentStatus: r.paymentStatus,
            totalAmount: Number(r.totalAmount),
            transactionCount: Number(r.transactionCount),
          })),
          byCategory: byCategory.rows.map((r) => ({
            category: r.category,
            totalAmount: Number(r.totalAmount),
            quantitySold: Number(r.quantitySold),
          })),
        },
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load dashboard' };
    }
  }

  async dailySales(orgId: number, from?: string, to?: string) {
    return this.dashboard(orgId, from, to);
  }

  async topProducts(orgId: number, from?: string, to?: string) {
    try {
      const params: unknown[] = [orgId];
      const dateClause = this.dateClause(params, from, to);

      const result = await this.db.query<{
        partName: string;
        variantName: string;
        category: string | null;
        quantitySold: string;
        totalAmount: string;
      }>(
        `SELECT p.name AS "partName",
                v.variant_name AS "variantName",
                p.category,
                COALESCE(SUM(st.quantity_sold), 0)::text AS "quantitySold",
                COALESCE(SUM(st.total_amount), 0)::text AS "totalAmount"
         FROM tblsales_transactions st
         INNER JOIN tblinventory_variants v ON v.id = st.variant_id
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE st.org_id = $1 ${dateClause}
         GROUP BY p.name, v.variant_name, p.category
         ORDER BY SUM(st.total_amount) DESC
         LIMIT 20`,
        params,
      );

      return {
        success: true,
        data: result.rows.map((r) => ({
          partName: `${r.partName} (${r.variantName})`,
          category: r.category,
          quantitySold: Number(r.quantitySold),
          totalAmount: Number(r.totalAmount),
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load top products report' };
    }
  }

  async salesByCategory(orgId: number, from?: string, to?: string) {
    try {
      const params: unknown[] = [orgId];
      const dateClause = this.dateClause(params, from, to);

      const result = await this.db.query<{
        category: string;
        quantitySold: string;
        totalAmount: string;
      }>(
        `SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized') AS category,
                COALESCE(SUM(st.quantity_sold), 0)::text AS "quantitySold",
                COALESCE(SUM(st.total_amount), 0)::text AS "totalAmount"
         FROM tblsales_transactions st
         INNER JOIN tblinventory_variants v ON v.id = st.variant_id
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE st.org_id = $1 ${dateClause}
         GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized')
         ORDER BY SUM(st.total_amount) DESC`,
        params,
      );

      return {
        success: true,
        data: result.rows.map((r) => ({
          category: r.category,
          quantitySold: Number(r.quantitySold),
          totalAmount: Number(r.totalAmount),
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load category sales report' };
    }
  }

  async inventoryValuation(orgId: number) {
    try {
      const result = await this.db.query<{
        category: string;
        itemCount: string;
        totalStock: string;
        retailValue: string;
      }>(
        `SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized') AS category,
                COUNT(v.id)::text AS "itemCount",
                COALESCE(SUM(v.stock_qty), 0)::text AS "totalStock",
                COALESCE(SUM(v.stock_qty * v.selling_price), 0)::text AS "retailValue"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.org_id = $1 AND v.is_active = TRUE AND p.is_active = TRUE
         GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized')
         ORDER BY SUM(v.stock_qty * v.selling_price) DESC`,
        [orgId],
      );

      return {
        success: true,
        data: result.rows.map((r) => ({
          category: r.category,
          itemCount: Number(r.itemCount),
          totalStock: Number(r.totalStock),
          retailValue: Number(r.retailValue),
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load inventory valuation' };
    }
  }

  async lowStock(orgId: number) {
    try {
      const result = await this.db.query<{
        partName: string;
        variantName: string;
        category: string | null;
        stockQty: number;
        stockWarning: number;
        sellingPrice: string;
      }>(
        `SELECT p.name AS "partName", v.variant_name AS "variantName", p.category,
                v.stock_qty AS "stockQty", v.stock_warning AS "stockWarning",
                v.selling_price AS "sellingPrice"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.org_id = $1 AND v.is_active = TRUE AND v.stock_qty <= v.stock_warning
         ORDER BY v.stock_qty ASC`,
        [orgId],
      );

      return {
        success: true,
        data: result.rows.map((r) => ({
          partName: `${r.partName} (${r.variantName})`,
          category: r.category,
          stockQty: r.stockQty,
          stockWarning: r.stockWarning,
          sellingPrice: Number(r.sellingPrice ?? 0),
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load low stock report' };
    }
  }

  async cashierSales(orgId: number, cashierId: number, from?: string, to?: string) {
    try {
      await this.ensureSalesVoidSchema();
      const params: unknown[] = [orgId, cashierId];
      let dateClause = this.dateClause(params, from, to);

      const summary = await this.db.query<{
        totalSales: string;
        transactionCount: string;
        totalDiscount: string;
      }>(
        `SELECT COALESCE(SUM(st.total_amount), 0)::text AS "totalSales",
                COUNT(*)::text AS "transactionCount",
                COALESCE(SUM(st.discount_amount), 0)::text AS "totalDiscount"
         FROM tblsales_transactions st
         WHERE st.org_id = $1 AND st.created_by = $2
           AND COALESCE(st.is_voided, FALSE) = FALSE
           ${dateClause}`,
        params,
      );

      const byDay = await this.db.query<{
        saleDate: string;
        totalSales: string;
        transactionCount: string;
      }>(
        `SELECT st.sale_date::text AS "saleDate",
                COALESCE(SUM(st.total_amount), 0)::text AS "totalSales",
                COUNT(*)::text AS "transactionCount"
         FROM tblsales_transactions st
         WHERE st.org_id = $1 AND st.created_by = $2
           AND COALESCE(st.is_voided, FALSE) = FALSE
           ${dateClause}
         GROUP BY st.sale_date
         ORDER BY st.sale_date DESC
         LIMIT 31`,
        params,
      );

      const recent = await this.db.query<{
        id: number;
        saleDate: string;
        totalAmount: string;
        paymentStatus: string;
      }>(
        `SELECT st.id,
                st.sale_date::text AS "saleDate",
                st.total_amount::text AS "totalAmount",
                COALESCE(st.payment_status, 'settled') AS "paymentStatus"
         FROM tblsales_transactions st
         WHERE st.org_id = $1 AND st.created_by = $2
           AND COALESCE(st.is_voided, FALSE) = FALSE
           ${dateClause}
         ORDER BY st.id DESC
         LIMIT 20`,
        params,
      );

      return {
        success: true,
        data: {
          summary: {
            totalSales: Number(summary.rows[0]?.totalSales ?? 0),
            transactionCount: Number(summary.rows[0]?.transactionCount ?? 0),
            totalDiscount: Number(summary.rows[0]?.totalDiscount ?? 0),
          },
          byDay: byDay.rows.map((r) => ({
            saleDate: r.saleDate,
            totalSales: Number(r.totalSales),
            transactionCount: Number(r.transactionCount),
          })),
          recent: recent.rows.map((r) => ({
            id: r.id,
            saleDate: r.saleDate,
            totalAmount: Number(r.totalAmount),
            paymentStatus: r.paymentStatus,
          })),
        },
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load cashier sales' };
    }
  }
}
