import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { MenuService } from '../services/menu.service';
import { CreateMenuItemDto } from '../dto/create-menu-item.dto';
import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';
import { CreatePackageDto } from '../dto/create-package.dto';
import { UpdatePackageDto } from '../dto/update-package.dto';

type AuthReq = { user?: Record<string, unknown> };
const orgId = (req: AuthReq) => Number(req.user?.['orgId'] ?? 0);

@Controller('api/catering/menus')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  // ── Menu Items ────────────────────────────────────────────────────────────

  @Get('items')
  @UseGuards(JwtAuthGuard)
  listMenuItems(@Req() req: AuthReq) {
    return this.menuService.listMenuItems(orgId(req));
  }

  @Post('items')
  @UseGuards(JwtAuthGuard)
  createMenuItem(@Body() dto: CreateMenuItemDto, @Req() req: AuthReq) {
    return this.menuService.createMenuItem(orgId(req), dto);
  }

  @Patch('items/:id')
  @UseGuards(JwtAuthGuard)
  updateMenuItem(
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemDto,
    @Req() req: AuthReq,
  ) {
    return this.menuService.updateMenuItem(+id, orgId(req), dto);
  }

  @Delete('items/:id')
  @UseGuards(JwtAuthGuard)
  deleteMenuItem(@Param('id') id: string, @Req() req: AuthReq) {
    return this.menuService.deleteMenuItem(+id, orgId(req));
  }

  @Post('items/:id/image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image'))
  uploadMenuItemImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthReq,
  ) {
    return this.menuService.uploadMenuItemImage(+id, orgId(req), file);
  }

  @Delete('items/:id/image')
  @UseGuards(JwtAuthGuard)
  removeMenuItemImage(@Param('id') id: string, @Req() req: AuthReq) {
    return this.menuService.removeMenuItemImage(+id, orgId(req));
  }

  // ── Packages ──────────────────────────────────────────────────────────────

  @Get('packages')
  @UseGuards(JwtAuthGuard)
  listPackages(@Req() req: AuthReq) {
    return this.menuService.listPackages(orgId(req));
  }

  @Get('packages/public/:orgId')
  listPackagesPublic(@Param('orgId') paramOrgId: string) {
    return this.menuService.listPackagesPublic(+paramOrgId);
  }

  @Post('packages')
  @UseGuards(JwtAuthGuard)
  createPackage(@Body() dto: CreatePackageDto, @Req() req: AuthReq) {
    return this.menuService.createPackage(orgId(req), dto);
  }

  @Patch('packages/:id')
  @UseGuards(JwtAuthGuard)
  updatePackage(
    @Param('id') id: string,
    @Body() dto: UpdatePackageDto,
    @Req() req: AuthReq,
  ) {
    return this.menuService.updatePackage(+id, orgId(req), dto);
  }

  @Delete('packages/:id')
  @UseGuards(JwtAuthGuard)
  deletePackage(@Param('id') id: string, @Req() req: AuthReq) {
    return this.menuService.deletePackage(+id, orgId(req));
  }

  @Post('packages/:id/image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image'))
  uploadPackageImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthReq,
  ) {
    return this.menuService.uploadPackageImage(+id, orgId(req), file);
  }
}
