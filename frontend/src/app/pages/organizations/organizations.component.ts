import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { NotificationService } from '../../shared/services/notification.service';
import { OrgListItem, OrgService } from '../../shared/services/org.service';

@Component({
  selector: 'app-organizations',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './organizations.component.html',
})
export class OrganizationsComponent implements OnInit {
  orgs: OrgListItem[] = [];
  isLoading = false;
  isSubmitting = false;
  errorMessage = '';
  search = '';

  isDrawerOpen = false;
  drawerMode: 'create' | 'edit' = 'create';
  editingId: number | null = null;

  form = this.emptyForm();

  constructor(
    private readonly orgService: OrgService,
    private readonly notificationService: NotificationService,
  ) {}

  ngOnInit(): void {
    void this.loadOrgs();
  }

  get filtered(): OrgListItem[] {
    const kw = this.search.trim().toLowerCase();
    if (!kw) return this.orgs;
    return this.orgs.filter((o) =>
      `${o.code} ${o.name} ${o.address ?? ''} ${o.email ?? ''}`.toLowerCase().includes(kw),
    );
  }

  async loadOrgs(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const res = await this.orgService.getAll();
      if (!res.success) { this.errorMessage = res.message ?? 'Failed to load organizations'; return; }
      this.orgs = res.data ?? [];
    } catch (e: unknown) {
      this.errorMessage = e instanceof Error ? e.message : 'Failed to load organizations';
    } finally {
      this.isLoading = false;
    }
  }

  openCreate(): void {
    this.form = this.emptyForm();
    this.drawerMode = 'create';
    this.editingId = null;
    this.isDrawerOpen = true;
  }

  openEdit(org: OrgListItem): void {
    this.form = {
      code:        org.code,
      name:        org.name,
      description: org.description ?? '',
      address:     org.address ?? '',
      contact:     org.contact ?? '',
      email:       org.email ?? '',
    };
    this.drawerMode = 'edit';
    this.editingId = org.id;
    this.isDrawerOpen = true;
  }

  closeDrawer(): void {
    if (this.isSubmitting) return;
    this.isDrawerOpen = false;
    this.editingId = null;
  }

  async submit(): Promise<void> {
    if (this.isSubmitting) return;
    const name = this.form.name.trim();
    const code = this.form.code.trim();
    if (!name || !code) {
      this.notificationService.warning('Incomplete Form', 'Code and name are required.');
      return;
    }

    this.isSubmitting = true;
    try {
      if (this.drawerMode === 'create') {
        const res = await this.orgService.create({
          code, name,
          description: this.form.description || undefined,
          address:     this.form.address || undefined,
          contact:     this.form.contact || undefined,
          email:       this.form.email || undefined,
        });
        if (!res.success) { this.notificationService.error('Create Failed', res.message ?? 'Failed to create organization'); return; }
        this.notificationService.success('Organization Created', `${name} has been added.`);
      } else {
        const res = await this.orgService.update(this.editingId!, {
          code, name,
          description: this.form.description || undefined,
          address:     this.form.address || undefined,
          contact:     this.form.contact || undefined,
          email:       this.form.email || undefined,
        });
        if (!res.success) { this.notificationService.error('Update Failed', res.message ?? 'Failed to update organization'); return; }
        this.notificationService.success('Organization Updated', `${name} has been updated.`);
      }
      this.isDrawerOpen = false;
      await this.loadOrgs();
    } catch (e: unknown) {
      this.notificationService.error('Error', e instanceof Error ? e.message : 'An error occurred');
    } finally {
      this.isSubmitting = false;
    }
  }

  async toggleActive(org: OrgListItem): Promise<void> {
    const action = org.isActive ? 'deactivate' : 'activate';
    if (!window.confirm(`${org.isActive ? 'Deactivate' : 'Activate'} ${org.name}?`)) return;
    try {
      const res = org.isActive
        ? await this.orgService.deactivate(org.id)
        : await this.orgService.activate(org.id);
      if (!res.success) { this.notificationService.error('Failed', res.message ?? `Failed to ${action}`); return; }
      this.notificationService.success('Done', `${org.name} has been ${action}d.`);
      await this.loadOrgs();
    } catch (e: unknown) {
      this.notificationService.error('Error', e instanceof Error ? e.message : 'An error occurred');
    }
  }

  trackById(_: number, org: OrgListItem): number { return org.id; }

  private emptyForm() {
    return { code: '', name: '', description: '', address: '', contact: '', email: '' };
  }
}
