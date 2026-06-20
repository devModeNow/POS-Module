import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CustomersService } from './customers.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get('search-plate')
  searchByPlate(@Query('plate') plate: string, @Req() req: AuthReq) {
    return this.svc.searchByPlate(plate, orgId(req));
  }

  @Get()
  findAll(@Query('search') search: string, @Req() req: AuthReq) {
    return this.svc.findAll(orgId(req), search);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.findOne(+id, orgId(req));
  }

  @Get(':id/vehicles')
  getVehicles(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.getVehicles(+id, orgId(req));
  }

  @Post(':id/vehicles')
  createVehicle(@Param('id') id: string, @Body() body: any, @Req() req: AuthReq) {
    return this.svc.createVehicle(+id, orgId(req), body);
  }

  @Get(':id/job-orders')
  getJobOrders(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.getJobOrders(+id, orgId(req));
  }

  @Get(':id/payments')
  getPayments(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.getPayments(+id, orgId(req));
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.getHistory(+id, orgId(req));
  }

  @Post()
  create(@Body() body: any, @Req() req: AuthReq) {
    return this.svc.create(orgId(req), body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: AuthReq) {
    return this.svc.update(+id, orgId(req), body);
  }
}
