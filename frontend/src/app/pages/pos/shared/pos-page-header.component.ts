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
import { PosCommunicationsService } from '../../../shared/services/pos-communications.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { PosPrintHubService } from '../../../shared/services/pos-printhub.service';
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
  printerConnectPromptOpen = false;
  printerModalOpen = false;
  currentPath = '';
  printerConnectionType = 'printhub';
  paperWidth = '58mm';
  printHubConnecting = false;
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
    private readonly comms: PosCommunicationsService,
    private readonly printHub: PosPrintHubService,
    private readonly notify: NotificationService,
  ) {
    this.isCashierMode = rbac.isCashier();
    this.isPosOrg = rbac.isPosOrg();
    this.currentPath = this.normalizePath(this.router.url);
  }

  get showPrintHubConnect(): boolean {
    if (!this.isPosOrg || !this.showPosTools) return false;
    if (this.printerConnectionType === 'printhub') return true;
    try {
      return localStorage.getItem('pos.printerConnectionType') === 'printhub'
        || !!localStorage.getItem('pos.printhub.btDeviceId');
    } catch {
      return false;
    }
  }

  get printHubConnected(): boolean {
    return this.printHub.isConnected();
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
    void this.loadPrinterConnectionType().then(() => {
      void this.autoConnectPrintHub().then(() => this.maybeShowPrinterConnectPrompt());
    });
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.currentPath = this.normalizePath(e.urlAfterRedirects || e.url);
        this.maybeShowPrinterConnectPrompt();
      });
  }

  async loadPrinterConnectionType(): Promise<void> {
    try {
      const r = await this.comms.getPrinterSettings();
      const item = r?.item ?? {};
      let type = String(item['posPrinterConnectionType'] ?? 'printhub');
      if (type === 'bluetooth' || type === 'mharmal' || !type) type = 'printhub';
      try {
        if (localStorage.getItem('pos.printerConnectionType') === 'printhub') type = 'printhub';
        if (localStorage.getItem('pos.printhub.btDeviceId')) type = 'printhub';
      } catch {
        /* ignore */
      }
      this.printerConnectionType = type;
      this.paperWidth = String(item['posReceiptPaperWidth'] ?? '58mm');
    } catch {
      this.printerConnectionType = 'printhub';
    }
  }

  private async autoConnectPrintHub(): Promise<void> {
    if (!this.showPrintHubConnect) return;
    if (this.printHub.isConnected()) return;
    await this.printHub.autoConnect(this.paperWidth);
  }

  private maybeShowPrinterConnectPrompt(): void {
    if (!this.showPrintHubConnect) return;
    if (this.printHub.isConnected()) {
      // Clear stale prompt if silent reconnect already succeeded.
      if (this.printHub.hasConnectPrompt()) this.printHub.consumeConnectPrompt();
      return;
    }
    if (this.printHub.consumeConnectPrompt()) {
      this.printerConnectPromptOpen = true;
    }
  }

  dismissPrinterConnectPrompt(): void {
    this.printerConnectPromptOpen = false;
  }

  async confirmPrinterConnectPrompt(): Promise<void> {
    this.printerConnectPromptOpen = false;
    await this.connectPrintHub();
  }

  async connectPrintHub(): Promise<void> {
    if (this.printHubConnecting) return;
    this.printHubConnecting = true;
    try {
      // Always open the Bluetooth picker so users can switch printers.
      const r = await this.printHub.connect(this.paperWidth, 'bluetooth', { forcePicker: true });
      if (r.success) {
        try {
          localStorage.setItem('pos.printerConnectionType', 'printhub');
        } catch {
          /* ignore */
        }
        this.printerConnectionType = 'printhub';
        this.notify.success('Printer connected', r.message ?? 'PrintHub is ready. Sales will print here — no browser dialog.');
      } else {
        this.notify.error('Printer not connected', r.message ?? 'Could not connect via PrintHub.');
      }
    } finally {
      this.printHubConnecting = false;
    }
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
    void this.loadPrinterConnectionType();
  }
}
