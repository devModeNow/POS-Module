import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DashboardService } from '../services/dashboard.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('api/catering/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  getMetrics(@Req() req: AuthReq) {
    return this.dashboardService.getMetrics(orgId(req));
  }

  @Get('feedback')
  getFeedback(@Query('page') page: string, @Req() req: AuthReq) {
    return this.dashboardService.getFeedbackList(orgId(req), Number(page) || 1);
  }
}
