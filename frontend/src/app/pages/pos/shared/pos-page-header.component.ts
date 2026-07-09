import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ConfirmDialogComponent } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import { AuthService } from '../../../shared/services/auth.service';
import { BusinessSettingsService } from '../../../shared/services/business-settings.service';
import { OrgService } from '../../../shared/services/org.service';
import { RbacService } from '../../../shared/services/rbac.service';

@Component({
  selector: 'app-pos-page-header',
  standalone: true,
  imports: [CommonModule, RouterLink, ConfirmDialogComponent],
  templateUrl: './pos-page-header.component.html',
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
  readonly isCashierMode: boolean;

  constructor(
    private readonly rbac: RbacService,
    private readonly orgService: OrgService,
    private readonly businessSettings: BusinessSettingsService,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    this.isCashierMode = rbac.isCashier();
  }

  get displayTitle(): string {
    return this.title.trim() || this.cashierName || 'Cashier';
  }

  get displaySubtitle(): string {
    return this.subtitle.trim() || this.companyName || 'POS';
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
}
