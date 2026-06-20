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
 * Guard that checks if the authenticated user's roleName matches
 * one of the required roles set via the @Roles() decorator.
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

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userRole = request.user?.roleName;

    return requiredRoles.includes(userRole);
  }
}
