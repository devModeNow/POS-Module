import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { createHash } from 'crypto';

@Injectable()
export class FinanceService {
  constructor(private readonly db: DatabaseService) {}

  // ─── Expenses ────────────────────────────────────────────────────────────────

  async getExpenses(orgId: number, from?: string, to?: string) {
    try {
      let dateFilter = '';
      const params: unknown[] = [orgId];
      if (from && to) {
        params.push(from, to);
        dateFilter = `AND COALESCE(expense_date, created_at::date) BETWEEN $2::date AND $3::date`;
      }
      const result = await this.db.query(
        `SELECT id, description, amount, category,
                expense_date AS "expenseDate",
                created_at AS "createdAt"
         FROM tblorg_expenses
         WHERE org_id = $1 AND deleted_at IS NULL ${dateFilter}
         ORDER BY COALESCE(expense_date, created_at::date) DESC, created_at DESC`,
        params,
      );
      const summary = await this.db.query(
        `SELECT COUNT(*)::int AS "totalCount",
                COALESCE(SUM(amount), 0) AS "totalAmount"
         FROM tblorg_expenses
         WHERE org_id = $1 AND deleted_at IS NULL ${dateFilter}`,
        params,
      );
      return { success: true, data: result.rows, summary: summary.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load expenses' };
    }
  }

  async createExpense(orgId: number, userId: number, dto: { description: string; amount: number; category?: string; expenseDate?: string }) {
    if (!dto.description?.trim()) return { success: false, message: 'Description is required' };
    if (!dto.amount || dto.amount <= 0) return { success: false, message: 'Amount must be greater than 0' };
    try {
      const expDate = dto.expenseDate || new Date().toISOString().slice(0, 10);
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblorg_expenses (org_id, description, amount, category, created_by, expense_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, dto.description.trim(), dto.amount, dto.category ?? null, userId, expDate],
      );
      return { success: true, id: result.rows[0].id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to add expense' };
    }
  }

  async softDeleteExpense(orgId: number, userId: number, id: number, dto: { reason: string; password: string }) {
    if (!dto.reason?.trim()) return { success: false, message: 'Reason is required' };
    if (!dto.password) return { success: false, message: 'Password is required' };

    // Verify password
    const passwordSha1 = createHash('sha1').update(dto.password).digest('hex');
    try {
      const pwCheck = await this.db.query<{ id: number }>(
        `SELECT id FROM tblusers WHERE id = $1 AND password = $2 LIMIT 1`,
        [userId, passwordSha1],
      );
      if (pwCheck.rowCount === 0) return { success: false, message: 'Invalid password' };

      await this.db.query(
        `UPDATE tblorg_expenses
         SET deleted_at = NOW(), deleted_reason = $3, deleted_by = $4
         WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [id, orgId, dto.reason.trim(), userId],
      );
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to delete expense' };
    }
  }

  // ─── Deposits ────────────────────────────────────────────────────────────────

  async getDeposits(orgId: number, from?: string, to?: string) {
    try {
      let dateFilter = '';
      const params: unknown[] = [orgId];
      if (from && to) {
        params.push(from, to);
        dateFilter = `AND created_at::date BETWEEN $2::date AND $3::date`;
      }
      const result = await this.db.query(
        `SELECT id, description, amount, source, created_at AS "createdAt"
         FROM tblorg_deposits
         WHERE org_id = $1 ${dateFilter}
         ORDER BY created_at DESC`,
        params,
      );
      const summary = await this.db.query(
        `SELECT COUNT(*)::int AS "totalCount",
                COALESCE(SUM(amount), 0) AS "totalAmount"
         FROM tblorg_deposits
         WHERE org_id = $1 ${dateFilter}`,
        params,
      );
      return { success: true, data: result.rows, summary: summary.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load deposits' };
    }
  }

  async createDeposit(orgId: number, userId: number, dto: { description: string; amount: number; source?: string }) {
    if (!dto.description?.trim()) return { success: false, message: 'Description is required' };
    if (!dto.amount || dto.amount <= 0) return { success: false, message: 'Amount must be greater than 0' };
    try {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblorg_deposits (org_id, description, amount, source, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, dto.description.trim(), dto.amount, dto.source ?? null, userId],
      );
      return { success: true, id: result.rows[0].id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to add deposit' };
    }
  }

  async deleteDeposit(orgId: number, id: number) {
    try {
      await this.db.query(`DELETE FROM tblorg_deposits WHERE id = $1 AND org_id = $2`, [id, orgId]);
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to delete deposit' };
    }
  }

  // ─── Receivables (PO Payment & Cheque) ───────────────────────────────────────

  async getReceivables(orgId: number, from?: string, to?: string) {
    try {
      let dateFilter = '';
      const params: unknown[] = [orgId];
      if (from && to) {
        params.push(from, to);
        dateFilter = `AND p.payment_date::date BETWEEN $2::date AND $3::date`;
      }
      const result = await this.db.query(
        `SELECT p.id, p.payment_date AS "paymentDate",
                jo.jo_number AS "joNumber", jo.id AS "jobOrderId",
                c.name AS "customerName", c.id AS "customerId",
                p.mode AS "paymentMethod",
                p.reference_no AS "referenceNo",
                p.amount, p.notes,
                CASE WHEN p.settlement_mode IS NOT NULL THEN 'settled' ELSE 'pending' END AS status,
                p.settlement_mode AS "settlementMode",
                p.settlement_date AS "settlementDate",
                p.settlement_reference AS "settlementReference"
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         WHERE jo.org_id = $1
           AND p.mode IN ('po_payment', 'cheque')
           ${dateFilter}
         ORDER BY p.payment_date DESC, jo.jo_number ASC`,
        params,
      );
      const summary = await this.db.query(
        `SELECT COUNT(*)::int AS "totalCount",
                COALESCE(SUM(p.amount), 0) AS "totalAmount",
                COUNT(DISTINCT jo.id)::int AS "totalJobOrders",
                COALESCE(SUM(CASE WHEN p.mode = 'po_payment' THEN p.amount ELSE 0 END), 0) AS "totalPoPayments",
                COALESCE(SUM(CASE WHEN p.mode = 'cheque' THEN p.amount ELSE 0 END), 0) AS "totalChequePayments",
                COUNT(*) FILTER (WHERE p.settlement_mode IS NULL)::int AS "pendingCount",
                COUNT(*) FILTER (WHERE p.settlement_mode IS NOT NULL)::int AS "settledCount"
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         WHERE jo.org_id = $1
           AND p.mode IN ('po_payment', 'cheque')
           ${dateFilter}`,
        params,
      );
      return { success: true, data: result.rows, summary: summary.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load receivables' };
    }
  }

  async settleReceivable(orgId: number, userId: number, paymentId: number, dto: { settlementMode: string; settlementDate: string; settlementReference?: string }) {
    if (!dto.settlementMode) return { success: false, message: 'Settlement mode is required' };
    if (!dto.settlementDate) return { success: false, message: 'Settlement date is required' };
    try {
      // Verify the payment belongs to this org
      const check = await this.db.query(
        `SELECT p.id FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         WHERE p.id = $1 AND jo.org_id = $2 AND p.mode IN ('po_payment', 'cheque')`,
        [paymentId, orgId],
      );
      if (check.rowCount === 0) return { success: false, message: 'Payment not found' };

      await this.db.query(
        `UPDATE tbljo_payments
         SET settlement_mode = $2, settlement_date = $3, settlement_reference = $4, settlement_by = $5
         WHERE id = $1`,
        [paymentId, dto.settlementMode, dto.settlementDate, dto.settlementReference ?? null, userId],
      );
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to settle receivable' };
    }
  }

  // ─── Calendar Events ─────────────────────────────────────────────────────────

  async getCalendarEvents(orgId: number, from: string, to: string) {
    try {
      const expenses = await this.db.query(
        `SELECT id, 'expense' AS type, description AS title, amount,
                COALESCE(expense_date, created_at::date)::text AS date, category
         FROM tblorg_expenses WHERE org_id = $1 AND deleted_at IS NULL
           AND COALESCE(expense_date, created_at::date) BETWEEN $2::date AND $3::date`,
        [orgId, from, to],
      );
      const deposits = await this.db.query(
        `SELECT id, 'deposit' AS type, description AS title, amount,
                created_at::date::text AS date, source AS category
         FROM tblorg_deposits WHERE org_id = $1
           AND created_at::date BETWEEN $2::date AND $3::date`,
        [orgId, from, to],
      );
      const receivables = await this.db.query(
        `SELECT p.id, 'receivable' AS type,
                c.name || ' - ' || jo.jo_number AS title,
                p.amount, p.payment_date::text AS date, p.mode AS category
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         WHERE jo.org_id = $1
           AND p.mode IN ('po_payment', 'cheque')
           AND p.payment_date::date BETWEEN $2::date AND $3::date`,
        [orgId, from, to],
      );
      const events = [...expenses.rows, ...deposits.rows, ...receivables.rows];
      return { success: true, data: events };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load calendar events' };
    }
  }

  // ─── Customer SOA ────────────────────────────────────────────────────────────

  async getCustomersWithReceivables(orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT c.id, c.name, c.contact, c.email,
                COUNT(p.id)::int AS "transactionCount",
                COALESCE(SUM(p.amount), 0) AS "totalReceivable",
                COALESCE(SUM(CASE WHEN p.settlement_mode IS NOT NULL THEN p.amount ELSE 0 END), 0) AS "settledAmount",
                COALESCE(SUM(CASE WHEN p.settlement_mode IS NULL THEN p.amount ELSE 0 END), 0) AS "currentBalance"
         FROM tblcustomers c
         INNER JOIN tblvehicles v ON v.customer_id = c.id
         INNER JOIN tbljoborders jo ON jo.vehicle_id = v.id
         INNER JOIN tbljo_payments p ON p.job_order_id = jo.id
         WHERE c.org_id = $1 AND p.mode IN ('po_payment', 'cheque')
         GROUP BY c.id
         HAVING COUNT(p.id) > 0
         ORDER BY COALESCE(SUM(CASE WHEN p.settlement_mode IS NULL THEN p.amount ELSE 0 END), 0) DESC`,
        [orgId],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load customers with receivables' };
    }
  }

  async getCustomerSOA(orgId: number, customerId: number) {
    try {
      const customer = await this.db.query(
        `SELECT id, name, contact, email, address
         FROM tblcustomers WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [customerId, orgId],
      );
      if (customer.rowCount === 0) return { success: false, message: 'Customer not found' };

      const transactions = await this.db.query(
        `SELECT p.id, p.payment_date AS "paymentDate",
                jo.jo_number AS "joNumber",
                p.mode AS "paymentMethod",
                p.reference_no AS "referenceNo",
                p.amount, p.notes,
                CASE WHEN p.settlement_mode IS NOT NULL THEN 'settled' ELSE 'pending' END AS status,
                p.settlement_mode AS "settlementMode",
                p.settlement_date AS "settlementDate"
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         WHERE v.customer_id = $1 AND jo.org_id = $2
           AND p.mode IN ('po_payment', 'cheque')
         ORDER BY p.payment_date ASC`,
        [customerId, orgId],
      );

      const totalAmount = transactions.rows.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
      const settledAmount = transactions.rows
        .filter((r: any) => r.status === 'settled')
        .reduce((sum: number, row: any) => sum + Number(row.amount), 0);
      const currentBalance = totalAmount - settledAmount;

      return {
        success: true,
        data: {
          customer: customer.rows[0],
          transactions: transactions.rows,
          totalAmount,
          settledAmount,
          currentBalance,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to generate SOA' };
    }
  }
}
