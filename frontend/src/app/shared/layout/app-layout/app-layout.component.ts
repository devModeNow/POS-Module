import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { AppHeaderComponent } from '../app-header/app-header.component';
import { AppSidebarComponent } from '../app-sidebar/app-sidebar.component';
import { BackdropComponent } from '../backdrop/backdrop.component';
import { GlobalActionLoaderComponent } from '../../components/common/global-action-loader/global-action-loader.component';
import { PosChatWidgetComponent } from '../../components/pos/pos-chat-widget/pos-chat-widget.component';
import { PosReceiptPrintService } from '../../services/pos-receipt-print.service';
import { RbacService } from '../../services/rbac.service';
import { SidebarService } from '../../services/sidebar.service';

@Component({
  selector: 'app-layout',
  imports: [
    CommonModule,
    RouterModule,
    AppHeaderComponent,
    AppSidebarComponent,
    BackdropComponent,
    GlobalActionLoaderComponent,
    PosChatWidgetComponent,
  ],
  templateUrl: './app-layout.component.html',
})
export class AppLayoutComponent implements OnInit, OnDestroy {
  readonly isExpanded$;
  readonly isHovered$;
  readonly isMobileOpen$;
  readonly isCashierMode: boolean;
  readonly showPosChat: boolean;
  isPosDashboardRoute = false;
  private routeSub?: Subscription;
  private printerWatchTimer?: ReturnType<typeof setInterval>;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible' && this.showPosChat) {
      void this.receiptPrint.ensurePrinterConnectedInBackground();
    }
  };

  constructor(
    public sidebarService: SidebarService,
    private readonly router: Router,
    private readonly receiptPrint: PosReceiptPrintService,
    rbac: RbacService,
  ) {
    this.isExpanded$ = this.sidebarService.isExpanded$;
    this.isHovered$ = this.sidebarService.isHovered$;
    this.isMobileOpen$ = this.sidebarService.isMobileOpen$;
    this.isCashierMode = rbac.isCashier();
    this.showPosChat = rbac.isPosOrg();
  }

  ngOnInit(): void {
    this.syncPosDashboardRoute(this.router.url);
    this.routeSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.syncPosDashboardRoute(e.urlAfterRedirects));
    if (this.showPosChat) {
      // Connect as soon as POS layout loads, then keep watching.
      void this.receiptPrint.restoreSavedPrinterConnection();
      void this.receiptPrint.ensurePrinterConnectedInBackground();
      this.printerWatchTimer = setInterval(
        () => void this.receiptPrint.ensurePrinterConnectedInBackground(),
        8_000,
      );
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('focus', this.onWindowFocus);
    }
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    if (this.printerWatchTimer) clearInterval(this.printerWatchTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('focus', this.onWindowFocus);
  }

  private readonly onWindowFocus = () => {
    if (this.showPosChat) {
      void this.receiptPrint.ensurePrinterConnectedInBackground();
    }
  };

  private syncPosDashboardRoute(url: string): void {
    this.isPosDashboardRoute = /\/users\/pos-(dashboard|terminal|my-sales|staff|audit-trail|company-profile)(\/|$|\?)/.test(url);
  }
}
