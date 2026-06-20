import { Component } from '@angular/core';
import { EcommerceComponent } from './ecommerce/ecommerce.component';
import { OrgDashboardComponent } from './org-dashboard/org-dashboard.component';
import { RbacService } from '../../shared/services/rbac.service';

@Component({
  selector: 'app-dashboard-wrapper',
  imports: [EcommerceComponent, OrgDashboardComponent],
  template: `
    @if (isPlatform) {
      <app-ecommerce />
    } @else {
      <app-org-dashboard />
    }
  `,
})
export class DashboardWrapperComponent {
  isPlatform: boolean;

  constructor(private readonly rbac: RbacService) {
    this.isPlatform = this.rbac.isPlatformUser();
  }
}
