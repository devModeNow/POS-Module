import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { Quotation, QuotationsService } from '../../shared/services/quotations.service';
import { NotificationService } from '../../shared/services/notification.service';

type DrawerMode = 'create' | 'edit';

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  sent:     'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  approved: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400',
  rejected: 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400',
  expired:  'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400',
};

@Component({
  selector: 'app-quotations',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, CanDirective],
  templateUrl: './quotations.component.html',
})
export class QuotationsComponent implements OnInit {
  quotations: Quotation[] = [];
  filterStatus = '';
  isLoading = false;
  isDrawerOpen = false;
  isSaving = false;
  drawerMode: DrawerMode = 'create';
  editingId: number | null = null;

  form = this.emptyForm();

  readonly statuses = ['draft', 'sent', 'approved', 'rejected', 'expired'];

  constructor(
    private readonly svc: QuotationsService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.isLoading = true;
    try {
      const r = await this.svc.getAll(this.filterStatus || undefined);
      this.quotations = r.data ?? [];
    } catch { this.quotations = []; }
    finally { this.isLoading = false; }
  }

  statusClass(status: string): string {
    return STATUS_COLORS[status] ?? STATUS_COLORS['draft'];
  }

  openCreate(): void {
    this.form = this.emptyForm();
    this.drawerMode = 'create';
    this.editingId = null;
    this.isDrawerOpen = true;
  }

  openEdit(q: Quotation): void {
    this.form = {
      customerName: q.customerName,
      contact: q.contact ?? '',
      vehiclePlate: q.vehiclePlate ?? '',
      laborFee: q.laborFee ?? 0,
      discount: q.discount ?? 0,
      totalAmount: q.totalAmount ?? 0,
      validUntil: q.validUntil ?? '',
      notes: q.notes ?? '',
    };
    this.drawerMode = 'edit';
    this.editingId = q.id;
    this.isDrawerOpen = true;
  }

  closeDrawer(): void { if (!this.isSaving) this.isDrawerOpen = false; }

  async save(): Promise<void> {
    if (!this.form.customerName.trim()) { this.notify.warning('Required', 'Customer name is required.'); return; }
    this.isSaving = true;
    try {
      const r = this.drawerMode === 'create'
        ? await this.svc.create(this.form)
        : await this.svc.update(this.editingId!, this.form);
      if (!r.success) { this.notify.error('Failed', r.message ?? 'Operation failed.'); return; }
      this.notify.success('Saved', this.drawerMode === 'create' ? 'Quotation created.' : 'Quotation updated.');
      this.isDrawerOpen = false;
      await this.load();
    } catch { this.notify.error('Error', 'Unexpected error.'); }
    finally { this.isSaving = false; }
  }

  async updateStatus(q: Quotation, status: string): Promise<void> {
    try {
      await this.svc.updateStatus(q.id, status);
      this.notify.success('Updated', `Status changed to ${status}.`);
      await this.load();
    } catch { this.notify.error('Error', 'Failed to update status.'); }
  }

  private emptyForm() {
    return { customerName: '', contact: '', vehiclePlate: '', laborFee: 0, discount: 0, totalAmount: 0, validUntil: '', notes: '' };
  }
}
