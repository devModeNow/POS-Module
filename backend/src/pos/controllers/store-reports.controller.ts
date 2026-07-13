import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PosStoreReportsService } from '../services/store-reports.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('api/pos/reports')
@UseGuards(JwtAuthGuard)
export class PosStoreReportsController {
  constructor(private readonly reportsService: PosStoreReportsService) {}

  @Get('dashboard')
  dashboard(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('paymentStatus') paymentStatus: string,
    @Req() req: AuthReq,
  ) {
    return this.reportsService.dashboard(orgId(req), from, to, paymentStatus);
  }

  @Get('daily-sales')
  dailySales(@Query('from') from: string, @Query('to') to: string, @Req() req: AuthReq) {
    return this.reportsService.dailySales(orgId(req), from, to);
  }

  @Get('top-products')
  topProducts(@Query('from') from: string, @Query('to') to: string, @Req() req: AuthReq) {
    return this.reportsService.topProducts(orgId(req), from, to);
  }

  @Get('sales-by-category')
  salesByCategory(@Query('from') from: string, @Query('to') to: string, @Req() req: AuthReq) {
    return this.reportsService.salesByCategory(orgId(req), from, to);
  }

  @Get('inventory-valuation')
  inventoryValuation(@Req() req: AuthReq) {
    return this.reportsService.inventoryValuation(orgId(req));
  }

  @Get('low-stock')
  lowStock(@Req() req: AuthReq) {
    return this.reportsService.lowStock(orgId(req));
  }

  @Get('transactions')
  transactions(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('paymentStatus') paymentStatus: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Req() req: AuthReq,
  ) {
    return this.reportsService.listTransactions(
      orgId(req),
      from,
      to,
      paymentStatus,
      Math.min(Math.max(Number(limit) || 50, 1), 200),
      Math.max(Number(offset) || 0, 0),
    );
  }

  @Patch('transactions/:id/payment-status')
  updatePaymentStatus(
    @Param('id') id: string,
    @Body() body: { paymentStatus?: string },
    @Req() req: AuthReq,
  ) {
    const status = body?.paymentStatus === 'floating' ? 'floating' : 'settled';
    return this.reportsService.updatePaymentStatus(orgId(req), Number(id), status);
  }

  @Get('transactions/:id')
  transactionDetail(@Param('id') id: string, @Req() req: AuthReq) {
    return this.reportsService.getTransactionDetail(orgId(req), Number(id));
  }

  @Get('completed-sales')
  completedSales(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Req() req: AuthReq,
  ) {
    return this.reportsService.listCompletedSales(
      orgId(req),
      from,
      to,
      Math.min(Math.max(Number(limit) || 100, 1), 200),
      Math.max(Number(offset) || 0, 0),
    );
  }
}
