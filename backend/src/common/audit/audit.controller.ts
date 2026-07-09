import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuditService } from './audit.service';

type AuthReq = { user?: Record<string, unknown> };

@Controller('audit-trail')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Req() req: AuthReq,
  ) {
    const orgId = Number(req.user?.['orgId'] ?? 0);
    const isPlatformUser = req.user?.['isPlatformUser'] === true;

    return this.audit.list({
      orgId: orgId > 0 ? orgId : null,
      scope: isPlatformUser ? 'all' : 'org',
      limit: Number(limit) || 100,
      offset: Number(offset) || 0,
    });
  }
}
