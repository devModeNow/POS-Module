import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { SchedulingService } from '../services/scheduling.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { CompleteScheduleDto } from '../dto/complete-schedule.dto';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('api/catering/schedules')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  // ── Public endpoint (no auth) ─────────────────────────────────────────────

  @Post('public')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  createPublicSchedule(@Body() dto: CreateScheduleDto) {
    return this.schedulingService.createPublicSchedule(dto);
  }

  // ── Authenticated endpoints ───────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query('status') status: string, @Req() req: AuthReq) {
    return this.schedulingService.findAll(orgId(req), status || undefined);
  }

  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard)
  confirm(@Param('id') id: string, @Req() req: AuthReq) {
    return this.schedulingService.confirm(+id, orgId(req));
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteScheduleDto,
    @Req() req: AuthReq,
  ) {
    return this.schedulingService.complete(+id, orgId(req), dto.expenses);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(@Param('id') id: string, @Req() req: AuthReq) {
    return this.schedulingService.cancel(+id, orgId(req));
  }

  @Get(':id/menu-selections')
  @UseGuards(JwtAuthGuard)
  getMenuSelections(@Param('id') id: string, @Req() req: AuthReq) {
    return this.schedulingService.getMenuSelections(+id, orgId(req));
  }

  @Patch(':id/details')
  @UseGuards(JwtAuthGuard)
  updateDetails(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthReq) {
    return this.schedulingService.updateDetails(+id, orgId(req), body as any);
  }

  @Patch(':id/package')
  @UseGuards(JwtAuthGuard)
  updatePackage(
    @Param('id') id: string,
    @Body() body: { packageId: number },
    @Req() req: AuthReq,
  ) {
    return this.schedulingService.updatePackage(+id, orgId(req), Number(body.packageId));
  }
}
