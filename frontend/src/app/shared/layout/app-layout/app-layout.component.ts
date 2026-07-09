import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { AppHeaderComponent } from '../app-header/app-header.component';
import { AppSidebarComponent } from '../app-sidebar/app-sidebar.component';
import { BackdropComponent } from '../backdrop/backdrop.component';
import { GlobalActionLoaderComponent } from '../../components/common/global-action-loader/global-action-loader.component';
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
  ],
  templateUrl: './app-layout.component.html',
})
export class AppLayoutComponent implements OnInit, OnDestroy {
  readonly isExpanded$;
  readonly isHovered$;
  readonly isMobileOpen$;
  readonly isCashierMode: boolean;
  isPosDashboardRoute = false;
  private routeSub?: Subscription;

  constructor(
    public sidebarService: SidebarService,
    private readonly router: Router,
    rbac: RbacService,
  ) {
    this.isExpanded$ = this.sidebarService.isExpanded$;
    this.isHovered$ = this.sidebarService.isHovered$;
    this.isMobileOpen$ = this.sidebarService.isMobileOpen$;
    this.isCashierMode = rbac.isCashier();
  }

  ngOnInit(): void {
    this.syncPosDashboardRoute(this.router.url);
    this.routeSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.syncPosDashboardRoute(e.urlAfterRedirects));
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  private syncPosDashboardRoute(url: string): void {
    this.isPosDashboardRoute = url.includes('/pos-dashboard') || url.includes('/pos-terminal');
  }
}
