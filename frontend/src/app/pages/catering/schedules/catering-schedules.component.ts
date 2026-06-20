import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { NotificationService } from '../../../shared/services/notification.service';
import { apiClient } from '../../../shared/services/api-client';

type ScheduleStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface Schedule {
  id: number;
  customerName: string;
  contactNumber: string;
  venue: string;
  eventDate: string;
  eventTime: string | null;
  pax: number;
  packageId: number | null;
  packageName: string;
  pricePerHead: number;
  paymentMethod: string | null;
  paymentReference: string | null;
  chequeIssuedBy: string | null;
  chequePostDated: string | null;
  chequeAmount: number | null;
  isFloatingSales: boolean;
  discountAmount: number;
  discountType: string;
  notes: string | null;
  status: ScheduleStatus;
}

interface CateringPackage {
  id: number;
  name: string;
  pricePerHead: number;
  minPax: number;
  items: PackageItem[];
}

interface PackageItem {
  menuItemId: number;
  menuItemName: string;
  category: string;
  selectionLimit: number;
  imageUrl: string | null;
}

interface CategoryGroup {
  category: string;
  items: PackageItem[];
  selectionLimit: number;
}

interface MenuSelection {
  menuItemId: number;
  menuItemName: string;
  category: string;
  imageUrl: string | null;
}

type ExpenseCategory =
  | 'Purchases'
  | 'Rental'
  | 'Electricity & Water'
  | 'Communication'
  | 'Salaries & Wages'
  | 'Supplies & Materials'
  | 'Repair & Maintenance'
  | 'Travel & Transportation'
  | 'Representation'
  | 'SSS'
  | 'Philhealth'
  | 'Pag IBIG'
  | 'Taxes'
  | 'Licenses'
  | 'Professional Fee'
  | 'Miscellaneous';

interface ExpenseEntry {
  category: ExpenseCategory;
  amount: number;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Purchases',
  'Rental',
  'Electricity & Water',
  'Communication',
  'Salaries & Wages',
  'Supplies & Materials',
  'Repair & Maintenance',
  'Travel & Transportation',
  'Representation',
  'SSS',
  'Philhealth',
  'Pag IBIG',
  'Taxes',
  'Licenses',
  'Professional Fee',
  'Miscellaneous',
];

@Component({
  selector: 'app-catering-schedules',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent],
  templateUrl: './catering-schedules.component.html',
})
export class CateringSchedulesComponent implements OnInit {
  activeTab: ScheduleStatus = 'pending';
  pendingSchedules: Schedule[] = [];
  inProgressSchedules: Schedule[] = [];
  completedSchedules: Schedule[] = [];
  cancelledSchedules: Schedule[] = [];

  isLoading = false;
  isConfirming = false;
  isCancelling = false;
  isCompleting = false;
  isSavingPackage = false;

  // Drawer state
  showDrawer = false;
  selectedSchedule: Schedule | null = null;

  // Editable form in drawer
  drawerForm = {
    customerName: '',
    contactNumber: '',
    venue: '',
    eventDate: '',
    eventTime: '',
    pax: 0,
    paymentMethod: '',
    paymentReference: '',
    chequeIssuedBy: '',
    chequePostDated: '',
    chequeAmount: 0,
    isFloatingSales: false,
    discountAmount: 0,
    discountType: 'fixed',
    notes: '',
  };
  isSavingDetails = false;
  hasDetailsChanged = false;

  // Menu selections
  menuSelections: MenuSelection[] = [];
  isLoadingSelections = false;

  readonly paymentMethods = ['CASH', 'GCASH', 'BANK TRANSFER', 'CHEQUE', 'BILLED'];

  // Rating link state
  generatedRatingLink = '';
  isGeneratingLink = false;
  linkCopied = false;

  // Package state
  packages: CateringPackage[] = [];
  selectedPackageId: number | null = null;
  packageChanged = false;

  // Package selection in drawer
  drawerCategoryGroups: CategoryGroup[] = [];
  drawerMenuSelections: Record<string, Set<number>> = {};

  // Expense modal state
  showExpenseModal = false;
  expenseForm: Record<ExpenseCategory, number> = this.emptyExpenseForm();
  expenseError = '';

  readonly expenseCategories = EXPENSE_CATEGORIES;
  readonly tabs: { key: ScheduleStatus; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'in_progress', label: 'In-Progress' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  constructor(private readonly notify: NotificationService) {}

  ngOnInit(): void {
    void this.loadAll();
    void this.loadPackages();
  }

  setTab(tab: ScheduleStatus): void {
    this.activeTab = tab;
  }

  get currentSchedules(): Schedule[] {
    switch (this.activeTab) {
      case 'pending':
        return this.pendingSchedules;
      case 'in_progress':
        return this.inProgressSchedules;
      case 'completed':
        return this.completedSchedules;
      case 'cancelled':
        return this.cancelledSchedules;
    }
  }

  getTabCount(key: ScheduleStatus): number {
    switch (key) {
      case 'pending':
        return this.pendingSchedules.length;
      case 'in_progress':
        return this.inProgressSchedules.length;
      case 'completed':
        return this.completedSchedules.length;
      case 'cancelled':
        return this.cancelledSchedules.length;
    }
  }

  async loadAll(): Promise<void> {
    this.isLoading = true;
    try {
      const [pending, inProgress, completed, cancelled] = await Promise.all([
        this.fetchSchedules('pending'),
        this.fetchSchedules('in_progress'),
        this.fetchSchedules('completed'),
        this.fetchSchedules('cancelled'),
      ]);
      this.pendingSchedules = pending;
      this.inProgressSchedules = inProgress;
      this.completedSchedules = completed;
      this.cancelledSchedules = cancelled;
    } catch {
      this.notify.error('Error', 'Failed to load schedules.');
    } finally {
      this.isLoading = false;
    }
  }

  private async fetchSchedules(status: string): Promise<Schedule[]> {
    const r = await apiClient.get<{ success: boolean; data?: Schedule[] }>(
      '/api/catering/schedules',
      { params: { status } },
    );
    return r.data?.data ?? [];
  }

  async loadPackages(): Promise<void> {
    try {
      const r = await apiClient.get<{ success: boolean; data?: CateringPackage[] }>(
        '/api/catering/menus/packages',
      );
      this.packages = r.data?.data ?? [];
    } catch {
      // Silently fail — packages will just be empty
    }
  }

  // Drawer methods
  openDrawer(schedule: Schedule): void {
    this.selectedSchedule = schedule;
    this.selectedPackageId = schedule.packageId;
    this.packageChanged = false;
    this.hasDetailsChanged = false;
    this.showDrawer = true;

    // Populate editable form
    this.drawerForm = {
      customerName: schedule.customerName,
      contactNumber: schedule.contactNumber,
      venue: schedule.venue,
      eventDate: schedule.eventDate ? schedule.eventDate.substring(0, 10) : '',
      eventTime: schedule.eventTime || '',
      pax: schedule.pax,
      paymentMethod: schedule.paymentMethod || '',
      paymentReference: schedule.paymentReference || '',
      chequeIssuedBy: schedule.chequeIssuedBy || '',
      chequePostDated: schedule.chequePostDated ? schedule.chequePostDated.substring(0, 10) : '',
      chequeAmount: Number(schedule.chequeAmount) || 0,
      isFloatingSales: schedule.isFloatingSales ?? false,
      discountAmount: Number(schedule.discountAmount) || 0,
      discountType: schedule.discountType || 'fixed',
      notes: schedule.notes || '',
    };

    // Load menu selections
    this.loadMenuSelections(schedule.id);

    // Initialize menu selection for current package
    const currentPkg = this.packages.find(p => p.id === Number(schedule.packageId));
    if (currentPkg) {
      this.buildDrawerCategoryGroups(currentPkg);
    }
  }

  closeDrawer(): void {
    if (this.isSavingPackage || this.isConfirming || this.isCancelling || this.isSavingDetails) return;
    this.showDrawer = false;
    this.selectedSchedule = null;
    this.selectedPackageId = null;
    this.packageChanged = false;
    this.hasDetailsChanged = false;
    this.generatedRatingLink = '';
    this.linkCopied = false;
    this.menuSelections = [];
  }

  onPackageChange(): void {
    if (this.selectedSchedule) {
      this.packageChanged = this.selectedPackageId !== this.selectedSchedule.packageId;
    }
  }

  selectDrawerPackage(pkg: CateringPackage): void {
    this.selectedPackageId = pkg.id;
    this.packageChanged = this.selectedPackageId !== this.selectedSchedule?.packageId;
    this.buildDrawerCategoryGroups(pkg);
  }

  private buildDrawerCategoryGroups(pkg: CateringPackage): void {
    const groupMap = new Map<string, { items: PackageItem[]; selectionLimit: number }>();
    for (const item of pkg.items) {
      if (!groupMap.has(item.category)) {
        groupMap.set(item.category, { items: [], selectionLimit: item.selectionLimit });
      }
      groupMap.get(item.category)!.items.push(item);
    }
    this.drawerCategoryGroups = [...groupMap.entries()].map(([category, data]) => ({
      category,
      items: data.items,
      selectionLimit: data.selectionLimit,
    }));
    // Initialize selections
    this.drawerMenuSelections = {};
    for (const group of this.drawerCategoryGroups) {
      this.drawerMenuSelections[group.category] = new Set<number>();
    }
  }

  toggleDrawerMenuItem(category: string, itemId: number): void {
    const selections = this.drawerMenuSelections[category];
    if (!selections) return;
    const group = this.drawerCategoryGroups.find(g => g.category === category);
    if (!group) return;
    if (selections.has(itemId)) {
      selections.delete(itemId);
    } else {
      if (selections.size >= group.selectionLimit) {
        const first = [...selections][0];
        selections.delete(first);
      }
      selections.add(itemId);
    }
    this.packageChanged = true;
  }

  isDrawerMenuItemSelected(category: string, itemId: number): boolean {
    return this.drawerMenuSelections[category]?.has(itemId) ?? false;
  }

  getDrawerSelectionCount(category: string): number {
    return this.drawerMenuSelections[category]?.size ?? 0;
  }

  formatCategory(category: string): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  // Menu selections loading
  async loadMenuSelections(scheduleId: number): Promise<void> {
    this.isLoadingSelections = true;
    try {
      const r = await apiClient.get<{ success: boolean; data?: MenuSelection[] }>(
        `/api/catering/schedules/${scheduleId}/menu-selections`,
      );
      this.menuSelections = r.data?.data ?? [];
    } catch {
      this.menuSelections = [];
    } finally {
      this.isLoadingSelections = false;
    }
  }

  get groupedMenuSelections(): { category: string; items: MenuSelection[] }[] {
    const map = new Map<string, MenuSelection[]>();
    for (const item of this.menuSelections) {
      if (!map.has(item.category)) {
        map.set(item.category, []);
      }
      map.get(item.category)!.push(item);
    }
    return [...map.entries()].map(([category, items]) => ({ category, items }));
  }

  // Details form change tracking
  onDetailsChange(): void {
    this.hasDetailsChanged = true;
  }

  async saveDetails(): Promise<void> {
    if (!this.selectedSchedule) return;
    this.isSavingDetails = true;
    try {
      const r = await apiClient.patch<{ success: boolean; message?: string }>(
        `/api/catering/schedules/${this.selectedSchedule.id}/details`,
        this.drawerForm,
      );
      if (r.data.success) {
        this.notify.success('Saved', 'Schedule details updated.');
        this.hasDetailsChanged = false;
        await this.loadAll();
      } else {
        this.notify.error('Failed', r.data.message ?? 'Could not save changes.');
      }
    } catch (e: any) {
      this.notify.error('Error', e?.response?.data?.message ?? 'Failed to save.');
    } finally {
      this.isSavingDetails = false;
    }
  }

  // Summary calculations
  get subtotal(): number {
    const price = Number(this.selectedSchedule?.pricePerHead ?? 0);
    const pax = this.drawerForm.pax || this.selectedSchedule?.pax || 0;
    return price * pax;
  }

  get discountValue(): number {
    if (this.drawerForm.discountType === 'percentage') {
      return this.subtotal * (this.drawerForm.discountAmount / 100);
    }
    return this.drawerForm.discountAmount;
  }

  get totalAmount(): number {
    return Math.max(0, this.subtotal - this.discountValue);
  }

  async savePackage(): Promise<void> {
    if (!this.selectedSchedule || !this.selectedPackageId) return;

    this.isSavingPackage = true;
    try {
      // Build menu selections
      const menuSelections: { menuItemId: number; category: string }[] = [];
      for (const [category, ids] of Object.entries(this.drawerMenuSelections)) {
        for (const id of ids) {
          menuSelections.push({ menuItemId: id, category });
        }
      }

      const r = await apiClient.patch<{ success: boolean; message?: string }>(
        `/api/catering/schedules/${this.selectedSchedule.id}/package`,
        { packageId: this.selectedPackageId, menuSelections },
      );
      if (r.data.success) {
        this.notify.success('Updated', 'Package and menu selections updated.');
        const pkg = this.packages.find((p) => p.id === this.selectedPackageId);
        if (pkg && this.selectedSchedule) {
          this.selectedSchedule.packageId = pkg.id;
          this.selectedSchedule.packageName = pkg.name;
        }
        this.packageChanged = false;
      } else {
        this.notify.error('Failed', r.data.message ?? 'Could not update package.');
      }
    } catch (e: any) {
      this.notify.error('Error', e?.response?.data?.message ?? 'Failed to update package.');
    } finally {
      this.isSavingPackage = false;
    }
  }

  async confirmSchedule(): Promise<void> {
    if (!this.selectedSchedule) return;

    this.isConfirming = true;
    try {
      const r = await apiClient.patch<{ success: boolean; message?: string }>(
        `/api/catering/schedules/${this.selectedSchedule.id}/confirm`,
      );
      if (r.data.success) {
        this.notify.success('Confirmed', 'Schedule moved to In-Progress.');
        this.closeDrawer();
        await this.loadAll();
      } else {
        this.notify.error('Failed', r.data.message ?? 'Could not confirm schedule.');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error('Error', msg ?? 'Failed to confirm schedule.');
    } finally {
      this.isConfirming = false;
    }
  }

  async cancelSchedule(): Promise<void> {
    if (!this.selectedSchedule) return;

    this.isCancelling = true;
    try {
      const r = await apiClient.patch<{ success: boolean; message?: string }>(
        `/api/catering/schedules/${this.selectedSchedule.id}/cancel`,
      );
      if (r.data.success) {
        this.notify.success('Cancelled', 'Schedule has been cancelled.');
        this.closeDrawer();
        await this.loadAll();
      } else {
        this.notify.error('Failed', r.data.message ?? 'Could not cancel schedule.');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error('Error', msg ?? 'Failed to cancel schedule.');
    } finally {
      this.isCancelling = false;
    }
  }

  // Rating link methods
  async generateRatingLink(): Promise<void> {
    if (!this.selectedSchedule) return;
    this.isGeneratingLink = true;
    try {
      const r = await apiClient.post<{ success: boolean; data?: { url: string }; message?: string }>(
        `/api/catering/feedback/generate-link/${this.selectedSchedule.id}`,
      );
      if (r.data.success && r.data.data) {
        this.generatedRatingLink = r.data.data.url;
        this.notify.success('Generated', 'Rating link created successfully.');
      } else {
        this.notify.error('Failed', r.data.message ?? 'Could not generate rating link.');
      }
    } catch (e: any) {
      this.notify.error('Error', e?.response?.data?.message ?? 'Failed to generate rating link.');
    } finally {
      this.isGeneratingLink = false;
    }
  }

  copyRatingLink(): void {
    if (this.generatedRatingLink) {
      navigator.clipboard.writeText(this.generatedRatingLink);
      this.linkCopied = true;
      setTimeout(() => { this.linkCopied = false; }, 2000);
    }
  }

  // Expense modal methods
  openExpenseModal(): void {
    this.expenseForm = this.emptyExpenseForm();
    this.expenseError = '';
    this.showExpenseModal = true;
  }

  closeExpenseModal(): void {
    if (!this.isCompleting) {
      this.showExpenseModal = false;
      this.expenseError = '';
    }
  }

  async submitExpenses(): Promise<void> {
    if (!this.selectedSchedule) return;

    this.isCompleting = true;
    this.expenseError = '';

    const expenses: ExpenseEntry[] = EXPENSE_CATEGORIES.map((category) => ({
      category,
      amount: Number(this.expenseForm[category]) || 0,
    }));

    try {
      const r = await apiClient.patch<{ success: boolean; message?: string }>(
        `/api/catering/schedules/${this.selectedSchedule.id}/complete`,
        { expenses },
      );
      if (r.data.success) {
        this.notify.success('Completed', 'Schedule marked as completed.');
        this.showExpenseModal = false;
        this.closeDrawer();
        await this.loadAll();
      } else {
        this.expenseError = r.data.message ?? 'Could not complete schedule.';
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.expenseError = msg ?? 'Failed to complete schedule. Please try again.';
    } finally {
      this.isCompleting = false;
    }
  }

  getStatusLabel(status: ScheduleStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'in_progress':
        return 'In-Progress';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
    }
  }

  private emptyExpenseForm(): Record<ExpenseCategory, number> {
    const form = {} as Record<ExpenseCategory, number>;
    for (const cat of EXPENSE_CATEGORIES) {
      form[cat] = 0;
    }
    return form;
  }
}
