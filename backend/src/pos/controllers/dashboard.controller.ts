import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PosDashboardService } from '../services/dashboard.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('api/pos/dashboard')
@UseGuards(JwtAuthGuard)
export class PosDashboardController {
  constructor(private readonly dashboardService: PosDashboardService) {}

  @Get('metrics')
  getMetrics(@Query('period') period: string, @Req() req: AuthReq) {
    const normalized =
      period === 'weekly' || period === 'monthly' ? period : 'daily';
    return this.dashboardService.getMetrics(orgId(req), normalized);
  }
}
