import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuditService } from 'src/common/audit/audit.service';
import { PosStaffService } from '../services/pos-staff.service';
import { PosVoidService } from '../services/pos-void.service';
import { PosStoreReportsService } from '../services/store-reports.service';
import { posOrgId, posUserId } from '../utils/pos-auth.util';

type AuthReq = { user?: Record<string, unknown> };
const username = (req: AuthReq) =>
  String(req.user?.['username'] ?? req.user?.['fullname'] ?? 'user');

@Controller('api/pos')
@UseGuards(JwtAuthGuard)
export class PosOperationsController {
  constructor(
    private readonly staff: PosStaffService,
    private readonly voidSvc: PosVoidService,
    private readonly audit: AuditService,
    private readonly reports: PosStoreReportsService,
  ) {}

  @Post('staff/heartbeat')
  heartbeat(@Req() req: AuthReq) {
    return this.staff.heartbeat(posOrgId(req), posUserId(req));
  }

  @Get('staff/on-duty')
  onDuty(@Query('withinMinutes') withinMinutes: string, @Req() req: AuthReq) {
    const mins = Number(withinMinutes) || 30;
    return this.staff.listOnDuty(posOrgId(req), mins);
  }

  @Get('my-sales')
  mySales(
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthReq,
  ) {
    return this.reports.cashierSales(posOrgId(req), posUserId(req), from, to);
  }

  @Get('void-codes')
  listVoidCodes(@Req() req: AuthReq) {
    return this.voidSvc.listCodes(posOrgId(req));
  }

  @Post('void-codes')
  saveVoidCode(@Body() body: { id?: number; label?: string; code?: string }, @Req() req: AuthReq) {
    return this.voidSvc.upsertCode(posOrgId(req), {
      id: body.id,
      label: body.label ?? 'Default',
      code: body.code ?? '',
    });
  }

  @Delete('void-codes/:id')
  deleteVoidCode(@Param('id') id: string, @Req() req: AuthReq) {
    return this.voidSvc.deactivateCode(posOrgId(req), +id);
  }

  @Post('void-codes/:id/active')
  setVoidCodeActive(
    @Param('id') id: string,
    @Body() body: { isActive?: boolean },
    @Req() req: AuthReq,
  ) {
    return this.voidSvc.setCodeActive(posOrgId(req), +id, body?.isActive !== false);
  }

  @Post('void')
  voidItem(
    @Body() body: { saleId?: number; cartKey?: string; adminCode?: string; reason?: string },
    @Req() req: AuthReq,
  ) {
    return this.voidSvc.voidCartLine(posOrgId(req), posUserId(req), username(req), {
      saleId: body.saleId,
      cartKey: body.cartKey,
      adminCode: body.adminCode ?? '',
      reason: body.reason,
    });
  }

  @Get('audit-trail')
  auditTrail(
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Req() req: AuthReq,
  ) {
    const oid = posOrgId(req);
    const isPlatformUser = req.user?.['isPlatformUser'] === true;
    return this.audit.list({
      orgId: oid > 0 ? oid : null,
      scope: isPlatformUser ? 'all' : 'org',
      limit: Number(limit) || 100,
      offset: Number(offset) || 0,
    });
  }
}
