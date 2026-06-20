import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

type AuditActorContext = {
  userId?: number;
  username?: string;
  roleName?: string;
  branchId?: number;
  ipAddress?: string;
};

type Trend = 'up' | 'down';

type KpiCard = {
  label: string;
  value: string;
  change: string;
  trend: Trend;
};

type OpsLevel = 'normal' | 'warning' | 'critical';

type OpsItem = {
  label: string;
  value: string;
  hint: string;
  level: OpsLevel;
};

type MarginItem = {
  label: string;
  margin: number;
};

type ActivityItem = {
  time: string;
  text: string;
  status: 'received' | 'dispatch' | 'install' | 'payment';
};

type DashboardResponse = {
  success: boolean;
  message?: string;
  item?: {
    generatedAt: string;
    topKpis: KpiCard[];
    operations: OpsItem[];
    salesSummary: KpiCard[];
    topCustomers: Array<{ name: string; orders: number; balance: string }>;
    topCapacities: Array<{ label: string; units: number; sellThrough: number }>;
    marginByBrand: MarginItem[];
    marginByVendor: MarginItem[];
    activityFeed: ActivityItem[];
    todayFocus: string;
  };
};

type DashboardSalesDetailMode = 'sales' | 'unpaid' | 'overdues' | 'cheques';
type DashboardOperationDetailMode = 'receiving' | 'dispatch' | 'installation' | 'stock-alerts';
type DashboardSettlementMode = 'partial' | 'full' | 'cheque' | 'split';
type DashboardReceivableVerificationMode = 'cheque' | 'credit-card';

@Injectable()
export class DashboardService {
  constructor(
    private readonly databaseService: DatabaseService,
  ) {}

  async getPlatformStats(): Promise<{
    success: boolean;
    data?: {
      totalOrgs: number;
      activeOrgs: number;
      totalUsers: number;
      activeUsers: number;
      orgs: Array<{ id: number; name: string; code: string; userCount: number; isActive: boolean }>;
    };
    message?: string;
  }> {
    try {
      const orgsResult = await this.databaseService.query<{
        id: number; name: string; code: string; isActive: boolean; userCount: string;
      }>(
        `SELECT
           o.id,
           o.name,
           o.code,
           o.is_active AS "isActive",
           COUNT(u.id)::text AS "userCount"
         FROM tblorganizations o
         LEFT JOIN tblusers u
           ON u.org_id = o.id
           AND COALESCE(u.is_deleted, false) = false
           AND COALESCE(u.status, 1) != 0
         GROUP BY o.id, o.name, o.code, o.is_active
         ORDER BY o.id ASC`,
      );

      const usersResult = await this.databaseService.query<{ total: string; active: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (
             WHERE COALESCE(is_deleted, false) = false AND COALESCE(status, 1) != 0
           )::text AS active
         FROM tblusers`,
      );

      const orgs = orgsResult.rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        code: r.code,
        isActive: r.isActive,
        userCount: Number(r.userCount),
      }));

      return {
        success: true,
        data: {
          totalOrgs: orgs.length,
          activeOrgs: orgs.filter((o) => o.isActive).length,
          totalUsers: Number(usersResult.rows[0]?.total ?? 0),
          activeUsers: Number(usersResult.rows[0]?.active ?? 0),
          orgs,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load platform stats',
      };
    }
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private formatInteger(value: number): string {
    return Math.round(value).toLocaleString('en-PH');
  }

  private formatCurrency(value: number): string {
    return `PHP ${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
  }

  private formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  private formatActivityTime(value: string | null): string {
    if (!value) {
      return '--:--';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '--:--';
    }

    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  async getOverview(branchId?: number): Promise<DashboardResponse> {
    return {
      success: true,
      item: {
        generatedAt: new Date().toISOString(),
        topKpis: [],
        operations: [],
        salesSummary: [],
        topCustomers: [],
        topCapacities: [],
        marginByBrand: [],
        marginByVendor: [],
        activityFeed: [],
        todayFocus: 'Dashboard data sources are being migrated',
      },
    };
  }

  async getSalesDetail(mode: DashboardSalesDetailMode, branchId?: number): Promise<{ success: boolean; items: unknown[] }> {
    return { success: true, items: [] };
  }

  async getOperationsDetail(mode: DashboardOperationDetailMode, branchId?: number): Promise<{ success: boolean; items: unknown[] }> {
    return { success: true, items: [] };
  }

  async settleSalesOrder(
    payload: {
      salesOrderId?: number;
      mode?: DashboardSettlementMode;
      amount?: number;
      bankAmount?: number;
      chequeAmount?: number;
      bankName?: string | null;
      checkNo?: string | null;
      postDated?: string | null;
    },
    branchId?: number,
    auditActor?: AuditActorContext,
  ): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'Sales settlement is temporarily unavailable during migration',
    };
  }

  async verifySalesReceivable(
    payload: { paymentId?: number; method?: DashboardReceivableVerificationMode },
    branchId?: number,
  ): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'Receivable verification is temporarily unavailable during migration',
    };
  }

  // ── Org Dashboard ─────────────────────────────────────────────────────

  async getOrgDashboard(orgId: number, period: 'daily' | 'weekly' | 'monthly') {
    try {
      // Determine date range based on period (use Philippine timezone)
      let dateFilter: string;
      let expenseDateFilter: string;
      if (period === 'daily') {
        dateFilter = `DATE(COALESCE(jo.transaction_date, jo.created_at AT TIME ZONE 'Asia/Manila')::date) = (NOW() AT TIME ZONE 'Asia/Manila')::date`;
        expenseDateFilter = `DATE(COALESCE(expense_date, (created_at AT TIME ZONE 'Asia/Manila')::date)) = (NOW() AT TIME ZONE 'Asia/Manila')::date`;
      } else if (period === 'weekly') {
        dateFilter = `COALESCE(jo.transaction_date, (jo.created_at AT TIME ZONE 'Asia/Manila')::date) >= DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Manila')::date)`;
        expenseDateFilter = `COALESCE(expense_date, (created_at AT TIME ZONE 'Asia/Manila')::date) >= DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Manila')::date)`;
      } else {
        dateFilter = `COALESCE(jo.transaction_date, (jo.created_at AT TIME ZONE 'Asia/Manila')::date) >= DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Manila')::date)`;
        expenseDateFilter = `COALESCE(expense_date, (created_at AT TIME ZONE 'Asia/Manila')::date) >= DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Manila')::date)`;
      }

      // For non-JO queries that don't have a jo. prefix
      const genericDateFilter = dateFilter.replace(/jo\./g, '');

      // Sales: only Cash, GCash, Bank Transfer (exclude PO Payment & Cheque)
      const salesResult = await this.databaseService.query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(jo.total_amount), 0)::text AS total, COUNT(DISTINCT jo.id)::text AS count
         FROM tbljoborders jo
         LEFT JOIN tbljo_payments p ON p.job_order_id = jo.id
         WHERE jo.org_id = $1 AND jo.status IN ('for-payment','released') AND ${dateFilter}
           AND (p.mode IS NULL OR p.mode NOT IN ('po_payment', 'cheque'))`,
        [orgId],
      );

      // Floating Sales: PO Payment & Cheque
      const floatingSalesResult = await this.databaseService.query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(jo.total_amount), 0)::text AS total, COUNT(DISTINCT jo.id)::text AS count
         FROM tbljoborders jo
         INNER JOIN tbljo_payments p ON p.job_order_id = jo.id
         WHERE jo.org_id = $1 AND jo.status IN ('for-payment','released') AND ${dateFilter}
           AND p.mode IN ('po_payment', 'cheque')`,
        [orgId],
      );

      // Jobs Done: count of job orders moved to for-payment or released in the period
      const jobsDoneResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tbljoborders jo
         WHERE jo.org_id = $1 AND jo.status IN ('for-payment','released') AND ${dateFilter}`,
        [orgId],
      );

      // Petty Cash: expenses filtered by period
      const expensesResult = await this.databaseService.query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::text AS count
         FROM tblorg_expenses WHERE org_id = $1 AND ${expenseDateFilter}`,
        [orgId],
      );

      // Deposits in the period
      const depositsResult = await this.databaseService.query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::text AS count
         FROM tblorg_deposits WHERE org_id = $1 AND DATE((created_at AT TIME ZONE 'Asia/Manila')::date) ${period === 'daily' ? "= (NOW() AT TIME ZONE 'Asia/Manila')::date" : period === 'weekly' ? ">= DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Manila')::date)" : ">= DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Manila')::date)"}`,
        [orgId],
      );

      // Payment method breakdown for the period
      const paymentBreakdown = await this.databaseService.query<{ mode: string; total: string; count: string }>(
        `SELECT p.mode, COALESCE(SUM(p.amount), 0)::text AS total, COUNT(*)::text AS count
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         WHERE jo.org_id = $1 AND jo.status IN ('for-payment','released') AND ${dateFilter}
         GROUP BY p.mode ORDER BY total DESC`,
        [orgId],
      );

      // Receiving PO: count of draft POs
      const receivingPOResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tblpurchases WHERE org_id = $1 AND status = 'draft'`,
        [orgId],
      );

      // Stock Alerts: count of items below warning threshold
      const stockAlertResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tblinventory
         WHERE org_id = $1 AND stock_qty <= stock_warning`,
        [orgId],
      );

      // Recent expenses (filtered by period) + category breakdown
      const recentExpenses = await this.databaseService.query(
        `SELECT id, description, amount, category, expense_date AS "expenseDate", created_at AS "createdAt"
         FROM tblorg_expenses WHERE org_id = $1 AND ${expenseDateFilter}
         ORDER BY COALESCE(expense_date, created_at::date) DESC, created_at DESC LIMIT 10`,
        [orgId],
      );

      // Expense category breakdown (filtered by period)
      const expenseBreakdown = await this.databaseService.query<{ category: string; total: string; count: string }>(
        `SELECT COALESCE(NULLIF(category, ''), 'General') AS category,
                COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::text AS count
         FROM tblorg_expenses WHERE org_id = $1 AND ${expenseDateFilter}
         GROUP BY COALESCE(NULLIF(category, ''), 'General') ORDER BY total DESC`,
        [orgId],
      );

      // Recent deposits (last 10)
      const recentDeposits = await this.databaseService.query(
        `SELECT id, description, amount, source, created_at AS "createdAt"
         FROM tblorg_deposits WHERE org_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [orgId],
      );

      return {
        success: true,
        data: {
          period,
          sales: { total: Number(salesResult.rows[0]?.total ?? 0), count: Number(salesResult.rows[0]?.count ?? 0) },
          floatingSales: { total: Number(floatingSalesResult.rows[0]?.total ?? 0), count: Number(floatingSalesResult.rows[0]?.count ?? 0) },
          jobsDone: { count: Number(jobsDoneResult.rows[0]?.count ?? 0) },
          pettyCash: { total: Number(expensesResult.rows[0]?.total ?? 0), count: Number(expensesResult.rows[0]?.count ?? 0) },
          deposits: { total: Number(depositsResult.rows[0]?.total ?? 0), count: Number(depositsResult.rows[0]?.count ?? 0) },
          paymentBreakdown: paymentBreakdown.rows.map(r => ({ mode: r.mode, total: Number(r.total), count: Number(r.count) })),
          inventory: {
            receivingPO: Number(receivingPOResult.rows[0]?.count ?? 0),
            stockAlerts: Number(stockAlertResult.rows[0]?.count ?? 0),
          },
          recentExpenses: recentExpenses.rows,
          expenseBreakdown: expenseBreakdown.rows.map(r => ({ category: r.category, total: Number(r.total), count: Number(r.count) })),
          recentDeposits: recentDeposits.rows,
        },
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load dashboard' };
    }
  }

  async addExpense(orgId: number, userId: number, dto: { description: string; amount: number; category?: string; expenseDate?: string }) {
    if (!dto.description?.trim()) return { success: false, message: 'Description is required' };
    if (!dto.amount || dto.amount <= 0) return { success: false, message: 'Amount must be greater than 0' };
    try {
      const expDate = dto.expenseDate || new Date().toISOString().slice(0, 10);
      const result = await this.databaseService.query<{ id: number }>(
        `INSERT INTO tblorg_expenses (org_id, description, amount, category, created_by, expense_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, dto.description.trim(), dto.amount, dto.category ?? null, userId, expDate],
      );
      return { success: true, id: result.rows[0].id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to add expense' };
    }
  }

  async addDeposit(orgId: number, userId: number, dto: { description: string; amount: number; source?: string }) {
    if (!dto.description?.trim()) return { success: false, message: 'Description is required' };
    if (!dto.amount || dto.amount <= 0) return { success: false, message: 'Amount must be greater than 0' };
    try {
      const result = await this.databaseService.query<{ id: number }>(
        `INSERT INTO tblorg_deposits (org_id, description, amount, source, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, dto.description.trim(), dto.amount, dto.source ?? null, userId],
      );
      return { success: true, id: result.rows[0].id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to add deposit' };
    }
  }
}
