import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class PosStoreReportsService {
  constructor(private readonly db: DatabaseService) {}

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
}
