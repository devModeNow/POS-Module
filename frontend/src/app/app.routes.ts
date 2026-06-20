import { Routes } from '@angular/router';
import { EcommerceComponent } from './pages/dashboard/ecommerce/ecommerce.component';
import { DashboardWrapperComponent } from './pages/dashboard/dashboard-wrapper.component';
import { NotFoundComponent } from './pages/other-page/not-found/not-found.component';
import { AppLayoutComponent } from './shared/layout/app-layout/app-layout.component';
import { SignInComponent } from './pages/auth-pages/sign-in/sign-in.component';
import { authChildGuard, guestOnlyGuard, guestOnlyMatchGuard, rbacGuard } from './shared/guards/auth.guards';
import { UserManagementComponent } from './pages/user-management/user-management.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { OrganizationsComponent } from './pages/organizations/organizations.component';
import { ComingSoonComponent } from './pages/coming-soon/coming-soon.component';
import { CustomersComponent } from './pages/customers/customers.component';
import { QuotationsComponent } from './pages/quotations/quotations.component';
import { JobOrdersComponent } from './pages/job-orders/job-orders.component';
import { InventoryComponent } from './pages/inventory/inventory.component';
import { ReportsComponent } from './pages/reports/reports.component';
import { AccountingComponent } from './pages/accounting/accounting.component';
import { FinanceComponent } from './pages/finance/finance.component';
import { CateringDashboardComponent } from './pages/catering/dashboard/catering-dashboard.component';
import { CateringSchedulesComponent } from './pages/catering/schedules/catering-schedules.component';
import { CateringMenusComponent } from './pages/catering/menus/catering-menus.component';
import { SchedulingFormComponent } from './pages/catering/public/scheduling-form/scheduling-form.component';
import { RatingPageComponent } from './pages/catering/public/rating-page/rating-page.component';
import { SetupComponent } from './pages/setup/setup.component';

/** Helper to create a coming-soon route for an org module */
function orgRoute(path: string, menuKey: string, title: string) {
  return {
    path,
    component: ComingSoonComponent,
    canActivate: [rbacGuard],
    data: { menu: menuKey, permission: 'canRead', routeKey: path },
    title,
  };
}

export const routes: Routes = [
  {
    path: 'users',
    component: AppLayoutComponent,
    canActivateChild: [authChildGuard],
    children: [
      // ── Platform menus ──────────────────────────────────────────────────
      {
        path: 'dashboard',
        component: DashboardWrapperComponent,
        canActivate: [rbacGuard],
        data: { menu: 'dashboard', permission: 'canRead' },
        pathMatch: 'full',
        title: 'Dashboard',
      },
      {
        path: 'organizations',
        component: OrganizationsComponent,
        canActivate: [rbacGuard],
        data: { menu: 'organizations', permission: 'canRead' },
        title: 'Organizations',
      },
      {
        path: 'user-management',
        component: UserManagementComponent,
        canActivate: [rbacGuard],
        data: { menu: 'user_management', permission: 'canRead' },
        title: 'User Management',
      },
      {
        path: 'settings',
        component: SettingsComponent,
        canActivate: [rbacGuard],
        data: { menu: 'settings', permission: 'canRead' },
        title: 'Settings',
      },

      // ── Org menus (Phase 2) ──────────────────────────────────────────────
      {
        path: 'customers',
        component: CustomersComponent,
        canActivate: [rbacGuard],
        data: { menu: 'customers', permission: 'canRead' },
        title: 'Customers',
      },
      {
        path: 'quotations',
        component: QuotationsComponent,
        canActivate: [rbacGuard],
        data: { menu: 'quotations', permission: 'canRead' },
        title: 'Quotations',
      },
      {
        path: 'job-orders',
        component: JobOrdersComponent,
        canActivate: [rbacGuard],
        data: { menu: 'job-orders', permission: 'canRead' },
        title: 'Job Orders',
      },
      {
        path: 'inventory',
        component: InventoryComponent,
        canActivate: [rbacGuard],
        data: { menu: 'inventory', permission: 'canRead' },
        title: 'Inventory',
      },
      {
        path: 'reports',
        component: ReportsComponent,
        canActivate: [rbacGuard],
        data: { menu: 'reports', permission: 'canRead' },
        title: 'Reports',
      },
      {
        path: 'accounting',
        component: AccountingComponent,
        canActivate: [rbacGuard],
        data: { menu: 'accounting', permission: 'canRead' },
        title: 'Accounting',
      },
      orgRoute('vehicles',        'vehicles',        'Vehicles'),
      orgRoute('technicians',     'technicians',     'Technicians'),
      orgRoute('invoices',        'invoices',        'Invoices'),
      orgRoute('service-history', 'service-history', 'Service History'),
      orgRoute('sales',           'sales',           'Sales'),
      {
        path: 'finance',
        component: FinanceComponent,
        canActivate: [rbacGuard],
        data: { menu: 'finance', permission: 'canRead' },
        title: 'Finance',
      },

      // ── Catering menus ──────────────────────────────────────────────────
      {
        path: 'catering-dashboard',
        component: CateringDashboardComponent,
        canActivate: [rbacGuard],
        data: { menu: 'catering-dashboard', permission: 'canRead' },
        title: 'Catering Dashboard',
      },
      {
        path: 'catering-schedules',
        component: CateringSchedulesComponent,
        canActivate: [rbacGuard],
        data: { menu: 'catering-schedules', permission: 'canRead' },
        title: 'Catering Schedules',
      },
      {
        path: 'catering-menus',
        component: CateringMenusComponent,
        canActivate: [rbacGuard],
        data: { menu: 'catering-menus', permission: 'canRead' },
        title: 'Catering Menus',
      },
    ],
  },

  // ── Public catering routes (no authentication required) ─────────────────
  {
    path: 'catering/schedule',
    component: SchedulingFormComponent,
    title: 'Catering Schedule Request',
  },
  {
    path: 'catering/rate/:token',
    component: RatingPageComponent,
    title: 'Rate Your Experience',
  },

  {
    path: 'setup',
    component: SetupComponent,
    title: 'Database Setup',
  },

  {
    path: '',
    component: SignInComponent,
    canActivate: [guestOnlyGuard],
    canMatch: [guestOnlyMatchGuard],
    title: 'Login',
  },
  {
    path: '**',
    component: NotFoundComponent,
    title: 'Not Found',
  },
];
