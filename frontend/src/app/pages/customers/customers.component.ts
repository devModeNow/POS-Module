import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { Customer, CustomersService, Vehicle } from '../../shared/services/customers.service';
import { NotificationService } from '../../shared/services/notification.service';

type DrawerMode = 'create' | 'edit';
type ProfileTab = 'vehicles' | 'job-orders' | 'payments' | 'history';

@Component({
  selector: 'app-customers',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, CanDirective],
  templateUrl: './customers.component.html',
})
export class CustomersComponent implements OnInit {
  customers: Customer[] = [];
  search = '';
  isLoading = false;
  isDrawerOpen = false;
  isSaving = false;
  drawerMode: DrawerMode = 'create';
  editingId: number | null = null;

  // Profile drawer
  isProfileOpen = false;
  profileCustomer: Customer | null = null;
  profileTab: ProfileTab = 'vehicles';
  profileVehicles: Vehicle[] = [];
  profileJobOrders: Record<string, unknown>[] = [];
  profilePayments: Record<string, unknown>[] = [];
  profileHistory: Record<string, unknown>[] = [];
  isLoadingProfile = false;

  form = this.emptyForm();

  constructor(
    private readonly svc: CustomersService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void { void this.load(); }

  get filtered(): Customer[] {
    const kw = this.search.trim().toLowerCase();
    if (!kw) return this.customers;
    return this.customers.filter((c) =>
      `${c.name} ${c.contact ?? ''} ${c.email ?? ''}`.toLowerCase().includes(kw));
  }

  async load(): Promise<void> {
    this.isLoading = true;
    try {
      const r = await this.svc.getAll();
      this.customers = r.data ?? [];
    } catch { this.customers = []; }
    finally { this.isLoading = false; }
  }

  openCreate(): void {
    this.form = this.emptyForm();
    this.drawerMode = 'create';
    this.editingId = null;
    this.isDrawerOpen = true;
  }

  openEdit(c: Customer): void {
    this.form = { name: c.name, contact: c.contact ?? '', email: c.email ?? '', address: c.address ?? '' };
    this.drawerMode = 'edit';
    this.editingId = c.id;
    this.isDrawerOpen = true;
  }

  closeDrawer(): void { if (!this.isSaving) this.isDrawerOpen = false; }

  async save(): Promise<void> {
    if (!this.form.name.trim()) { this.notify.warning('Required', 'Customer name is required.'); return; }
    this.isSaving = true;
    try {
      const r = this.drawerMode === 'create'
        ? await this.svc.create(this.form)
        : await this.svc.update(this.editingId!, this.form);
      if (!r.success) { this.notify.error('Failed', r.message ?? 'Operation failed.'); return; }
      this.notify.success('Saved', this.drawerMode === 'create' ? 'Customer created.' : 'Customer updated.');
      this.isDrawerOpen = false;
      await this.load();
    } catch { this.notify.error('Error', 'Unexpected error.'); }
    finally { this.isSaving = false; }
  }

  async openProfile(c: Customer): Promise<void> {
    this.profileCustomer = c;
    this.profileTab = 'vehicles';
    this.isProfileOpen = true;
    await this.loadProfileTab('vehicles');
  }

  closeProfile(): void { this.isProfileOpen = false; this.profileCustomer = null; }

  async switchTab(tab: ProfileTab): Promise<void> {
    this.profileTab = tab;
    await this.loadProfileTab(tab);
  }

  private async loadProfileTab(tab: ProfileTab): Promise<void> {
    if (!this.profileCustomer) return;
    this.isLoadingProfile = true;
    try {
      const id = this.profileCustomer.id;
      if (tab === 'vehicles')    { const r = await this.svc.getVehicles(id);   this.profileVehicles   = r.data ?? []; }
      if (tab === 'job-orders')  { const r = await this.svc.getJobOrders(id);  this.profileJobOrders  = (r.data ?? []) as Record<string, unknown>[]; }
      if (tab === 'payments')    { const r = await this.svc.getPayments(id);   this.profilePayments   = (r.data ?? []) as Record<string, unknown>[]; }
      if (tab === 'history')     { const r = await this.svc.getHistory(id);    this.profileHistory    = (r.data ?? []) as Record<string, unknown>[]; }
    } catch { /* silent */ }
    finally { this.isLoadingProfile = false; }
  }

  private emptyForm() { return { name: '', contact: '', email: '', address: '' }; }
  trackById(_: number, item: { id: number }): number { return item.id; }
}
