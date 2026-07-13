import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ConfirmDialogComponent } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import { PosNotificationsBellComponent } from '../../../shared/components/pos/pos-notifications-bell/pos-notifications-bell.component';
import { PosPrinterSettingsPanelComponent } from '../../../shared/components/pos/pos-printer-settings-panel/pos-printer-settings-panel.component';
import { AuthService } from '../../../shared/services/auth.service';
import { BusinessSettingsService } from '../../../shared/services/business-settings.service';
import { OrgService } from '../../../shared/services/org.service';
import { RbacService } from '../../../shared/services/rbac.service';

@Component({
  selector: 'app-pos-page-header',
  standalone: true,
  imports: [CommonModule, RouterLink, ConfirmDialogComponent, PosNotificationsBellComponent, PosPrinterSettingsPanelComponent],
  templateUrl: './pos-page-header.component.html',
  styles: `:host { display: block; flex-shrink: 0; position: relative; z-index: 100; }`,
})
export class PosPageHeaderComponent implements OnInit {
  /** Override the main title; defaults to the signed-in cashier name. */
  @Input() title = '';
  /** Override the subtitle; defaults to the company name. */
  @Input() subtitle = '';
  @Input() showActions = true;

  cashierName = '';
  companyName = '';
  confirmOpen = false;
  printerModalOpen = false;
  readonly isCashierMode: boolean;
  readonly isPosOrg: boolean;

  constructor(
    private readonly rbac: RbacService,
    private readonly orgService: OrgService,
    private readonly businessSettings: BusinessSettingsService,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    this.isCashierMode = rbac.isCashier();
    this.isPosOrg = rbac.isPosOrg();
  }

  get displayTitle(): string {
    return this.title.trim() || this.cashierName || 'Cashier';
  }

  get displaySubtitle(): string {
    const company = this.subtitle.trim() || this.companyName || 'POS';
    const role = this.formatRoleLabel(this.rbac.getRoleName());
    return `${role} · ${company}`;
  }

  private formatRoleLabel(role: string): string {
    const normalized = String(role ?? '').trim();
    if (!normalized) return 'Cashier';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  get posHomeRoute(): string {
    const menus = this.rbac.getAllowedMenus();
    if (menus.has('pos-terminal') && !menus.has('pos-dashboard')) {
      return '/users/pos-terminal';
    }
    return '/users/pos-dashboard';
  }

  get isOnPosHome(): boolean {
    const url = this.router.url.split('?')[0] ?? '';
    return url.includes('/pos-dashboard') || url.includes('/pos-terminal');
  }

  get showCashierNav(): boolean {
    return this.showActions && this.isCashierMode;
  }

  ngOnInit(): void {
    this.cashierName = this.rbac.getDisplayName();
    this.companyName = this.orgService.getContext().name ?? 'POS';
    void this.loadCompanyName();
  }

  async loadCompanyName(): Promise<void> {
    try {
      const profile = await this.businessSettings.getBusinessProfile();
      this.companyName = String(profile?.businessName ?? this.companyName).trim() || this.companyName;
    } catch {
      /* keep org name */
    }
  }

  requestLogout(): void {
    this.confirmOpen = true;
  }

  async confirmLogout(): Promise<void> {
    this.confirmOpen = false;
    this.auth.logout();
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }

  cancelLogout(): void {
    this.confirmOpen = false;
  }

  openPrinterSettings(): void {
    this.printerModalOpen = true;
  }

  closePrinterSettings(): void {
    this.printerModalOpen = false;
  }
}
