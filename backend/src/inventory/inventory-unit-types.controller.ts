import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { InventoryUnitTypesService } from './inventory-unit-types.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('inventory/unit-types')
@UseGuards(JwtAuthGuard)
export class InventoryUnitTypesController {
  constructor(private readonly svc: InventoryUnitTypesService) {}

  @Get()
  list(@Query('includeInactive') includeInactive: string, @Req() req: AuthReq) {
    return this.svc.list(orgId(req), includeInactive === 'true');
  }

  @Post()
  create(@Body() body: { code: string; label: string; isManualEntry?: boolean; sortOrder?: number }, @Req() req: AuthReq) {
    return this.svc.create(orgId(req), body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthReq) {
    return this.svc.update(orgId(req), +id, body as never);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.deactivate(orgId(req), +id);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.activate(orgId(req), +id);
  }
}
