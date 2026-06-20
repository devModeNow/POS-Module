import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { FinanceService } from './finance.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);
const userId = (req: AuthReq) => Number(req.user?.['sub'] ?? 0);

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private readonly svc: FinanceService) {}

  // ─── Expenses ──────────────────────────────────────────────────────────────────

  @Get('expenses')
  getExpenses(@Query('from') from: string, @Query('to') to: string, @Req() req: AuthReq) {
    return this.svc.getExpenses(orgId(req), from, to);
  }

  @Post('expenses')
  createExpense(
    @Body() body: { description: string; amount: number; category?: string; expenseDate?: string },
    @Req() req: AuthReq,
  ) {
    return this.svc.createExpense(orgId(req), userId(req), body);
  }

  @Post('expenses/:id/delete')
  softDeleteExpense(
    @Param('id') id: string,
    @Body() body: { reason: string; password: string },
    @Req() req: AuthReq,
  ) {
    return this.svc.softDeleteExpense(orgId(req), userId(req), +id, body);
  }

  // ─── Deposits ──────────────────────────────────────────────────────────────────

  @Get('deposits')
  getDeposits(@Query('from') from: string, @Query('to') to: string, @Req() req: AuthReq) {
    return this.svc.getDeposits(orgId(req), from, to);
  }

  @Post('deposits')
  createDeposit(
    @Body() body: { description: string; amount: number; source?: string },
    @Req() req: AuthReq,
  ) {
    return this.svc.createDeposit(orgId(req), userId(req), body);
  }

  @Delete('deposits/:id')
  deleteDeposit(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.deleteDeposit(orgId(req), +id);
  }

  // ─── Receivables ───────────────────────────────────────────────────────────────

  @Get('receivables')
  getReceivables(@Query('from') from: string, @Query('to') to: string, @Req() req: AuthReq) {
    return this.svc.getReceivables(orgId(req), from, to);
  }

  @Patch('receivables/:id/settle')
  settleReceivable(
    @Param('id') id: string,
    @Body() body: { settlementMode: string; settlementDate: string; settlementReference?: string },
    @Req() req: AuthReq,
  ) {
    return this.svc.settleReceivable(orgId(req), userId(req), +id, body);
  }

  // ─── Calendar ──────────────────────────────────────────────────────────────────

  @Get('calendar')
  getCalendarEvents(@Query('from') from: string, @Query('to') to: string, @Req() req: AuthReq) {
    return this.svc.getCalendarEvents(orgId(req), from, to);
  }

  // ─── Customer SOA ──────────────────────────────────────────────────────────────

  @Get('soa/customers')
  getCustomersWithReceivables(@Req() req: AuthReq) {
    return this.svc.getCustomersWithReceivables(orgId(req));
  }

  @Get('soa/:customerId')
  getCustomerSOA(@Param('customerId') customerId: string, @Req() req: AuthReq) {
    return this.svc.getCustomerSOA(orgId(req), +customerId);
  }
}
