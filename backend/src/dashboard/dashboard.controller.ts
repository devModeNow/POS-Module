import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  private buildAuditContext(
    request: { user?: Record<string, unknown>; ip?: string },
  ): Record<string, unknown> {
    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return {
      userId: Number.isFinite(userId) ? userId : undefined,
      username: String(request.user?.username ?? '').trim() || undefined,
      roleName: String(request.user?.roleName ?? request.user?.role_name ?? '').trim() || undefined,
      branchId: Number.isFinite(branchId) ? branchId : undefined,
      ipAddress: String(request.ip ?? '').trim() || undefined,
    };
  }

  @Get('platform-stats')
  getPlatformStats() {
    return this.dashboardService.getPlatformStats();
  }

  @Get('org')
  getOrgDashboard(@Query('period') period: string, @Req() request: { user?: Record<string, unknown> }) {
    const orgId = Number(request.user?.['orgId'] ?? 0);
    const validPeriods = ['daily', 'weekly', 'monthly'];
    const normalizedPeriod = validPeriods.includes(period) ? period : 'daily';
    return this.dashboardService.getOrgDashboard(orgId, normalizedPeriod as 'daily' | 'weekly' | 'monthly');
  }

  @Post('org/expense')
  addExpense(@Body() body: { description: string; amount: number; category?: string; expenseDate?: string }, @Req() request: { user?: Record<string, unknown> }) {
    const orgId = Number(request.user?.['orgId'] ?? 0);
    const userId = Number(request.user?.['sub'] ?? 0);
    return this.dashboardService.addExpense(orgId, userId, body);
  }

  @Post('org/deposit')
  addDeposit(@Body() body: { description: string; amount: number; source?: string }, @Req() request: { user?: Record<string, unknown> }) {
    const orgId = Number(request.user?.['orgId'] ?? 0);
    const userId = Number(request.user?.['sub'] ?? 0);
    return this.dashboardService.addDeposit(orgId, userId, body);
  }

  @Get('overview')
  getOverview(@Req() request: { user?: Record<string, unknown> }) {
    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.getOverview(
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
    );
  }

  @Get('sales-detail')
  async getSalesDetail(
    @Query('mode') mode: string,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const validModes = ['sales', 'unpaid', 'overdues', 'cheques'];
    const normalizedMode = validModes.includes(mode)
      ? (mode as 'sales' | 'unpaid' | 'overdues' | 'cheques')
      : 'sales';

    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.getSalesDetail(
      normalizedMode,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
    );
  }

  @Get('operations-detail')
  async getOperationsDetail(
    @Query('mode') mode: string,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const validModes = ['receiving', 'dispatch', 'installation', 'stock-alerts'];
    const normalizedMode = validModes.includes(mode)
      ? (mode as 'receiving' | 'dispatch' | 'installation' | 'stock-alerts')
      : 'receiving';

    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.getOperationsDetail(
      normalizedMode,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
    );
  }

  @Post('settle-sales-order')
  settleSalesOrder(
    @Body()
    body: {
      salesOrderId?: number;
      mode?: 'partial' | 'full' | 'cheque' | 'split';
      amount?: number;
      bankAmount?: number;
      chequeAmount?: number;
      bankName?: string | null;
      checkNo?: string | null;
      postDated?: string | null;
    },
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.settleSalesOrder(
      body,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
      this.buildAuditContext(request),
    );
  }

  @Post('verify-receivable')
  verifyReceivable(
    @Body() body: { paymentId?: number; method?: 'cheque' | 'credit-card' },
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.verifySalesReceivable(
      body,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
    );
  }
}
