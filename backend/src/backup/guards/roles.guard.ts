import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Decorator that sets the required roles metadata on a handler or class.
 * Usage: @Roles('admin', 'superadmin')
 */
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

/**
 * Guard that checks if the authenticated user may access role-protected routes.
 *
 * Allows access when:
 * 1. roleName matches a required role (case-insensitive), or
 * 2. roleName contains "admin" when an admin-like role is required, or
 * 3. JWT menus/permissions grant Settings update (same rule as the Settings UI),
 *    so POS admins with custom role names are not blocked from backups.
 *
 * If no roles are specified on the handler or class, access is granted.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.get<string[]>('roles', context.getHandler()) ??
      this.reflector.get<string[]>('roles', context.getClass());

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as Record<string, unknown> | undefined;
    if (!user) return false;

    const userRole = this.normalize(user['roleName'] ?? user['role'] ?? user['rolename']);

    if (
      requiredRoles.some((role) => {
        const required = this.normalize(role);
        if (required && required === userRole) return true;
        if (required.includes('admin') && userRole.includes('admin')) return true;
        return false;
      })
    ) {
      return true;
    }

    // Match frontend Settings → Database Backup visibility:
    // isAdminOrSuperAdmin() || (POS/settings user with canUpdate).
    if (this.canUpdateSettings(user)) {
      return true;
    }

    return false;
  }

  private normalize(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private parseCsv(value: unknown): string[] {
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    if (raw.toUpperCase() === 'ALL') return ['ALL'];
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private normalizeMenuKey(menu: string): string {
    return menu.trim().toLowerCase().replace(/[_\s]+/g, '-');
  }

  private canUpdateSettings(user: Record<string, unknown>): boolean {
    const menus = this.parseCsv(user['menus']);
    const permissions = this.parseCsv(user['permissions']);

    const hasSettingsMenu =
      menus.includes('ALL') ||
      menus.some((menu) => {
        const key = this.normalizeMenuKey(menu);
        return key === 'settings' || key === 'all';
      });

    const canUpdate =
      permissions.includes('ALL') ||
      permissions.some((perm) => {
        const key = perm.trim().toLowerCase();
        return key === 'canupdate' || key === 'candoall' || key === 'all' || key === 'update';
      });

    return hasSettingsMenu && canUpdate;
  }
}
