import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import { SettingsService } from './settings.service';

type AuthRequest = { user?: Record<string, unknown> };

function resolveOrgId(req: AuthRequest): number | null {
  const raw = req.user?.['orgId'] ?? req.user?.['org_id'];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** Public — no auth, returns first active org's settings (for login page branding) */
  @Get('public/business-profile')
  getPublicBusinessProfile() {
    return this.settingsService.getBusinessProfile(null);
  }

  @Get('business-profile')
  @UseGuards(JwtAuthGuard)
  getBusinessProfile(@Req() req: AuthRequest) {
    return this.settingsService.getBusinessProfile(resolveOrgId(req));
  }

  @Put('business-profile')
  @UseGuards(JwtAuthGuard)
  updateBusinessProfile(@Body() dto: UpdateBusinessProfileDto, @Req() req: AuthRequest) {
    return this.settingsService.updateBusinessProfile(dto, resolveOrgId(req));
  }

  @Post('business-profile/logo/light')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadLightLogo(@UploadedFile() file: any, @Req() req: AuthRequest) {
    return this.settingsService.uploadBusinessAsset('businessLogoLight', file, resolveOrgId(req));
  }

  @Post('business-profile/logo/dark')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadDarkLogo(@UploadedFile() file: any, @Req() req: AuthRequest) {
    return this.settingsService.uploadBusinessAsset('businessLogoDark', file, resolveOrgId(req));
  }

  @Post('business-profile/template/dr')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadDrTemplate(@UploadedFile() file: any, @Req() req: AuthRequest) {
    return this.settingsService.uploadBusinessAsset('drTemplatePdf', file, resolveOrgId(req));
  }

  @Post('business-profile/signature/prepared-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadPreparedBySignature(@UploadedFile() file: any, @Req() req: AuthRequest) {
    return this.settingsService.uploadBusinessAsset('printSignaturePreparedBy', file, resolveOrgId(req));
  }

  @Post('business-profile/signature/checked-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadCheckedBySignature(@UploadedFile() file: any, @Req() req: AuthRequest) {
    return this.settingsService.uploadBusinessAsset('printSignatureCheckedBy', file, resolveOrgId(req));
  }

  @Post('business-profile/signature/approved-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadApprovedBySignature(@UploadedFile() file: any, @Req() req: AuthRequest) {
    return this.settingsService.uploadBusinessAsset('printSignatureApprovedBy', file, resolveOrgId(req));
  }
}
