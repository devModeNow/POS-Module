import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ReportsService } from './reports.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('sales')
  getSalesReport(
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthReq,
  ) {
    return this.svc.getSalesReport(orgId(req), from, to);
  }

  @Get('jobs')
  getJobsReport(
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthReq,
  ) {
    return this.svc.getJobsReport(orgId(req), from, to);
  }

  @Get('payables-receivables')
  getPayablesReceivablesReport(
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthReq,
  ) {
    return this.svc.getPayablesReceivablesReport(orgId(req), from, to);
  }

  @Get('inventory')
  getInventoryReport(
    @Query('category') category: string,
    @Query('brand') brand: string,
    @Req() req: AuthReq,
  ) {
    return this.svc.getInventoryReport(orgId(req), category, brand);
  }

  @Get('low-stock')
  getLowStockReport(@Req() req: AuthReq) {
    return this.svc.getLowStockReport(orgId(req));
  }
}
