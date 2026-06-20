import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { JobOrdersService } from './job-orders.service';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);
const userId = (req: AuthReq) => Number(req.user?.['sub'] ?? 0);

@Controller('job-orders')
@UseGuards(JwtAuthGuard)
export class JobOrdersController {
  constructor(private readonly svc: JobOrdersService) {}

  @Get('technicians/search')
  searchTechnicians(@Query('q') q: string, @Req() req: AuthReq) {
    return this.svc.searchTechnicians(orgId(req), q ?? '');
  }

  @Get('services/search')
  searchServices(@Query('q') q: string, @Req() req: AuthReq) {
    return this.svc.searchServices(orgId(req), q ?? '');
  }

  @Post('services')
  createService(@Body() body: { name: string; defaultFee?: number }, @Req() req: AuthReq) {
    return this.svc.createService(orgId(req), body.name, body.defaultFee);
  }

  @Get('technicians')
  getTechnicians(@Req() req: AuthReq) {
    return this.svc.getTechnicians(orgId(req));
  }

  @Post('technicians')
  createTechnician(@Body() body: { name: string }, @Req() req: AuthReq) {
    return this.svc.createTechnician(orgId(req), body.name);
  }

  @Get('vehicles/search')
  searchVehicles(@Query('q') q: string, @Req() req: AuthReq) {
    return this.svc.searchVehicles(orgId(req), q ?? '');
  }

  @Get('vehicles/:vehicleId/history')
  getVehicleHistory(@Param('vehicleId') vehicleId: string, @Req() req: AuthReq) {
    return this.svc.getVehicleHistory(+vehicleId, orgId(req));
  }

  @Get('customers/search')
  searchCustomers(@Query('q') q: string, @Req() req: AuthReq) {
    return this.svc.searchCustomers(orgId(req), q ?? '');
  }

  @Get()
  findAll(@Query('status') status: string, @Query('search') search: string, @Req() req: AuthReq) {
    return this.svc.findAll(orgId(req), status, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.findOne(+id, orgId(req));
  }

  @Post()
  create(@Body() body: any, @Req() req: AuthReq) {
    return this.svc.create(orgId(req), userId(req), body);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string; jobsDone?: string; serviceRemarks?: string }, @Req() req: AuthReq) {
    return this.svc.updateStatus(+id, orgId(req), body.status, body);
  }

  @Post(':id/signature')
  saveSignature(@Param('id') id: string, @Body() body: { type: 'customer' | 'mechanic'; signatureData: string; signatoryName?: string }, @Req() req: AuthReq) {
    return this.svc.saveSignature(+id, orgId(req), body.type, body.signatureData, body.signatoryName);
  }

  @Post(':id/payment')
  addPayment(@Param('id') id: string, @Body() body: any, @Req() req: AuthReq) {
    return this.svc.addPayment(+id, orgId(req), userId(req), body);
  }

  @Get(':id/change-logs')
  getChangeLogs(@Param('id') id: string, @Req() req: AuthReq) {
    return this.svc.getChangeLogs(+id, orgId(req));
  }

  @Patch(':id/supplies')
  updateSupplies(@Param('id') id: string, @Body() body: any, @Req() req: AuthReq) {
    const uName = String(req.user?.['fullname'] ?? req.user?.['username'] ?? '');
    return this.svc.updateSupplies(+id, orgId(req), userId(req), uName, body);
  }

  @Patch(':id/transaction-date')
  updateTransactionDate(@Param('id') id: string, @Body() body: { transactionDate: string }, @Req() req: AuthReq) {
    return this.svc.updateTransactionDate(+id, orgId(req), body.transactionDate);
  }
}
