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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('roles')
  findRoles(@Query('orgId') orgId?: string) {
    const parsedOrgId = orgId ? Number(orgId) : null;
    return this.usersService.findRoles(Number.isFinite(parsedOrgId) && parsedOrgId! > 0 ? parsedOrgId : null);
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
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll(
    @Query('includeDeleted') includeDeleted?: string,
    @Query('orgId') orgId?: string,
  ) {
    const includeDeletedFlag = ['1', 'true', 'yes', 'on'].includes(
      String(includeDeleted ?? '').trim().toLowerCase(),
    );
    const parsedOrgId = orgId ? Number(orgId) : null;
    return this.usersService.findAll(
      includeDeletedFlag,
      Number.isFinite(parsedOrgId) && parsedOrgId! > 0 ? parsedOrgId : null,
    );
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
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.usersService.restore(+id);
  }
}
