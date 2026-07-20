import { Injectable, Injector } from '@angular/core';
import { apiClient } from './api-client';
import {
  clearAccessToken,
  getRefreshToken,
  isSessionPersistent,
  setSessionTokens,
} from './auth-storage';
import { RbacService } from './rbac.service';
import { OrgService } from './org.service';

export interface LoginResponse {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  message?: string;
  role?: {
    id: number | null;
    name: string | null;
    menus: string | null;
    permissions: string | null;
  };
  org?: {
    id: number | null;
    code: string | null;
    name: string | null;
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(
    private readonly rbacService: RbacService,
    private readonly orgService: OrgService,
    private readonly injector: Injector,
  ) {}

  async login(username: string, password: string, persist = false): Promise<LoginResponse> {
    const response = await apiClient.post<LoginResponse>('/login', { username, password });

    if (response.data.success && response.data.accessToken && response.data.refreshToken) {
      setSessionTokens(response.data.accessToken, response.data.refreshToken, persist);
      this.syncOrgContext();
      void this.rbacService.syncEffectivePermissions();
      void this.connectPrintHubAfterAuth();
    }

    return response.data;
  }

  logout(): void {
    this.rbacService.clearEffectivePermissionCache();
    clearAccessToken();
    this.orgService.reset();
  }

  async refreshSession(): Promise<LoginResponse> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      return { success: false, message: 'No refresh token available' };
    }

    const response = await apiClient.post<LoginResponse>('/login/refresh', { refreshToken });

    if (response.data.success && response.data.accessToken && response.data.refreshToken) {
      setSessionTokens(response.data.accessToken, response.data.refreshToken, isSessionPersistent());
      await this.rbacService.syncEffectivePermissions();
      this.syncOrgContext();
      void this.connectPrintHubAfterAuth();
    }

    return response.data;
  }

  /** Reads orgId/orgCode/orgName from the JWT payload and pushes to OrgService. */
  syncOrgContext(): void {
    this.orgService.setContext({
      id:   this.rbacService.getOrgId(),
      code: this.rbacService.getOrgCode(),
      name: this.rbacService.getOrgName(),
    });
  }

  /**
   * POS orgs: restore/auto-connect PrintHub Bluetooth after login or session refresh.
   * Lazy-injects print services to avoid eager circular deps.
   */
  private async connectPrintHubAfterAuth(): Promise<void> {
    try {
      if (!this.rbacService.isPosOrg() && !this.orgService.isPosOrg()) return;
      const { PosReceiptPrintService } = await import('./pos-receipt-print.service');
      const receiptPrint = this.injector.get(PosReceiptPrintService);
      await receiptPrint.restoreSavedPrinterConnection();
    } catch {
      /* printer optional at login — layout watchdog will retry */
    }
  }
}
