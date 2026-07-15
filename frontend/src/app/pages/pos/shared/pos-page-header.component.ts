import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
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
  styles: `:host { display: block; flex-shrink: 0; position: relative; z-index: 120; isolation: isolate; }`,
})
export class PosPageHeaderComponent implements OnInit {
  /** Override the main title; defaults to the signed-in cashier name. */
  @Input() title = '';
  /** Override the subtitle; defaults to the company name. */
  @Input() subtitle = '';
  @Input() showActions = true;
  /** Show notification bell and printer icon (cashier POS). Hide on admin sub-pages that use app-header. */
  @Input() showPosTools = true;

  cashierName = '';
  companyName = '';
  confirmOpen = false;
  printerModalOpen = false;
  currentPath = '';
  readonly isCashierMode: boolean;
  readonly isPosOrg: boolean;

  private readonly navActiveClass =
    'touch-manipulation rounded-md border border-brand-500 bg-brand-50 p-2.5 text-brand-600 hover:bg-brand-100 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/20';
  private readonly navIdleClass =
    'touch-manipulation rounded-md border border-gray-300 p-2.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';

  constructor(
    private readonly rbac: RbacService,
    private readonly orgService: OrgService,
    private readonly businessSettings: BusinessSettingsService,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    this.isCashierMode = rbac.isCashier();
    this.isPosOrg = rbac.isPosOrg();
    this.currentPath = this.normalizePath(this.router.url);
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
    return this.currentPath.includes('/pos-dashboard') || this.currentPath.includes('/pos-terminal');
  }

  get isOnMySales(): boolean {
    return this.currentPath.includes('/pos-my-sales');
  }

  get isOnProfile(): boolean {
    return this.currentPath === '/profile' || this.currentPath.startsWith('/profile/');
  }

  navClass(active: boolean): string {
    return active ? this.navActiveClass : this.navIdleClass;
  }

  get showCashierNav(): boolean {
    return this.showActions && this.isCashierMode;
  }

  ngOnInit(): void {
    this.cashierName = this.rbac.getDisplayName();
    this.companyName = this.orgService.getContext().name ?? 'POS';
    void this.loadCompanyName();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.currentPath = this.normalizePath(e.urlAfterRedirects || e.url);
      });
  }

  private normalizePath(url: string): string {
    return (url.split('?')[0] ?? '').split('#')[0] ?? '';
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
