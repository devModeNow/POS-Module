import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { SignaturePadComponent } from '../../shared/components/form/signature-pad/signature-pad.component';
import { DatePickerComponent } from '../../shared/components/form/date-picker/date-picker.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { JobOrder, JobOrderPart, JobOrdersService, Technician } from '../../shared/services/job-orders.service';
import { InventoryItem, InventoryService } from '../../shared/services/inventory.service';
import { NotificationService } from '../../shared/services/notification.service';
import { RbacService } from '../../shared/services/rbac.service';
import { generateJobOrderInvoiceHtml } from './job-order-invoice';

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  'in-progress':'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  'for-payment':'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400',
  released:    'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400',
  cancelled:   'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400',
};

@Component({
  selector: 'app-job-orders',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, SignaturePadComponent, DatePickerComponent, CanDirective],
  templateUrl: './job-orders.component.html',
})
export class JobOrdersComponent implements OnInit {
  jobOrders: JobOrder[] = [];
  technicians: Technician[] = [];
  filterStatus = '';
  search = '';
  isLoading = false;
  isDrawerOpen = false;
  isSaving = false;
  editingId: number | null = null;

  // Pagination
  currentPage = 1;
  pageSize = 20;
  get totalPages(): number { return Math.ceil(this.jobOrders.length / this.pageSize); }
  get paginatedJOs(): JobOrder[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.jobOrders.slice(start, start + this.pageSize);
  }
  goToPage(page: number): void { if (page >= 1 && page <= this.totalPages) this.currentPage = page; }
  nextPage(): void { this.goToPage(this.currentPage + 1); }
  prevPage(): void { this.goToPage(this.currentPage - 1); }

  // Detail drawer
  isDetailOpen = false;
  detailJO: JobOrder | null = null;
  isLoadingDetail = false;
  showJobDoneModal = false;
  jobDoneRemarks = '';

  // Invoice modal
  showInvoiceModal = false;
  invoiceHtml: SafeHtml = '';

  // Settle Payment
  showSettlePaymentModal = false;
  paymentForm = { mode: 'cash', amount: 0, referenceNo: '', notes: '', partsSuppliedBy: 'car_expert', cashOnHand: 0, warranty: '' };
  isSettling = false;

  // Change Logs
  changeLogs: any[] = [];
  isLoadingChangeLogs = false;

  // Edit Supplies (in-progress)
  showEditSuppliesModal = false;
  editServices: Array<{ serviceName: string; description: string; fee: number }> = [];
  editParts: Array<{ inventoryId: number | null; description: string; quantity: number; costPrice: number; billingPrice: number; source: string; suppliedBy: string; recordAsExpense: boolean }> = [];
  editSignatureData: string | null = null;
  isSavingSupplies = false;
  editPartSearchResults: InventoryItem[][] = [];
  showEditPartDropdown: boolean[] = [];
  editLaborFee = 0;
  editDiscount = 0;
  editServiceSearchText = '';
  editServiceSearchResults: Array<{ id: number; name: string }> = [];
  showEditServiceDropdown = false;
  editServicesText = '';

  form = this.emptyForm();

  // Smart search state
  plateSearchText = '';
  plateSearchResults: any[] = [];
  showPlateDropdown = false;
  plateSearchTimer: ReturnType<typeof setTimeout> | null = null;

  // Vehicle history tab (create drawer)
  createDrawerTab: 'form' | 'history' = 'form';
  vehicleHistory: any[] = [];
  isLoadingHistory = false;
  previousOdometerReading: number | null = null;

  // Detail drawer tab
  detailDrawerTab: 'details' | 'history' | 'logs' = 'details';
  detailVehicleHistory: any[] = [];
  isLoadingDetailHistory = false;

  customerSearchText = '';
  customerSearchResults: any[] = [];
  showCustomerDropdown = false;
  customerSearchTimer: ReturnType<typeof setTimeout> | null = null;

  techSearchText = '';
  techSearchResults: Technician[] = [];
  showTechDropdown = false;
  techSearchTimer: ReturnType<typeof setTimeout> | null = null;

  // Services
  services: Array<{ _uid: number; serviceName: string; description: string; fee: number }> = [];
  private serviceUid = 0;

  // Service smart search
  serviceSearchText = '';
  serviceSearchResults: Array<{ id: number; name: string; defaultFee?: number }> = [];
  showServiceDropdown = false;
  servicesText = '';

  // Miscellaneous parts
  miscParts: Array<JobOrderPart & { _uid: number }> = [];
  private partUid = 0;

  // Parts smart search
  partSearchResults: InventoryItem[][] = [];
  showPartDropdown: boolean[] = [];

  readonly statuses = ['pending', 'in-progress', 'for-payment', 'released', 'cancelled'];

  // Computed subtotals
  get servicesSubtotal(): number { return 0; } // Services are now comma-separated without individual fees
  get partsSubtotal(): number { return this.miscParts.reduce((sum, p) => sum + ((Number(p.billingPrice) || 0) * (p.quantity || 1)), 0); }
  get grandTotal(): number { return this.servicesSubtotal + this.partsSubtotal + (Number(this.form.laborFee) || 0) - (Number(this.form.discount) || 0); }

  constructor(
    private readonly svc: JobOrdersService,
    private readonly inventorySvc: InventoryService,
    private readonly notify: NotificationService,
    private readonly rbacService: RbacService,
    private readonly sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    void this.load();
    void this.loadTechnicians();
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.currentPage = 1;
    try {
      const r = await this.svc.getAll(this.filterStatus || undefined, this.search || undefined);
      this.jobOrders = r.data ?? [];
    } catch { this.jobOrders = []; }
    finally { this.isLoading = false; }
  }

  private async loadTechnicians(): Promise<void> {
    try { const r = await this.svc.getTechnicians(); this.technicians = r.data ?? []; }
    catch { this.technicians = []; }
  }

  statusClass(status: string): string {
    return STATUS_COLORS[status] ?? STATUS_COLORS['pending'];
  }

  openCreate(): void {
    this.form = this.emptyForm();
    this.editingId = null;
    this.plateSearchText = '';
    this.customerSearchText = '';
    this.techSearchText = '';
    this.plateSearchResults = [];
    this.customerSearchResults = [];
    this.techSearchResults = [];
    this.services = [this.emptyService()];
    this.servicesText = '';
    this.serviceSearchText = '';
    this.miscParts = [this.emptyPart()];
    this.partSearchResults = [[]];
    this.showPartDropdown = [false];
    this.createDrawerTab = 'form';
    this.vehicleHistory = [];
    this.previousOdometerReading = null;
    this.isDrawerOpen = true;
  }

  closeDrawer(): void { if (!this.isSaving) this.isDrawerOpen = false; }

  // ── Plate Number Smart Search ─────────────────────────────────────────

  onPlateInput(): void {
    this.form.vehicleId = null;
    this.form.customerId = null;
    if (this.plateSearchTimer) clearTimeout(this.plateSearchTimer);
    const q = this.plateSearchText.trim();
    if (q.length < 2) { this.plateSearchResults = []; this.showPlateDropdown = false; return; }
    this.plateSearchTimer = setTimeout(() => void this.doPlateSearch(q), 300);
  }

  private async doPlateSearch(q: string): Promise<void> {
    try {
      const r = await this.svc.searchVehicles(q);
      this.plateSearchResults = r.data ?? [];
      this.showPlateDropdown = this.plateSearchResults.length > 0;
    } catch { this.plateSearchResults = []; this.showPlateDropdown = false; }
  }

  selectVehicle(v: any): void {
    this.plateSearchText = v.plateNumber;
    this.form.plateNumber = v.plateNumber;
    this.form.make = v.make ?? '';
    this.form.model = v.model ?? '';
    this.form.yearModel = v.yearModel ?? null;
    this.form.engineType = v.engineType ?? '';
    this.form.fuelType = v.fuelType ?? '';
    this.form.odometerReading = v.odometerReading ?? null;
    this.form.color = v.color ?? '';
    this.form.transmission = v.transmission ?? '';
    this.form.vehicleId = v.id;
    this.previousOdometerReading = v.lastOdometerReading ?? v.odometerReading ?? null;
    // Auto-fill customer
    if (v.customerId) {
      this.form.customerId = v.customerId;
      this.form.customerName = v.customerName ?? '';
      this.form.contact = v.contact ?? '';
      this.form.email = v.email ?? '';
      this.form.address = v.address ?? '';
      this.customerSearchText = v.customerName ?? '';
    }
    this.showPlateDropdown = false;
    // Load vehicle history
    void this.loadVehicleHistory(v.id);
  }

  private async loadVehicleHistory(vehicleId: number): Promise<void> {
    this.isLoadingHistory = true;
    try {
      const r = await this.svc.getVehicleHistory(vehicleId);
      this.vehicleHistory = r.data ?? [];
    } catch { this.vehicleHistory = []; }
    finally { this.isLoadingHistory = false; }
  }

  hidePlateDropdown(): void { setTimeout(() => { this.showPlateDropdown = false; }, 200); }

  // ── Customer Smart Search ─────────────────────────────────────────────

  onCustomerInput(): void {
    this.form.customerId = null;
    if (this.customerSearchTimer) clearTimeout(this.customerSearchTimer);
    const q = this.customerSearchText.trim();
    if (q.length < 2) { this.customerSearchResults = []; this.showCustomerDropdown = false; return; }
    this.customerSearchTimer = setTimeout(() => void this.doCustomerSearch(q), 300);
  }

  private async doCustomerSearch(q: string): Promise<void> {
    try {
      const r = await this.svc.searchCustomers(q);
      this.customerSearchResults = r.data ?? [];
      this.showCustomerDropdown = this.customerSearchResults.length > 0;
    } catch { this.customerSearchResults = []; this.showCustomerDropdown = false; }
  }

  selectCustomer(c: any): void {
    this.customerSearchText = c.name;
    this.form.customerId = c.id;
    this.form.customerName = c.name;
    this.form.contact = c.contact ?? '';
    this.form.email = c.email ?? '';
    this.form.address = c.address ?? '';
    this.showCustomerDropdown = false;
  }

  hideCustomerDropdown(): void { setTimeout(() => { this.showCustomerDropdown = false; }, 200); }

  // ── Technician Smart Search ───────────────────────────────────────────

  onTechInput(): void {
    this.form.technicianId = null;
    if (this.techSearchTimer) clearTimeout(this.techSearchTimer);
    const q = this.techSearchText.trim();
    if (q.length < 1) { this.techSearchResults = []; this.showTechDropdown = false; return; }
    this.techSearchTimer = setTimeout(() => void this.doTechSearch(q), 300);
  }

  private async doTechSearch(q: string): Promise<void> {
    try {
      const r = await this.svc.searchTechnicians(q);
      this.techSearchResults = r.data ?? [];
      this.showTechDropdown = this.techSearchResults.length > 0;
    } catch { this.techSearchResults = []; this.showTechDropdown = false; }
  }

  selectTech(t: Technician): void {
    this.techSearchText = t.name;
    this.form.technicianId = t.id;
    this.showTechDropdown = false;
  }

  hideTechDropdown(): void { setTimeout(() => { this.showTechDropdown = false; }, 200); }

  onTransactionDateChange(event: { dateStr: string }): void {
    this.form.transactionDate = event.dateStr || null;
  }

  async onDetailTransactionDateChange(event: { dateStr: string }): Promise<void> {
    if (!this.detailJO || !event.dateStr) return;
    try {
      const r = await this.svc.updateTransactionDate(this.detailJO.id, event.dateStr);
      if (r.success) {
        (this.detailJO as any).transactionDate = event.dateStr;
        this.notify.success('Updated', 'Transaction date updated.');
        void this.load();
      } else {
        this.notify.error('Failed', r.message ?? 'Failed to update date.');
      }
    } catch { this.notify.error('Error', 'Unexpected error.'); }
  }

  // ── Services ───────────────────────────────────────────────────────────

  onServiceSearchInput(): void {
    const q = this.serviceSearchText.trim();
    if (q.length < 1) { this.serviceSearchResults = []; this.showServiceDropdown = false; return; }
    setTimeout(() => void this.doServiceSearch(q), 250);
  }

  private async doServiceSearch(q: string): Promise<void> {
    try {
      const r = await this.svc.searchServices(q);
      this.serviceSearchResults = r.data ?? [];
      this.showServiceDropdown = this.serviceSearchResults.length > 0;
    } catch { this.serviceSearchResults = []; this.showServiceDropdown = false; }
  }

  selectServiceFromSearch(s: { id: number; name: string; defaultFee?: number }): void {
    this.appendService(s.name);
    this.serviceSearchText = '';
    this.showServiceDropdown = false;
  }

  addServiceFromSearch(): void {
    const name = this.serviceSearchText.trim();
    if (!name) return;
    this.appendService(name);
    // Save to DB for future searches
    void this.svc.createServiceLookup(name);
    this.serviceSearchText = '';
    this.showServiceDropdown = false;
  }

  private appendService(name: string): void {
    const current = this.servicesText.trim();
    if (current) {
      // Don't add duplicates
      const existing = current.split(',').map(s => s.trim().toLowerCase());
      if (existing.includes(name.toLowerCase())) return;
      this.servicesText = current + ', ' + name;
    } else {
      this.servicesText = name;
    }
    // Also add to the services array for backend
    this.services.push({ _uid: ++this.serviceUid, serviceName: name, description: '', fee: 0 });
  }

  hideServiceDropdown(): void { setTimeout(() => { this.showServiceDropdown = false; }, 200); }

  addService(): void { this.services.push(this.emptyService()); }
  removeService(i: number): void { if (this.services.length > 1) this.services.splice(i, 1); }

  // ── Miscellaneous Parts ───────────────────────────────────────────────

  addPart(): void {
    this.miscParts.push(this.emptyPart());
    this.partSearchResults.push([]);
    this.showPartDropdown.push(false);
  }

  removePart(i: number): void {
    if (this.miscParts.length > 1) {
      this.miscParts.splice(i, 1);
      this.partSearchResults.splice(i, 1);
      this.showPartDropdown.splice(i, 1);
    }
  }

  onPartDescInput(index: number): void {
    this.miscParts[index].inventoryId = null;
    this.miscParts[index].source = 'manual';
    const q = this.miscParts[index].description.trim();
    if (q.length < 2) { this.partSearchResults[index] = []; this.showPartDropdown[index] = false; return; }
    setTimeout(() => void this.doPartSearch(index, q), 300);
  }

  private async doPartSearch(index: number, q: string): Promise<void> {
    try {
      const r = await this.inventorySvc.search(q);
      this.partSearchResults[index] = r.data ?? [];
      this.showPartDropdown[index] = (this.partSearchResults[index]?.length ?? 0) > 0;
    } catch { this.partSearchResults[index] = []; this.showPartDropdown[index] = false; }
  }

  selectPart(index: number, product: InventoryItem): void {
    this.miscParts[index].inventoryId = product.id;
    this.miscParts[index].description = product.partName;
    this.miscParts[index].costPrice = product.costPrice ?? 0;
    this.miscParts[index].billingPrice = product.sellingPrice ?? 0;
    this.miscParts[index].source = 'inventory';
    this.miscParts[index].inventoryName = product.partName;
    this.showPartDropdown[index] = false;
  }

  hidePartDropdown(index: number): void { setTimeout(() => { this.showPartDropdown[index] = false; }, 200); }

  // ── Save ──────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (!this.plateSearchText.trim() && !this.form.plateNumber.trim()) {
      this.notify.warning('Required', 'Plate number is required.'); return;
    }
    // Use typed plate text if no vehicle was selected
    if (!this.form.plateNumber) this.form.plateNumber = this.plateSearchText.trim();
    if (!this.form.customerName) this.form.customerName = this.customerSearchText.trim();

    this.isSaving = true;
    try {
      // Auto-create technician if typed but not selected from search
      if (!this.form.technicianId && this.techSearchText.trim()) {
        const tr = await this.svc.createTechnician(this.techSearchText.trim());
        if (tr.success && tr.data) {
          this.form.technicianId = tr.data.id;
        }
      }

      // Build services from comma-separated text
      const servicesList = this.servicesText.split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => ({ serviceName: s, fee: 0 }));

      // Build parts array (filter out empty rows)
      const parts = this.miscParts
        .filter(p => p.description.trim())
        .map(p => ({
          inventoryId: p.inventoryId ?? null,
          description: p.description,
          quantity: Math.max(1, Math.round(p.quantity)),
          costPrice: Number(p.costPrice) || 0,
          billingPrice: Number(p.billingPrice) || 0,
          source: p.source ?? 'manual',
          suppliedBy: (p as any).suppliedBy ?? 'car_expert',
          recordAsExpense: (p as any).recordAsExpense ?? false,
        }));

      // Set totalAmount to grandTotal
      this.form.totalAmount = this.grandTotal;

      // Determine initial status: signed = in-progress (approved), unsigned = for-approval
      const initialStatus = this.form.customerSignatureData ? 'in-progress' : 'pending';

      const r = await this.svc.create({ ...this.form, services: servicesList, parts, status: initialStatus });
      if (!r.success) { this.notify.error('Failed', r.message ?? 'Operation failed.'); return; }
      const statusMsg = initialStatus === 'in-progress'
        ? 'Job order created and approved (In Progress).'
        : 'Job order created (Pending Approval).';
      this.notify.success('Created', statusMsg);
      this.isDrawerOpen = false;
      await this.load();
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error('Error', Array.isArray(msg) ? msg[0] : (msg ?? 'Unexpected error.'));
    }
    finally { this.isSaving = false; }
  }

  // ── Detail ────────────────────────────────────────────────────────────

  async openDetail(jo: JobOrder): Promise<void> {
    this.isDetailOpen = true;
    this.isLoadingDetail = true;
    this.detailDrawerTab = 'details';
    this.detailVehicleHistory = [];
    try {
      const r = await this.svc.getOne(jo.id);
      this.detailJO = r.data ?? null;
    } catch { this.detailJO = jo; }
    finally { this.isLoadingDetail = false; }
  }

  async loadDetailHistory(): Promise<void> {
    if (!this.detailJO) return;
    // We need the vehicle_id — get it from the backend response or use a lookup
    this.isLoadingDetailHistory = true;
    try {
      // Use the plate number to search for the vehicle and get its ID
      const r = await this.svc.searchVehicles(this.detailJO.plateNumber);
      const vehicle = (r.data ?? []).find((v: any) => v.plateNumber === this.detailJO?.plateNumber);
      if (vehicle) {
        const hr = await this.svc.getVehicleHistory(vehicle.id);
        this.detailVehicleHistory = hr.data ?? [];
      }
    } catch { this.detailVehicleHistory = []; }
    finally { this.isLoadingDetailHistory = false; }
  }

  closeDetail(): void { this.isDetailOpen = false; this.detailJO = null; }

  async updateStatus(id: number, status: string): Promise<void> {
    try {
      await this.svc.updateStatus(id, status);
      this.notify.success('Updated', `Status changed to ${status}.`);
      if (this.detailJO?.id === id) {
        const r = await this.svc.getOne(id);
        this.detailJO = r.data ?? this.detailJO;
      }
      await this.load();
    } catch { this.notify.error('Error', 'Failed to update status.'); }
  }

  async confirmJobDone(): Promise<void> {
    if (!this.detailJO) return;
    this.showJobDoneModal = false;
    try {
      await this.svc.updateStatus(this.detailJO.id, 'for-payment', { serviceRemarks: this.jobDoneRemarks.trim() || undefined });
      this.notify.success('Updated', 'Job order moved to For Payment.');
      const r = await this.svc.getOne(this.detailJO.id);
      this.detailJO = r.data ?? this.detailJO;
      await this.load();
    } catch { this.notify.error('Error', 'Failed to update status.'); }
    this.jobDoneRemarks = '';
  }

  printInvoice(): void {
    if (!this.detailJO) return;
    const rawHtml = generateJobOrderInvoiceHtml(this.detailJO, { partsSuppliedBy: (this.detailJO as any).partsSuppliedBy, warranty: this.paymentForm.warranty, releasedBy: this.rbacService.getDisplayName() });
    this.invoiceHtml = this.sanitizer.bypassSecurityTrustHtml(rawHtml);
    this.showInvoiceModal = true;
  }

  reprintInvoice(): void {
    if (!this.detailJO) return;
    const rawHtml = generateJobOrderInvoiceHtml(this.detailJO, { partsSuppliedBy: (this.detailJO as any).partsSuppliedBy, warranty: (this.detailJO as any).warranty, releasedBy: (this.detailJO as any).releasedBy || this.rbacService.getDisplayName() });
    const watermark = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:60px;font-weight:900;color:rgba(255,0,0,0.12);pointer-events:none;z-index:999;letter-spacing:10px;">REPRINTED</div>`;
    const withWatermark = rawHtml.replace('<div class="jo-print-receipt">', '<div class="jo-print-receipt" style="position:relative;">' + watermark);
    this.invoiceHtml = this.sanitizer.bypassSecurityTrustHtml(withWatermark);
    this.showInvoiceModal = true;
  }

  async settlePayment(): Promise<void> {
    if (!this.detailJO) return;
    if (!this.paymentForm.amount || this.paymentForm.amount <= 0) {
      this.notify.warning('Required', 'Payment amount is required.'); return;
    }
    this.isSettling = true;
    try {
      // Record payment
      await this.svc.addPayment(this.detailJO.id, {
        mode: this.paymentForm.mode,
        amount: this.paymentForm.amount,
        paymentDate: new Date().toISOString().slice(0, 10),
        referenceNo: this.paymentForm.referenceNo || undefined,
        notes: this.paymentForm.notes || undefined,
      });
      // Save parts supplied by and warranty
      (this.detailJO as any).partsSuppliedBy = this.paymentForm.partsSuppliedBy;
      (this.detailJO as any).warranty = this.paymentForm.warranty;
      // Release the vehicle
      await this.svc.updateStatus(this.detailJO.id, 'released', {
        partsSuppliedBy: this.paymentForm.partsSuppliedBy,
        warranty: this.paymentForm.warranty,
        releasedBy: this.rbacService.getDisplayName(),
      });
      this.notify.success('Released', 'Payment settled and vehicle released.');
      this.showSettlePaymentModal = false;
      // Refresh detail
      const r = await this.svc.getOne(this.detailJO.id);
      this.detailJO = r.data ?? this.detailJO;
      (this.detailJO as any).partsSuppliedBy = this.paymentForm.partsSuppliedBy;
      (this.detailJO as any).warranty = this.paymentForm.warranty;
      (this.detailJO as any).releasedBy = this.rbacService.getDisplayName();
      await this.load();
      // Show print invoice
      this.printInvoice();
    } catch (e: any) {
      this.notify.error('Error', e?.response?.data?.message ?? 'Failed to settle payment.');
    }
    finally { this.isSettling = false; }
  }

  // ── Change Logs ───────────────────────────────────────────────────────

  async loadChangeLogs(): Promise<void> {
    if (!this.detailJO) return;
    this.isLoadingChangeLogs = true;
    try {
      const r = await this.svc.getChangeLogs(this.detailJO.id);
      this.changeLogs = r.data ?? [];
    } catch { this.changeLogs = []; }
    finally { this.isLoadingChangeLogs = false; }
  }

  // ── Edit Supplies ─────────────────────────────────────────────────────

  openEditSupplies(): void {
    if (!this.detailJO) return;
    const supplies = this.detailJO.supplies ?? [];
    this.editServices = supplies
      .filter((s: any) => s.supplyType === 'service' || s.serviceName)
      .map((s: any) => ({ serviceName: s.serviceName || s.description || '', description: s.description || '', fee: Number(s.fee) || Number(s.billingPrice) || 0 }));
    this.editServicesText = this.editServices.map(s => s.serviceName).filter(Boolean).join(', ');
    this.editServiceSearchText = '';
    this.editParts = supplies
      .filter((s: any) => s.supplyType === 'part' || (!s.serviceName && s.description))
      .map((p: any) => ({ inventoryId: p.inventoryId ?? null, description: p.description || '', quantity: Number(p.quantity) || 1, costPrice: Number(p.costPrice) || 0, billingPrice: Number(p.billingPrice) || 0, source: p.source || 'manual', suppliedBy: p.suppliedBy || 'car_expert', recordAsExpense: p.recordAsExpense ?? false }));
    if (this.editServices.length === 0) this.editServices.push({ serviceName: '', description: '', fee: 0 });
    if (this.editParts.length === 0) this.editParts.push({ inventoryId: null, description: '', quantity: 1, costPrice: 0, billingPrice: 0, source: 'manual', suppliedBy: 'car_expert', recordAsExpense: false });
    this.editPartSearchResults = this.editParts.map(() => []);
    this.showEditPartDropdown = this.editParts.map(() => false);
    this.editLaborFee = Number(this.detailJO.laborFee) || 0;
    this.editDiscount = Number(this.detailJO.discount) || 0;
    this.editSignatureData = null;
    this.showEditSuppliesModal = true;
  }

  addEditService(): void { this.editServices.push({ serviceName: '', description: '', fee: 0 }); }
  removeEditService(i: number): void { if (this.editServices.length > 1) this.editServices.splice(i, 1); }

  onEditServiceSearchInput(): void {
    const q = this.editServiceSearchText.trim();
    if (q.length < 1) { this.editServiceSearchResults = []; this.showEditServiceDropdown = false; return; }
    setTimeout(() => void this.doEditServiceSearch(q), 250);
  }

  private async doEditServiceSearch(q: string): Promise<void> {
    try {
      const r = await this.svc.searchServices(q);
      this.editServiceSearchResults = r.data ?? [];
      this.showEditServiceDropdown = this.editServiceSearchResults.length > 0;
    } catch { this.editServiceSearchResults = []; this.showEditServiceDropdown = false; }
  }

  selectEditServiceFromSearch(s: { id: number; name: string }): void {
    this.appendEditService(s.name);
    this.editServiceSearchText = '';
    this.showEditServiceDropdown = false;
  }

  addEditServiceFromSearch(): void {
    const name = this.editServiceSearchText.trim();
    if (!name) return;
    this.appendEditService(name);
    void this.svc.createServiceLookup(name);
    this.editServiceSearchText = '';
    this.showEditServiceDropdown = false;
  }

  private appendEditService(name: string): void {
    const current = this.editServicesText.trim();
    if (current) {
      const existing = current.split(',').map(s => s.trim().toLowerCase());
      if (existing.includes(name.toLowerCase())) return;
      this.editServicesText = current + ', ' + name;
    } else {
      this.editServicesText = name;
    }
    this.editServices.push({ serviceName: name, description: '', fee: 0 });
  }

  hideEditServiceDropdown(): void { setTimeout(() => { this.showEditServiceDropdown = false; }, 200); }
  addEditPart(): void { this.editParts.push({ inventoryId: null, description: '', quantity: 1, costPrice: 0, billingPrice: 0, source: 'manual', suppliedBy: 'car_expert', recordAsExpense: false }); this.editPartSearchResults.push([]); this.showEditPartDropdown.push(false); }
  removeEditPart(i: number): void { if (this.editParts.length > 1) { this.editParts.splice(i, 1); this.editPartSearchResults.splice(i, 1); this.showEditPartDropdown.splice(i, 1); } }

  onEditPartInput(index: number): void {
    this.editParts[index].inventoryId = null;
    this.editParts[index].source = 'manual';
    const q = this.editParts[index].description.trim();
    if (q.length < 2) { this.editPartSearchResults[index] = []; this.showEditPartDropdown[index] = false; return; }
    setTimeout(() => void this.doEditPartSearch(index, q), 300);
  }

  private async doEditPartSearch(index: number, q: string): Promise<void> {
    try {
      const r = await this.inventorySvc.search(q);
      this.editPartSearchResults[index] = r.data ?? [];
      this.showEditPartDropdown[index] = (this.editPartSearchResults[index]?.length ?? 0) > 0;
    } catch { this.editPartSearchResults[index] = []; this.showEditPartDropdown[index] = false; }
  }

  selectEditPart(index: number, product: InventoryItem): void {
    this.editParts[index].inventoryId = product.id;
    this.editParts[index].description = product.partName;
    this.editParts[index].costPrice = product.costPrice ?? 0;
    this.editParts[index].billingPrice = product.sellingPrice ?? 0;
    this.editParts[index].source = 'inventory';
    this.showEditPartDropdown[index] = false;
  }

  hideEditPartDropdown(index: number): void { setTimeout(() => { this.showEditPartDropdown[index] = false; }, 200); }

  async saveEditSupplies(): Promise<void> {
    if (!this.detailJO) return;
    if (!this.editSignatureData) { this.notify.warning('Required', 'Customer re-approval signature is required.'); return; }
    this.isSavingSupplies = true;
    try {
      const services = this.editServicesText.split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => ({ serviceName: s, fee: 0 }));
      const parts = this.editParts.filter(p => p.description.trim());
      const r = await this.svc.updateSupplies(this.detailJO.id, { services, parts, customerSignatureData: this.editSignatureData, laborFee: this.editLaborFee, discount: this.editDiscount });
      if (!r.success) { this.notify.error('Failed', r.message ?? 'Failed to update.'); return; }
      this.notify.success('Updated', 'Services and parts updated with re-approval.');
      this.showEditSuppliesModal = false;
      // Refresh detail
      const detail = await this.svc.getOne(this.detailJO.id);
      this.detailJO = detail.data ?? this.detailJO;
      await this.load();
    } catch (e: any) {
      this.notify.error('Error', e?.response?.data?.message ?? 'Unexpected error.');
    }
    finally { this.isSavingSupplies = false; }
  }

  printFromModal(): void {
    const el = document.getElementById('invoice-print-area');
    if (!el) return;
    const content = el.innerHTML;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = '1100px';
    iframe.style.height = '800px';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();
    doc.write(`<html><head><title>Job Order</title><style>@page { margin: 0; size: letter; } body { margin: 0; padding: 5mm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }</style></head><body>${content}</body></html>`);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 500);
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private emptyForm() {
    return {
      plateNumber: '', make: '', model: '', yearModel: null as number | null,
      engineType: '', fuelType: '', odometerReading: null as number | null,
      color: '', transmission: '',
      customerName: '', contact: '', email: '', address: '',
      customerId: null as number | null, vehicleId: null as number | null,
      technicianId: null as number | null,
      description: '', laborFee: 0, discount: 0, totalAmount: 0,
      customerSignatureData: null as string | null,
      transactionDate: new Date().toISOString().split('T')[0] as string | null,
    };
  }

  private emptyPart(): JobOrderPart & { _uid: number } {
    return { _uid: ++this.partUid, description: '', quantity: 1, costPrice: 0, billingPrice: 0, inventoryId: null, source: 'manual', suppliedBy: 'car_expert', recordAsExpense: false };
  }

  private emptyService() {
    return { _uid: ++this.serviceUid, serviceName: '', description: '', fee: 0 };
  }

  getDetailServices(): string[] {
    if (!this.detailJO?.supplies) return [];
    return this.detailJO.supplies
      .filter((s: any) => s.supplyType === 'service' || s.serviceName)
      .map((s: any) => s.serviceName || s.description || '')
      .filter(Boolean);
  }

  getDetailParts(): any[] {
    if (!this.detailJO?.supplies) return [];
    return this.detailJO.supplies.filter((s: any) => s.supplyType === 'part' || (!s.serviceName && s.description));
  }
}
