import { Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OrganizationsService } from './organizations.service';
import type { CreateOrgDto, UpdateOrgDto } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  /** Public — no auth, for login page org logos */
  @Get('public')
  findAllPublic() {
    return this.orgsService.findAllPublic();
  }

  /** Public — no auth, for public pages that need org branding */
  @Get('public/:id/branding')
  getPublicBranding(@Param('id') id: string) {
    return this.orgsService.getOrgSettings(Number(id));
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.orgsService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.orgsService.findOne(Number(id));
  }

  @Get(':id/menus')
  @UseGuards(JwtAuthGuard)
  getMenus(@Param('id') id: string) {
    return this.orgsService.getMenus(Number(id));
  }

  @Get(':id/settings')
  @UseGuards(JwtAuthGuard)
  getOrgSettings(@Param('id') id: string) {
    return this.orgsService.getOrgSettings(Number(id));
  }

  @Patch(':id/settings')
  @UseGuards(JwtAuthGuard)
  updateOrgSettings(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.orgsService.updateOrgSettings(Number(id), body as any);
  }

  @Post(':id/settings/logo/light')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadLogoLight(@Param('id') id: string, @UploadedFile() file: any) {
    return this.orgsService.uploadOrgLogo(Number(id), 'light', file);
  }

  @Post(':id/settings/logo/dark')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadLogoDark(@Param('id') id: string, @UploadedFile() file: any) {
    return this.orgsService.uploadOrgLogo(Number(id), 'dark', file);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @Body() body: CreateOrgDto,
    @Req() req: { user?: Record<string, unknown> },
  ) {
    const createdBy = Number(req.user?.['sub'] ?? 0) || undefined;
    return this.orgsService.create(body, createdBy);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() body: UpdateOrgDto) {
    return this.orgsService.update(Number(id), body);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard)
  activate(@Param('id') id: string) {
    return this.orgsService.toggleActive(Number(id), true);
  }

  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard)
  deactivate(@Param('id') id: string) {
    return this.orgsService.toggleActive(Number(id), false);
  }
}
