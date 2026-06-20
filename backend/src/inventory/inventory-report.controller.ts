import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { InventoryReportService } from './inventory-report.service';
import { MonthlyReportQueryDto } from './dto/monthly-report-query.dto';
import { ActualCountDto } from './dto/actual-count.dto';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);
const userId = (req: AuthReq) => Number(req.user?.['userId'] ?? 0);

@Controller('inventory/reports')
@UseGuards(JwtAuthGuard)
export class InventoryReportController {
  constructor(private readonly reportService: InventoryReportService) {}

  @Get('monthly')
  getMonthlyReport(@Query() query: MonthlyReportQueryDto, @Req() req: AuthReq) {
    return this.reportService.generateMonthlyReport(orgId(req), query.month, query.category);
  }

  @Get('monthly/export')
  async exportMonthlyReport(
    @Query() query: MonthlyReportQueryDto,
    @Req() req: AuthReq,
    @Res() res: any,
  ) {
    const result = await this.reportService.exportMonthlyReport(orgId(req), query.month, query.category);

    if (!result.success || !result.buffer) {
      res.status(400).json({ success: false, message: result.message ?? 'Export failed' });
      return;
    }

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="inventory-report-${query.month}.xlsx"`,
    });
    res.send(result.buffer);
  }

  @Post('monthly/actual-count')
  saveActualCount(@Body() dto: ActualCountDto, @Req() req: AuthReq) {
    return this.reportService.saveActualCount(orgId(req), userId(req), {
      productId: dto.productId,
      month: dto.month,
      count: dto.count,
    });
  }
}
