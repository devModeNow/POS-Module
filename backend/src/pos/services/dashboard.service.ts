import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

type Period = 'daily' | 'weekly' | 'monthly';

@Injectable()
export class PosDashboardService {
  constructor(private readonly db: DatabaseService) {}

  private dateFilter(period: Period, column: string): string {
    if (period === 'daily') {
      return `DATE(${column}) = (NOW() AT TIME ZONE 'Asia/Manila')::date`;
    }
    if (period === 'weekly') {
      return `${column} >= DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Manila')::date)`;
    }
    return `${column} >= DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Manila')::date)`;
  }

  async getMetrics(orgId: number, period: Period = 'daily') {
    try {
      const saleDateFilter = this.dateFilter(period, 'st.sale_date');

      const salesResult = await this.db.query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(st.total_amount), 0)::text AS total,
                COUNT(*)::text AS count
         FROM tblsales_transactions st
         WHERE st.org_id = $1 AND ${saleDateFilter}`,
        [orgId],
      );

      const inventoryResult = await this.db.query<{ total: string; lowStock: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE stock_qty <= stock_warning)::text AS "lowStock"
         FROM tblinventory WHERE org_id = $1`,
        [orgId],
      );

      const topProducts = await this.db.query<{
        inventoryId: number;
        partName: string;
        quantitySold: string;
        totalAmount: string;
      }>(
        `SELECT st.inventory_id AS "inventoryId",
                i.part_name AS "partName",
                COALESCE(SUM(st.quantity_sold), 0)::text AS "quantitySold",
                COALESCE(SUM(st.total_amount), 0)::text AS "totalAmount"
         FROM tblsales_transactions st
         INNER JOIN tblinventory i ON i.id = st.inventory_id
         WHERE st.org_id = $1 AND ${saleDateFilter}
         GROUP BY st.inventory_id, i.part_name
         ORDER BY SUM(st.total_amount) DESC
         LIMIT 5`,
        [orgId],
      );

      const recentSales = await this.db.query<{
        id: number;
        partName: string;
        quantitySold: number;
        totalAmount: number;
        saleDate: string;
        createdAt: string;
      }>(
        `SELECT st.id,
                i.part_name AS "partName",
                st.quantity_sold AS "quantitySold",
                st.total_amount AS "totalAmount",
                st.sale_date AS "saleDate",
                st.created_at AS "createdAt"
         FROM tblsales_transactions st
         INNER JOIN tblinventory i ON i.id = st.inventory_id
         WHERE st.org_id = $1
         ORDER BY st.created_at DESC
         LIMIT 10`,
        [orgId],
      );

      const lowStockItems = await this.db.query<{
        id: number;
        partName: string;
        stockQty: number;
        stockWarning: number;
      }>(
        `SELECT id, part_name AS "partName", stock_qty AS "stockQty", stock_warning AS "stockWarning"
         FROM tblinventory
         WHERE org_id = $1 AND stock_qty <= stock_warning
         ORDER BY stock_qty ASC
         LIMIT 8`,
        [orgId],
      );

      const totalSales = parseFloat(salesResult.rows[0]?.total ?? '0');
      const transactionCount = parseInt(salesResult.rows[0]?.count ?? '0', 10);

      return {
        success: true,
        data: {
          period,
          totalSales: parseFloat(totalSales.toFixed(2)),
          transactionCount,
          averageTicket:
            transactionCount > 0
              ? parseFloat((totalSales / transactionCount).toFixed(2))
              : 0,
          productCount: parseInt(inventoryResult.rows[0]?.total ?? '0', 10),
          lowStockCount: parseInt(inventoryResult.rows[0]?.lowStock ?? '0', 10),
          topProducts: topProducts.rows.map((row) => ({
            inventoryId: row.inventoryId,
            partName: row.partName,
            quantitySold: parseInt(row.quantitySold, 10),
            totalAmount: parseFloat(parseFloat(row.totalAmount).toFixed(2)),
          })),
          recentSales: recentSales.rows,
          lowStockItems: lowStockItems.rows,
        },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load POS dashboard metrics',
      };
    }
  }
}
