import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { QuotationsService } from './quotations.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);
const userId = (req: AuthReq) => Number(req.user?.['sub'] ?? 0);

@Controller('quotations')
@UseGuards(JwtAuthGuard)
export class QuotationsController {
  constructor(private readonly svc: QuotationsService) {}

  @Get()
  findAll(@Query('status') status: string, @Req() req: AuthReq) {
    return this.svc.findAll(orgId(req), status);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.findOne(+id, orgId(req));
  }

  @Post()
  create(@Body() body: any, @Req() req: AuthReq) {
    return this.svc.create(orgId(req), userId(req), body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: AuthReq) {
    return this.svc.update(+id, orgId(req), body);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }, @Req() req: AuthReq) {
    return this.svc.updateStatus(+id, orgId(req), body.status);
  }
}
