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
        ADD COLUMN IF NOT EXISTS void_reason TEXT,
        ADD COLUMN IF NOT EXISTS reference_number TEXT
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
    options?: { search?: string; sortBy?: string; sortDir?: string; cashierUserId?: number },
  ) {
    try {
      await this.ensureSalesVoidSchema();
      const params: unknown[] = [orgId];
      let dateClause = this.dateClause(params, from, to);
      let statusClause = '';
      if (paymentStatus === 'settled' || paymentStatus === 'floating') {
        params.push(paymentStatus);
        statusClause = ` AND st.payment_status = $${params.length}`;
      }

      let cashierClause = '';
      const cashierUserId = Number(options?.cashierUserId ?? 0);
      if (cashierUserId > 0) {
        params.push(cashierUserId);
        cashierClause = ` AND st.created_by = $${params.length}`;
      }

      let searchClause = '';
      const search = String(options?.search ?? '').trim();
      if (search) {
        params.push(`%${search}%`);
        const searchIdx = params.length;
        searchClause = ` AND (
             st.id::text ILIKE $${searchIdx}
             OR st.sale_date::text ILIKE $${searchIdx}
             OR st.total_amount::text ILIKE $${searchIdx}
             OR COALESCE(st.reference_number, '') ILIKE $${searchIdx}
             OR COALESCE(pm.name, '') ILIKE $${searchIdx}
             OR COALESCE(to_jsonb(u)->>'fullname', u.username, '') ILIKE $${searchIdx}
           )`;
      }

      const sortDir = String(options?.sortDir ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const sortByRaw = String(options?.sortBy ?? 'date').toLowerCase();
      const sortByMap: Record<string, string> = {
        date: 'st.created_at',
        saledate: 'st.created_at',
        cashier: `COALESCE(to_jsonb(u)->>'fullname', u.username, '')`,
        payment: `COALESCE(pm.name, 'Unknown')`,
        paymentmethod: `COALESCE(pm.name, 'Unknown')`,
        items: `(
                  SELECT COUNT(*)
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                )`,
        amount: `(
                  SELECT COALESCE(SUM(s2.total_amount), 0)
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                )`,
        total: `(
                  SELECT COALESCE(SUM(s2.total_amount), 0)
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                )`,
        status: `COALESCE(st.payment_status, 'settled')`,
        reference: `COALESCE(st.reference_number, '')`,
      };
      const orderExpr = sortByMap[sortByRaw] ?? 'st.created_at';

      const countParams = [...params];
      const countResult = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM tblsales_transactions st
         LEFT JOIN tblpayment_methods pm ON pm.id = st.payment_method_id
         LEFT JOIN tblusers u ON u.id = st.created_by
         WHERE st.org_id = $1
           AND st.amount_paid IS NOT NULL
           AND COALESCE(st.is_voided, FALSE) = FALSE
           ${dateClause} ${statusClause} ${cashierClause} ${searchClause}`,
        countParams,
      );

      params.push(limit, offset);

      const result = await this.db.query<{
        id: number;
        saleDate: string;
        totalAmount: string;
        amountPaid: string | null;
        changeAmount: string | null;
        paymentStatus: string;
        paymentMethod: string;
        referenceNumber: string | null;
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
                NULLIF(TRIM(COALESCE(st.reference_number, '')), '') AS "referenceNumber",
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
           ${dateClause} ${statusClause} ${cashierClause} ${searchClause}
         ORDER BY ${orderExpr} ${sortDir}, st.id DESC
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
          referenceNumber: row.referenceNumber,
          cashier: row.cashier,
          createdAt: row.createdAt,
          itemCount: Number(row.itemCount),
        })),
        total: Number(countResult.rows[0]?.count ?? 0),
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
      const anchor = await this.db.query<{
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
      const a = anchor.rows[0];
      if (!a) return { success: false, message: 'Transaction not found' };

      const paymentHeader = await this.db.query<{
        amountPaid: string | null;
        changeAmount: string | null;
        paymentStatus: string;
        discountAmount: string | null;
        paymentMethodId: number | null;
        referenceNumber: string | null;
      }>(
        `SELECT amount_paid::text AS "amountPaid",
                change_amount::text AS "changeAmount",
                COALESCE(payment_status, 'settled') AS "paymentStatus",
                discount_amount::text AS "discountAmount",
                payment_method_id AS "paymentMethodId",
                NULLIF(TRIM(COALESCE(reference_number, '')), '') AS "referenceNumber"
         FROM tblsales_transactions
         WHERE org_id = $1
           AND created_by IS NOT DISTINCT FROM $2
           AND sale_date = $3::date
           AND created_at >= $4::timestamptz - interval '5 seconds'
           AND created_at <= $4::timestamptz + interval '5 seconds'
           AND amount_paid IS NOT NULL
           AND COALESCE(is_voided, FALSE) = FALSE
         ORDER BY id ASC
         LIMIT 1`,
        [orgId, a.createdBy, a.saleDate, a.createdAt],
      );
      const pay = paymentHeader.rows[0];
      const amountPaid = pay?.amountPaid ?? a.amountPaid;
      const changeAmount = pay?.changeAmount ?? a.changeAmount;
      const paymentStatus = pay?.paymentStatus ?? a.paymentStatus;
      const discountAmount = pay?.discountAmount ?? a.discountAmount;
      const paymentMethodId = pay?.paymentMethodId ?? a.paymentMethodId;
      const referenceNumber = pay?.referenceNumber ?? null;

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
           AND st.created_at >= $4::timestamptz - interval '5 seconds'
           AND st.created_at <= $4::timestamptz + interval '5 seconds'
           AND COALESCE(st.is_voided, FALSE) = FALSE
         ORDER BY st.id ASC`,
        [orgId, a.createdBy, a.saleDate, a.createdAt],
      );

      const meta = await this.db.query<{
        cashier: string;
        paymentMethod: string;
      }>(
        `SELECT COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(u)->>'fullname', '')), ''), u.username, 'Unknown') AS cashier,
                COALESCE(pm.name, 'Cash') AS "paymentMethod"
         FROM (SELECT 1) AS _one
         LEFT JOIN tblusers u ON u.id = $1
         LEFT JOIN tblpayment_methods pm ON pm.id = $2`,
        [a.createdBy, paymentMethodId],
      );

      const totalAmount = lines.rows.reduce((sum, row) => sum + Number(row.totalAmount), 0);

      return {
        success: true,
        data: {
          id: a.id,
          saleDate: a.saleDate,
          createdAt: a.createdAt,
          cashier: meta.rows[0]?.cashier ?? 'Unknown',
          paymentMethod: meta.rows[0]?.paymentMethod ?? 'Unknown',
          paymentStatus,
          referenceNumber,
          amountPaid: amountPaid != null ? Number(amountPaid) : null,
          changeAmount: changeAmount != null ? Number(changeAmount) : null,
          discountAmount: discountAmount != null ? Number(discountAmount) : 0,
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

  async dashboard(
    orgId: number,
    from?: string,
    to?: string,
    paymentStatus?: string,
    cashierUserId?: number,
  ) {
    try {
      const params: unknown[] = [orgId];
      let dateClause = this.dateClause(params, from, to);
      let statusClause = '';
      if (paymentStatus === 'settled' || paymentStatus === 'floating') {
        params.push(paymentStatus);
        statusClause = ` AND st.payment_status = $${params.length}`;
      }
      let cashierClause = '';
      const cashierId = Number(cashierUserId ?? 0);
      if (cashierId > 0) {
        params.push(cashierId);
        cashierClause = ` AND st.created_by = $${params.length}`;
      }

      const summary = await this.db.query<{
        totalSales: string;
        settledSales: string;
        floatingSales: string;
        transactionCount: string;
        totalDiscount: string;
        retailSales: string;
        wholesaleSales: string;
      }>(
        `SELECT COALESCE(SUM(st.total_amount), 0)::text AS "totalSales",
                COALESCE(SUM(st.total_amount) FILTER (WHERE st.payment_status = 'settled'), 0)::text AS "settledSales",
                COALESCE(SUM(st.total_amount) FILTER (WHERE st.payment_status = 'floating'), 0)::text AS "floatingSales",
                COUNT(*)::text AS "transactionCount",
                COALESCE(SUM(st.discount_amount), 0)::text AS "totalDiscount",
                COALESCE(SUM(st.total_amount) FILTER (
                  WHERE COALESCE(vu.product_source, v.product_source, 'Retail') = 'Retail'
                ), 0)::text AS "retailSales",
                COALESCE(SUM(st.total_amount) FILTER (
                  WHERE COALESCE(vu.product_source, v.product_source, 'Retail') = 'Wholesale'
                ), 0)::text AS "wholesaleSales"
         FROM tblsales_transactions st
         LEFT JOIN tblinventory_variants v ON v.id = st.variant_id
         LEFT JOIN tblinventory_variant_units vu
           ON vu.variant_id = st.variant_id
          AND vu.org_id = st.org_id
          AND vu.is_active = TRUE
          AND lower(vu.unit_type) = lower(COALESCE(st.unit_type, v.unit_type, 'piece'))
         WHERE st.org_id = $1 ${dateClause} ${statusClause} ${cashierClause}`,
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
         WHERE st.org_id = $1 ${dateClause} ${statusClause} ${cashierClause}
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
         WHERE st.org_id = $1 ${dateClause} ${statusClause} ${cashierClause}
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
         LEFT JOIN tblinventory_variants v ON v.id = st.variant_id
         LEFT JOIN tblinventory_products p ON p.id = v.product_id
         WHERE st.org_id = $1 ${dateClause} ${statusClause} ${cashierClause}
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
            retailSales: Number(summary.rows[0]?.retailSales ?? 0),
            wholesaleSales: Number(summary.rows[0]?.wholesaleSales ?? 0),
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

  async customChart(
    orgId: number,
    groupByRaw?: string,
    metricRaw?: string,
    from?: string,
    to?: string,
  ) {
    try {
      const groupBy = String(groupByRaw ?? 'category').trim().toLowerCase();
      const metric = String(metricRaw ?? 'total_amount').trim().toLowerCase();

      const groupMap: Record<string, { select: string; group: string; needsProductJoin: boolean }> = {
        day: {
          select: `st.sale_date::text`,
          group: `st.sale_date`,
          needsProductJoin: false,
        },
        cashier: {
          select: `COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(u)->>'fullname', '')), ''), u.username, 'Unknown')`,
          group: `COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(u)->>'fullname', '')), ''), u.username, 'Unknown')`,
          needsProductJoin: false,
        },
        payment_method: {
          select: `COALESCE(pm.name, 'Unknown')`,
          group: `COALESCE(pm.name, 'Unknown')`,
          needsProductJoin: false,
        },
        payment_status: {
          select: `CASE WHEN st.payment_status = 'floating' THEN 'Floating' ELSE 'Settled' END`,
          group: `CASE WHEN st.payment_status = 'floating' THEN 'Floating' ELSE 'Settled' END`,
          needsProductJoin: false,
        },
        category: {
          select: `COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized')`,
          group: `COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized')`,
          needsProductJoin: true,
        },
        product: {
          select: `COALESCE(NULLIF(TRIM(p.name), ''), 'Unknown product')`,
          group: `COALESCE(NULLIF(TRIM(p.name), ''), 'Unknown product')`,
          needsProductJoin: true,
        },
        brand: {
          select: `COALESCE(NULLIF(TRIM(p.brand), ''), 'Unbranded')`,
          group: `COALESCE(NULLIF(TRIM(p.brand), ''), 'Unbranded')`,
          needsProductJoin: true,
        },
        unit_type: {
          select: `COALESCE(NULLIF(TRIM(st.unit_type), ''), 'pc')`,
          group: `COALESCE(NULLIF(TRIM(st.unit_type), ''), 'pc')`,
          needsProductJoin: false,
        },
      };

      const metricMap: Record<string, string> = {
        total_amount: `COALESCE(SUM(st.total_amount), 0)`,
        quantity_sold: `COALESCE(SUM(st.quantity_sold), 0)`,
        transaction_count: `COUNT(*)`,
        discount_amount: `COALESCE(SUM(st.discount_amount), 0)`,
      };

      const group = groupMap[groupBy] ?? groupMap['category'];
      const metricExpr = metricMap[metric] ?? metricMap['total_amount'];
      const resolvedGroupBy = groupMap[groupBy] ? groupBy : 'category';
      const resolvedMetric = metricMap[metric] ? metric : 'total_amount';

      const params: unknown[] = [orgId];
      const dateClause = this.dateClause(params, from, to);

      const joins: string[] = [
        `LEFT JOIN tblusers u ON u.id = st.created_by`,
        `LEFT JOIN tblpayment_methods pm ON pm.id = st.payment_method_id`,
      ];
      if (group.needsProductJoin) {
        joins.push(
          `LEFT JOIN tblinventory_variants v ON v.id = st.variant_id`,
          `LEFT JOIN tblinventory_products p ON p.id = v.product_id`,
        );
      }

      const result = await this.db.query<{ label: string; value: string }>(
        `SELECT ${group.select} AS label,
                ${metricExpr}::text AS value
         FROM tblsales_transactions st
         ${joins.join('\n         ')}
         WHERE st.org_id = $1
           AND COALESCE(st.is_voided, false) = false
           ${dateClause}
         GROUP BY ${group.group}
         ORDER BY ${metricExpr} DESC
         LIMIT 30`,
        params,
      );

      return {
        success: true,
        data: {
          groupBy: resolvedGroupBy,
          metric: resolvedMetric,
          labels: result.rows.map((r) => String(r.label ?? 'Unknown')),
          values: result.rows.map((r) => Number(r.value ?? 0)),
        },
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load custom chart' };
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

  async salesBySource(orgId: number, from?: string, to?: string) {
    try {
      const params: unknown[] = [orgId];
      const dateClause = this.dateClause(params, from, to);

      const result = await this.db.query<{
        productSource: string;
        quantitySold: string;
        totalAmount: string;
        transactionCount: string;
      }>(
        `SELECT COALESCE(vu.product_source, v.product_source, 'Retail') AS "productSource",
                COALESCE(SUM(st.quantity_sold), 0)::text AS "quantitySold",
                COALESCE(SUM(st.total_amount), 0)::text AS "totalAmount",
                COUNT(*)::text AS "transactionCount"
         FROM tblsales_transactions st
         LEFT JOIN tblinventory_variants v ON v.id = st.variant_id
         LEFT JOIN tblinventory_variant_units vu
           ON vu.variant_id = st.variant_id
          AND vu.org_id = st.org_id
          AND vu.is_active = TRUE
          AND lower(vu.unit_type) = lower(COALESCE(st.unit_type, v.unit_type, 'piece'))
         WHERE st.org_id = $1 ${dateClause}
         GROUP BY COALESCE(vu.product_source, v.product_source, 'Retail')
         ORDER BY SUM(st.total_amount) DESC`,
        params,
      );

      return {
        success: true,
        data: result.rows.map((r) => ({
          productSource: r.productSource === 'Wholesale' ? 'Wholesale' : 'Retail',
          quantitySold: Number(r.quantitySold),
          totalAmount: Number(r.totalAmount),
          transactionCount: Number(r.transactionCount),
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load retail/wholesale sales report' };
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

  async productLogs(orgId: number) {
    try {
      const result = await this.db.query<{
        id: number;
        productName: string;
        category: string | null;
        brand: string | null;
        createdAt: string;
        updatedAt: string;
      }>(
        `SELECT p.id,
                p.name AS "productName",
                p.category,
                p.brand,
                p.created_at AS "createdAt",
                p.updated_at AS "updatedAt"
         FROM tblinventory_products p
         WHERE p.org_id = $1
           AND p.is_active = TRUE
         ORDER BY p.updated_at DESC, p.created_at DESC, p.name ASC`,
        [orgId],
      );

      return {
        success: true,
        data: result.rows.map((row) => ({
          id: row.id,
          productName: row.productName,
          category: row.category,
          brand: row.brand,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load product logs report' };
    }
  }

  async cashierSales(
    orgId: number,
    cashierId: number,
    from?: string,
    to?: string,
    options?: {
      status?: string;
      search?: string;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortDir?: string;
    },
  ) {
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
                COUNT(*) FILTER (WHERE st.amount_paid IS NOT NULL)::text AS "transactionCount",
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
                COUNT(*) FILTER (WHERE st.amount_paid IS NOT NULL)::text AS "transactionCount"
         FROM tblsales_transactions st
         WHERE st.org_id = $1 AND st.created_by = $2
           AND COALESCE(st.is_voided, FALSE) = FALSE
           ${dateClause}
         GROUP BY st.sale_date
         ORDER BY st.sale_date DESC
         LIMIT 31`,
        params,
      );

      const byPayment = await this.db.query<{
        methodName: string;
        methodCode: string;
        totalAmount: string;
        transactionCount: string;
      }>(
        `SELECT COALESCE(pm.name, 'Cash') AS "methodName",
                COALESCE(pm.code, 'cash') AS "methodCode",
                COALESCE(SUM(batch.total), 0)::text AS "totalAmount",
                COUNT(*)::text AS "transactionCount"
         FROM tblsales_transactions st
         LEFT JOIN tblpayment_methods pm ON pm.id = st.payment_method_id
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(s2.total_amount), 0) AS total
           FROM tblsales_transactions s2
           WHERE s2.org_id = st.org_id
             AND s2.created_by = st.created_by
             AND s2.sale_date = st.sale_date
             AND s2.created_at >= st.created_at - interval '10 seconds'
             AND s2.created_at <= st.created_at + interval '10 seconds'
             AND COALESCE(s2.is_voided, FALSE) = FALSE
         ) batch
         WHERE st.org_id = $1 AND st.created_by = $2
           AND st.amount_paid IS NOT NULL
           AND COALESCE(st.is_voided, FALSE) = FALSE
           ${dateClause}
         GROUP BY pm.name, pm.code
         ORDER BY SUM(batch.total) DESC`,
        params,
      );

      const tableParams = [...params];
      let tableClause = `st.org_id = $1 AND st.created_by = $2
           AND st.amount_paid IS NOT NULL
           AND COALESCE(st.is_voided, FALSE) = FALSE
           ${dateClause}`;

      const status = String(options?.status ?? '').trim().toLowerCase();
      if (status === 'settled' || status === 'floating') {
        tableParams.push(status);
        tableClause += ` AND COALESCE(st.payment_status, 'settled') = $${tableParams.length}`;
      }

      const search = String(options?.search ?? '').trim();
      if (search) {
        tableParams.push(`%${search}%`);
        const searchIdx = tableParams.length;
        tableClause += ` AND (
             st.id::text ILIKE $${searchIdx}
             OR st.sale_date::text ILIKE $${searchIdx}
             OR st.total_amount::text ILIKE $${searchIdx}
             OR COALESCE(st.reference_number, '') ILIKE $${searchIdx}
             OR EXISTS (
               SELECT 1 FROM tblpayment_methods pm_s
               WHERE pm_s.id = st.payment_method_id
                 AND pm_s.name ILIKE $${searchIdx}
             )
           )`;
      }

      const pageSize = Math.min(100, Math.max(5, Number(options?.pageSize) || 10));
      const page = Math.max(1, Number(options?.page) || 1);
      const offset = (page - 1) * pageSize;

      const sortDir = String(options?.sortDir ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const sortByRaw = String(options?.sortBy ?? 'date').toLowerCase();
      const sortByMap: Record<string, string> = {
        id: 'st.id',
        date: 'st.created_at',
        saledate: 'st.created_at',
        amount: `(
                  SELECT COALESCE(SUM(s2.total_amount), 0)
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                )`,
        totalamount: `(
                  SELECT COALESCE(SUM(s2.total_amount), 0)
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                )`,
        status: `COALESCE(st.payment_status, 'settled')`,
        paymentstatus: `COALESCE(st.payment_status, 'settled')`,
        payment: `COALESCE(pm.name, 'Cash')`,
        paymentmethod: `COALESCE(pm.name, 'Cash')`,
        reference: `COALESCE(st.reference_number, '')`,
        referencenumber: `COALESCE(st.reference_number, '')`,
      };
      const orderExpr = sortByMap[sortByRaw] ?? 'st.created_at';

      const countResult = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM tblsales_transactions st
         WHERE ${tableClause}`,
        tableParams,
      );

      const recentParams = [...tableParams, pageSize, offset];
      const recent = await this.db.query<{
        id: number;
        saleDate: string;
        totalAmount: string;
        paymentStatus: string;
        paymentMethod: string;
        referenceNumber: string | null;
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
                COALESCE(st.payment_status, 'settled') AS "paymentStatus",
                COALESCE(pm.name, 'Cash') AS "paymentMethod",
                NULLIF(TRIM(COALESCE(st.reference_number, '')), '') AS "referenceNumber"
         FROM tblsales_transactions st
         LEFT JOIN tblpayment_methods pm ON pm.id = st.payment_method_id
         WHERE ${tableClause}
         ORDER BY ${orderExpr} ${sortDir}, st.id DESC
         LIMIT $${recentParams.length - 1} OFFSET $${recentParams.length}`,
        recentParams,
      );

      const recentTotal = Number(countResult.rows[0]?.count ?? 0);

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
          byPayment: byPayment.rows.map((r) => ({
            methodName: r.methodName,
            methodCode: r.methodCode,
            totalAmount: Number(r.totalAmount),
            transactionCount: Number(r.transactionCount),
          })),
          recent: recent.rows.map((r) => ({
            id: r.id,
            saleDate: r.saleDate,
            totalAmount: Number(r.totalAmount),
            paymentStatus: r.paymentStatus,
            paymentMethod: r.paymentMethod,
            referenceNumber: r.referenceNumber,
          })),
          recentTotal,
          page,
          pageSize,
          sortBy: sortByRaw,
          sortDir: sortDir.toLowerCase(),
        },
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load cashier sales' };
    }
  }

  async listCompletedSales(
    orgId: number,
    from?: string,
    to?: string,
    limit = 100,
    offset = 0,
    cashierUserId?: number,
  ) {
    try {
      const params: unknown[] = [orgId];
      let dateClause = '';
      if (from) {
        params.push(from);
        dateClause += ` AND n.created_at::date >= $${params.length}::date`;
      }
      if (to) {
        params.push(to);
        dateClause += ` AND n.created_at::date <= $${params.length}::date`;
      }
      let cashierClause = '';
      const cashierId = Number(cashierUserId ?? 0);
      if (cashierId > 0) {
        params.push(cashierId);
        cashierClause = ` AND st.created_by = $${params.length}`;
      }
      const countParams = [...params];
      params.push(limit, offset);

      const countResult = await this.db.query<{ count: string }>(
        `WITH completed AS (
           SELECT DISTINCT ON (n.reference_id) n.reference_id AS sale_id
           FROM tblpos_notifications n
           WHERE n.org_id = $1
             AND n.type = 'sale'
             AND COALESCE(n.reference_type, 'sale') = 'sale'
             AND n.reference_id IS NOT NULL
             ${dateClause}
           ORDER BY n.reference_id, n.created_at ASC
         )
         SELECT COUNT(*)::text AS count
         FROM completed c
         LEFT JOIN tblsales_transactions st ON st.id = c.sale_id AND st.org_id = $1
         WHERE (st.id IS NULL OR COALESCE(st.is_voided, FALSE) = FALSE)
           ${cashierClause}`,
        countParams,
      );

      const result = await this.db.query<{
        saleId: number;
        title: string;
        body: string;
        completedAt: string;
        saleDate: string | null;
        cashier: string;
        paymentMethod: string;
        referenceNumber: string | null;
        paymentStatus: string;
        totalAmount: string;
        itemCount: string;
      }>(
        `WITH completed AS (
           SELECT DISTINCT ON (n.reference_id)
                  n.reference_id AS sale_id,
                  n.title,
                  n.body,
                  n.created_at
           FROM tblpos_notifications n
           WHERE n.org_id = $1
             AND n.type = 'sale'
             AND COALESCE(n.reference_type, 'sale') = 'sale'
             AND n.reference_id IS NOT NULL
             ${dateClause}
           ORDER BY n.reference_id, n.created_at ASC
         )
         SELECT c.sale_id AS "saleId",
                c.title,
                c.body,
                c.created_at AS "completedAt",
                st.sale_date::text AS "saleDate",
                COALESCE(
                  NULLIF(TRIM(COALESCE(
                    to_jsonb(u)->>'fullname',
                    to_jsonb(u)->>'fullName',
                    to_jsonb(u)->>'full_name'
                  )), ''),
                  u.username,
                  'Cashier'
                ) AS cashier,
                COALESCE(pm.name, 'Unknown') AS "paymentMethod",
                NULLIF(TRIM(COALESCE(st.reference_number, '')), '') AS "referenceNumber",
                COALESCE(st.payment_status, 'settled') AS "paymentStatus",
                COALESCE((
                  SELECT SUM(s2.total_amount)
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                ), st.total_amount, 0)::text AS "totalAmount",
                COALESCE((
                  SELECT COUNT(*)
                  FROM tblsales_transactions s2
                  WHERE s2.org_id = st.org_id
                    AND s2.created_by = st.created_by
                    AND s2.sale_date = st.sale_date
                    AND s2.created_at >= st.created_at - interval '10 seconds'
                    AND s2.created_at <= st.created_at + interval '10 seconds'
                    AND COALESCE(s2.is_voided, FALSE) = FALSE
                ), 1)::text AS "itemCount"
         FROM completed c
         LEFT JOIN tblsales_transactions st ON st.id = c.sale_id AND st.org_id = $1
         LEFT JOIN tblusers u ON u.id = st.created_by
         LEFT JOIN tblpayment_methods pm ON pm.id = st.payment_method_id
         WHERE (st.id IS NULL OR COALESCE(st.is_voided, FALSE) = FALSE)
           ${cashierClause}
         ORDER BY c.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      return {
        success: true,
        data: result.rows.map((row) => ({
          saleId: row.saleId,
          title: row.title,
          body: row.body,
          completedAt: row.completedAt,
          saleDate: row.saleDate,
          cashier: row.cashier,
          paymentMethod: row.paymentMethod,
          referenceNumber: row.referenceNumber,
          paymentStatus: row.paymentStatus,
          totalAmount: Number(row.totalAmount),
          itemCount: Number(row.itemCount),
        })),
        total: Number(countResult.rows[0]?.count ?? 0),
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load completed sales',
      };
    }
  }
}
