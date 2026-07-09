import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  Query,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';

type AuthReq = { user?: Record<string, unknown> };

const callerOrgId = (req: AuthReq): number | null => {
  const raw = req.user?.['orgId'];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('roles')
  findRoles(@Query('orgId') orgId: string | undefined, @Req() req: AuthReq) {
    const scopedOrgId = callerOrgId(req) ?? (orgId ? Number(orgId) : null);
    const parsedOrgId =
      scopedOrgId != null && Number.isFinite(scopedOrgId) && scopedOrgId > 0 ? scopedOrgId : null;
    return this.usersService.findRoles(parsedOrgId);
  }

  @Get('permission-keys')
  findPermissionKeys() {
    return this.usersService.findPermissionKeys();
  }

  @Post('permission-keys')
  createPermissionKey(
    @Body()
    body: { key?: string; label?: string; module?: string; scope?: 'feature' | 'menu' | 'tab' | 'action' },
  ) {
    return this.usersService.createPermissionKey(body);
  }

  @Get('roles/:roleId/permissions')
  findRolePermissions(@Param('roleId') roleId: string) {
    return this.usersService.findRolePermissions(+roleId);
  }

  @Put('roles/:roleId/permissions')
  setRolePermissions(
    @Param('roleId') roleId: string,
    @Body() body: { permissionKeys?: string[] },
  ) {
    return this.usersService.setRolePermissions(+roleId, body.permissionKeys ?? []);
  }

  @Post()
  create(@Body() createUserDto: CreateUserDto, @Req() req: AuthReq) {
    const scopedOrgId = callerOrgId(req);
    if (scopedOrgId != null) {
      createUserDto.orgId = scopedOrgId;
    }
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll(
    @Query('includeDeleted') includeDeleted: string | undefined,
    @Query('orgId') orgId: string | undefined,
    @Req() req: AuthReq,
  ) {
    const includeDeletedFlag = ['1', 'true', 'yes', 'on'].includes(
      String(includeDeleted ?? '').trim().toLowerCase(),
    );
    const scopedOrgId = callerOrgId(req) ?? (orgId ? Number(orgId) : null);
    const parsedOrgId =
      scopedOrgId != null && Number.isFinite(scopedOrgId) && scopedOrgId > 0 ? scopedOrgId : null;
    return this.usersService.findAll(includeDeletedFlag, parsedOrgId);
  }

  @Get('me')
  findMe(@Req() req: AuthReq) {
    const id = Number(req.user?.['sub'] ?? 0);
    if (!id) return { success: false, message: 'Not authenticated' };
    return this.usersService.findOne(id);
  }

  @Patch('me')
  updateMe(@Body() updateUserDto: UpdateMeDto, @Req() req: AuthReq) {
    const id = Number(req.user?.['sub'] ?? 0);
    if (!id) return { success: false, message: 'Not authenticated' };
    const scopedOrgId = callerOrgId(req);
    const safeDto: UpdateUserDto = {
      username: updateUserDto.username,
      fullname: updateUserDto.fullname,
      email: updateUserDto.email,
      contact: updateUserDto.contact,
      address: updateUserDto.address,
      birthdate: updateUserDto.birthdate,
      password: updateUserDto.password,
    };
    return this.usersService.update(+id, safeDto, scopedOrgId, true);
  }

  @Post('me/profile-picture')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadMyProfilePicture(@UploadedFile() file: any, @Req() req: AuthReq) {
    const id = Number(req.user?.['sub'] ?? 0);
    if (!id) return { success: false, message: 'Not authenticated' };
    return this.usersService.uploadProfilePicture(+id, file, callerOrgId(req), true);
  }

  @Delete('me/profile-picture')
  removeMyProfilePicture(@Req() req: AuthReq) {
    const id = Number(req.user?.['sub'] ?? 0);
    if (!id) return { success: false, message: 'Not authenticated' };
    return this.usersService.removeProfilePicture(+id, callerOrgId(req), true);
  }

  @Get(':id/permission-overrides')
  findUserPermissionOverrides(@Param('id') id: string) {
    return this.usersService.findUserPermissionOverrides(+id);
  }

  @Put(':id/permission-overrides')
  setUserPermissionOverrides(
    @Param('id') id: string,
    @Body() body: { overrides?: Array<{ permissionKey: string; effect: 'allow' | 'deny'; reason?: string | null }> },
  ) {
    return this.usersService.setUserPermissionOverrides(+id, body.overrides ?? []);
  }

  @Get(':id/effective-permissions')
  findUserEffectivePermissions(@Param('id') id: string) {
    return this.usersService.findUserEffectivePermissions(+id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @Req() req: AuthReq) {
    const scopedOrgId = callerOrgId(req);
    if (scopedOrgId != null) {
      updateUserDto.orgId = scopedOrgId;
    }
    return this.usersService.update(+id, updateUserDto, scopedOrgId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthReq) {
    return this.usersService.remove(+id, callerOrgId(req));
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string, @Req() req: AuthReq) {
    return this.usersService.restore(+id, callerOrgId(req));
  }
}
