import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  async getSalesReport(orgId: number, from: string, to: string) {
    try {
      const result = await this.db.query(
        `SELECT
           DATE(p.payment_date) AS date,
           p.mode,
           COUNT(*)::int AS "transactionCount",
           SUM(p.amount) AS "totalAmount"
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         WHERE p.org_id = $1
           AND p.payment_date::date BETWEEN $2::date AND $3::date
         GROUP BY DATE(p.payment_date), p.mode
         ORDER BY date DESC, p.mode ASC`,
        [orgId, from, to]);

      const summary = await this.db.query(
        `SELECT
           COUNT(DISTINCT p.id)::int AS "totalTransactions",
           SUM(p.amount) AS "totalAmount",
           COUNT(DISTINCT p.job_order_id)::int AS "totalJobOrders"
         FROM tbljo_payments p
         WHERE p.org_id = $1
           AND p.payment_date::date BETWEEN $2::date AND $3::date`,
        [orgId, from, to]);

      return { success: true, data: result.rows, summary: summary.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to generate sales report' };
    }
  }

  async getJobsReport(orgId: number, from: string, to: string) {
    try {
      const result = await this.db.query(
        `SELECT jo.id, jo.jo_number AS "joNumber", jo.status,
                jo.total_amount AS "totalAmount", jo.labor_fee AS "laborFee",
                jo.discount, jo.created_at AS "createdAt", jo.completed_at AS "completedAt",
                v.plate_number AS "plateNumber", v.make, v.model,
                c.name AS "customerName",
                t.name AS "mechanicName"
         FROM tbljoborders jo
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         LEFT JOIN tbltechnicians t ON t.id = jo.technician_id
         WHERE jo.org_id = $1
           AND jo.status = 'released'
           AND jo.completed_at::date BETWEEN $2::date AND $3::date
         ORDER BY jo.completed_at DESC`,
        [orgId, from, to]);

      const summary = await this.db.query(
        `SELECT
           COUNT(*)::int AS "totalJobs",
           SUM(jo.total_amount) AS "totalRevenue",
           SUM(jo.labor_fee) AS "totalLaborFee"
         FROM tbljoborders jo
         WHERE jo.org_id = $1
           AND jo.status = 'released'
           AND jo.completed_at::date BETWEEN $2::date AND $3::date`,
        [orgId, from, to]);

      return { success: true, data: result.rows, summary: summary.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to generate jobs report' };
    }
  }

  async getInventoryReport(orgId: number, category?: string, brand?: string) {
    try {
      const conditions = [`i.org_id = $1`];
      const params: unknown[] = [orgId];
      if (category) { params.push(category); conditions.push(`i.category = $${params.length}`); }
      if (brand)    { params.push(brand);    conditions.push(`i.brand = $${params.length}`); }

      const result = await this.db.query(
        `SELECT i.id, i.part_name AS "partName", i.category, i.brand,
                i.stock_qty AS "stockQty", i.stock_warning AS "stockWarning",
                i.cost_price AS "costPrice", i.selling_price AS "sellingPrice",
                (i.stock_qty * i.cost_price) AS "stockValue"
         FROM tblinventory i
         WHERE ${conditions.join(' AND ')}
         ORDER BY i.category ASC, i.part_name ASC`, params);

      const summary = await this.db.query(
        `SELECT
           COUNT(*)::int AS "totalItems",
           SUM(i.stock_qty)::int AS "totalUnits",
           SUM(i.stock_qty * i.cost_price) AS "totalValue",
           COUNT(*) FILTER (WHERE i.stock_qty <= i.stock_warning)::int AS "lowStockCount"
         FROM tblinventory i
         WHERE ${conditions.join(' AND ')}`, params);

      return { success: true, data: result.rows, summary: summary.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to generate inventory report' };
    }
  }

  async getPayablesReceivablesReport(orgId: number, from: string, to: string) {
    try {
      const result = await this.db.query(
        `SELECT
           p.payment_date AS "date",
           jo.jo_number AS "joNumber",
           c.name AS "customerName",
           p.mode AS "paymentMethod",
           p.reference_no AS "dueDatePdc",
           p.amount
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         WHERE jo.org_id = $1
           AND p.mode IN ('po_payment', 'cheque')
           AND p.payment_date::date BETWEEN $2::date AND $3::date
         ORDER BY p.payment_date DESC, jo.jo_number ASC`,
        [orgId, from, to]);

      const summary = await this.db.query(
        `SELECT
           COUNT(*)::int AS "totalTransactions",
           COALESCE(SUM(p.amount), 0) AS "totalAmount",
           COUNT(DISTINCT jo.id)::int AS "totalJobOrders",
           COALESCE(SUM(CASE WHEN p.mode = 'po_payment' THEN p.amount ELSE 0 END), 0) AS "totalPoPayments",
           COALESCE(SUM(CASE WHEN p.mode = 'cheque' THEN p.amount ELSE 0 END), 0) AS "totalChequePayments"
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         WHERE jo.org_id = $1
           AND p.mode IN ('po_payment', 'cheque')
           AND p.payment_date::date BETWEEN $2::date AND $3::date`,
        [orgId, from, to]);

      return { success: true, data: result.rows, summary: summary.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to generate payables/receivables report' };
    }
  }

  async getLowStockReport(orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT i.id, i.part_name AS "partName", i.category, i.brand,
                i.stock_qty AS "stockQty", i.stock_warning AS "stockWarning",
                i.selling_price AS "sellingPrice"
         FROM tblinventory i
         WHERE i.org_id = $1 AND i.stock_qty <= i.stock_warning
         ORDER BY i.stock_qty ASC, i.part_name ASC`, [orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to generate low stock report' };
    }
  }
}
