import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, CanMatchFn, Router, UrlTree } from '@angular/router';
import { getAccessToken, getRefreshToken, clearAccessToken } from '../services/auth-storage';
import { MenuKey, PermissionKey, RbacService } from '../services/rbac.service';

function hasSession(): boolean {
  const rbacService = inject(RbacService);
  if (rbacService.isAuthenticated()) {
    return true;
  }
  return Boolean(getRefreshToken());
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
  return hasSession() ? true : toLogin();
};

export const authChildGuard: CanActivateChildFn = () => {
  return hasSession() ? true : toLogin();
};

export const guestOnlyGuard: CanActivateFn = () => {
  const rbacService = inject(RbacService);
  if (rbacService.isAuthenticated()) {
    return toDashboard();
  }
  if (getAccessToken() && !getRefreshToken()) {
    clearAccessToken();
  }
  return true;
};

export const guestOnlyMatchGuard: CanMatchFn = () => {
  const rbacService = inject(RbacService);
  if (rbacService.isAuthenticated()) {
    return toDashboard();
  }
  if (getAccessToken() && !getRefreshToken()) {
    clearAccessToken();
  }
  return true;
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
