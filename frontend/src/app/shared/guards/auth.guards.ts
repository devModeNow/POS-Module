import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, CanMatchFn, Router, UrlTree } from '@angular/router';
import { getAccessToken } from '../services/auth-storage';
import { MenuKey, PermissionKey, RbacService } from '../services/rbac.service';

function hasToken(): boolean {
  return Boolean(getAccessToken());
}

function toDashboard(): UrlTree {
  const router = inject(Router);
  const rbacService = inject(RbacService);

  // Find the user's first available menu to avoid redirect loops
  const menus = rbacService.getAllowedMenus();
  if (menus.has('dashboard')) {
    return router.createUrlTree(['/users/dashboard']);
  }

  const firstMenu = [...menus].find(m => m.length > 0);
  if (firstMenu) {
    return router.createUrlTree(['/users', firstMenu]);
  }

  return router.createUrlTree(['/users/dashboard']);
}

function toLogin(): UrlTree {
  const router = inject(Router);
  return router.createUrlTree(['/']);
}

export const authGuard: CanActivateFn = () => {
  return hasToken() ? true : toLogin();
};

export const authChildGuard: CanActivateChildFn = () => {
  return hasToken() ? true : toLogin();
};

export const guestOnlyGuard: CanActivateFn = () => {
  return hasToken() ? toDashboard() : true;
};

export const guestOnlyMatchGuard: CanMatchFn = () => {
  return hasToken() ? toDashboard() : true;
};

export const rbacGuard: CanActivateFn = (route) => {
  const rbacService = inject(RbacService);

  const menu = route.data?.['menu'] as string | undefined;
  const permission = route.data?.['permission'] as PermissionKey | undefined;

  if (!menu) {
    return rbacService.isAuthenticated() ? true : toLogin();
  }

  return rbacService.canAccess(menu, permission) ? true : toDashboard();
};
