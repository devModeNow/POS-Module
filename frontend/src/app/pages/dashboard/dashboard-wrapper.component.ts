import { Component } from '@angular/core';
import { EcommerceComponent } from './ecommerce/ecommerce.component';
import { OrgDashboardComponent } from './org-dashboard/org-dashboard.component';
import { PosDashboardComponent } from '../pos/dashboard/pos-dashboard.component';
import { RbacService } from '../../shared/services/rbac.service';

@Component({
  selector: 'app-dashboard-wrapper',
  standalone: true,
  imports: [EcommerceComponent, OrgDashboardComponent, PosDashboardComponent],
  template: `
    @if (isPlatform) {
      <app-ecommerce />
    } @else if (isPosOrg) {
      <app-pos-dashboard />
    } @else {
      <app-org-dashboard />
    }
  `,
})
export class DashboardWrapperComponent {
  isPlatform: boolean;
  isPosOrg: boolean;

  constructor(private readonly rbac: RbacService) {
    this.isPlatform = this.rbac.isPlatformUser();
    this.isPosOrg = this.rbac.isPosOrg();
  }
}
