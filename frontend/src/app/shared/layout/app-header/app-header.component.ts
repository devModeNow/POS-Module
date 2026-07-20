import { Component, ElementRef, ViewChild } from '@angular/core';
import { SidebarService } from '../../services/sidebar.service';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ThemeToggleButtonComponent } from '../../components/common/theme-toggle/theme-toggle-button.component';
import { UserDropdownComponent } from '../../components/header/user-dropdown/user-dropdown.component';
import { BranchSwitcherComponent } from '../../components/header/branch-switcher/branch-switcher.component';
import { RbacService } from '../../services/rbac.service';
import { PosNotificationsBellComponent } from '../../components/pos/pos-notifications-bell/pos-notifications-bell.component';
import { PosCommunicationsService } from '../../services/pos-communications.service';
import { PosPrintHubService } from '../../services/pos-printhub.service';
import { NotificationService } from '../../services/notification.service';
import { ConfirmDialogComponent } from '../../components/ui/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-header',
  imports: [
    CommonModule,
    RouterModule,
    ThemeToggleButtonComponent,
    UserDropdownComponent,
    BranchSwitcherComponent,
    PosNotificationsBellComponent,
    ConfirmDialogComponent,
  ],
  templateUrl: './app-header.component.html',
})
export class AppHeaderComponent {
  isApplicationMenuOpen = false;
  readonly isMobileOpen$;
  readonly hideSearch: boolean;
  readonly showPosNotifications: boolean;

  printerConnectionType = 'printhub';
  paperWidth = '58mm';
  printHubConnecting = false;
  printerConnectPromptOpen = false;

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  constructor(
    public sidebarService: SidebarService,
    rbac: RbacService,
    private readonly comms: PosCommunicationsService,
    private readonly printHub: PosPrintHubService,
    private readonly notify: NotificationService,
  ) {
    this.isMobileOpen$ = this.sidebarService.isMobileOpen$;
    this.hideSearch = rbac.isPosOrg();
    this.showPosNotifications = rbac.isPosOrg();
    if (this.showPosNotifications) {
      void this.loadPrinterConnectionType().then(async () => {
        await this.autoConnectPrintHub();
        this.maybeShowPrinterConnectPrompt();
      });
    }
  }

  get showPrintHubConnect(): boolean {
    if (!this.showPosNotifications) return false;
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

  handleToggle() {
    if (window.innerWidth >= 1280) {
      this.sidebarService.toggleExpanded();
    } else {
      this.sidebarService.toggleMobileOpen();
    }
  }

  toggleApplicationMenu() {
    this.isApplicationMenuOpen = !this.isApplicationMenuOpen;
  }

  ngAfterViewInit() {
    document.addEventListener('keydown', this.handleKeyDown);
  }

  ngOnDestroy() {
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.searchInput?.nativeElement.focus();
    }
  };
}
