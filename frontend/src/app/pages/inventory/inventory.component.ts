import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { DatePickerComponent } from '../../shared/components/form/date-picker/date-picker.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { InventoryItem, InventoryService, PurchaseOrder, PurchaseOrderItem, Supplier } from '../../shared/services/inventory.service';
import { NotificationService } from '../../shared/services/notification.service';

type MainTab = 'inventory' | 'purchase-orders' | 'reports';
type DrawerMode = 'create' | 'edit';

@Component({
  selector: 'app-inventory',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, DatePickerComponent, CanDirective],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit {
  activeTab: MainTab = 'inventory';

  // Inventory tab
  items: InventoryItem[] = [];
  search = '';
  isLoadingItems = false;
  isItemDrawerOpen = false;
  isSavingItem = false;
  itemDrawerMode: DrawerMode = 'create';
  editingItemId: number | null = null;
  itemForm = this.emptyItemForm();

  // Pagination
  currentPage = 1;
  pageSize = 20;
  get totalPages(): number { return Math.ceil(this.filteredItems.length / this.pageSize); }
  get filteredItems(): InventoryItem[] {
    if (!this.search.trim()) return this.items;
    const q = this.search.toLowerCase();
    return this.items.filter(i =>
      i.partName?.toLowerCase().includes(q) ||
      i.brand?.toLowerCase().includes(q) ||
      i.category?.toLowerCase().includes(q)
    );
  }
  get paginatedItems(): InventoryItem[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredItems.slice(start, start + this.pageSize);
  }
  goToPage(page: number): void { if (page >= 1 && page <= this.totalPages) this.currentPage = page; }
  nextPage(): void { this.goToPage(this.currentPage + 1); }
  prevPage(): void { this.goToPage(this.currentPage - 1); }

  // PO tab
  purchaseOrders: PurchaseOrder[] = [];
  poFilterStatus = '';
  poFilterSupplier = '';
  suppliers: Supplier[] = [];
  isLoadingPO = false;
  isPODrawerOpen = false;
  isSavingPO = false;
  poDetailOpen = false;
  poDetail: PurchaseOrder | null = null;
  poForm = this.emptyPOForm();
  poItems: (PurchaseOrderItem & { _uid: number })[] = [this.emptyPOItem()];

  // Supplier smart search
  supplierSearchText = '';
  supplierSearchResults: Supplier[] = [];
  showSupplierDropdown = false;
  private supplierSearchTimer: ReturnType<typeof setTimeout> | null = null;

  // Product smart search for PO items
  poItemSearchResults: InventoryItem[][] = [[]];
  poItemSearching: boolean[] = [false];
  poItemSearchTimers: ReturnType<typeof setTimeout>[] = [];

  // Brand & Category autocomplete
  brandSuggestions: { id: number; name: string }[] = [];
  categorySuggestions: { id: number; name: string }[] = [];
  brandSearchTimer: ReturnType<typeof setTimeout> | null = null;
  categorySearchTimer: ReturnType<typeof setTimeout> | null = null;
  showBrandDropdown = false;
  showCategoryDropdown = false;
  // For PO items
  poItemBrandSuggestions: { id: number; name: string }[][] = [[]];
  poItemCategorySuggestions: { id: number; name: string }[][] = [[]];
  showPoItemBrandDropdown: boolean[] = [false];
  showPoItemCategoryDropdown: boolean[] = [false];

  // Low stock tab
  lowStockItems: InventoryItem[] = [];
  isLoadingLowStock = false;

  // Import
  showImportModal = false;
  importData: any[] = [];
  isImporting = false;
  importResult: { success: boolean; imported?: number; updated?: number; errors?: string[]; message?: string } | null = null;

  // Stock Adjustment
  showAdjustModal = false;
  adjustItem: InventoryItem | null = null;
  adjustQty = 0;
  adjustNotes = '';
  adjustPassword = '';
  isAdjusting = false;

  // Stock History
  showHistoryModal = false;
  historyItem: InventoryItem | null = null;
  stockHistory: any[] = [];
  isLoadingHistory = false;

  constructor(
    private readonly svc: InventoryService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    void this.loadItems();
    void this.loadSuppliers();
  }

  switchTab(tab: MainTab): void {
    this.activeTab = tab;
    if (tab === 'inventory' && this.items.length === 0) void this.loadItems();
    if (tab === 'purchase-orders' && this.purchaseOrders.length === 0) void this.loadPO();
    if (tab === 'reports') void this.loadLowStock();
  }

  // ── Inventory ─────────────────────────────────────────────────────────────

  async loadItems(): Promise<void> {
    this.isLoadingItems = true;
    this.currentPage = 1;
    try { const r = await this.svc.getAll(this.search || undefined); this.items = r.data ?? []; }
    catch { this.items = []; }
    finally { this.isLoadingItems = false; }
  }

  openCreateItem(): void { this.itemForm = this.emptyItemForm(); this.itemDrawerMode = 'create'; this.editingItemId = null; this.isItemDrawerOpen = true; }

  openEditItem(item: InventoryItem): void {
    this.itemForm = { partName: item.partName, category: item.category ?? '', brand: item.brand ?? '', description: item.description ?? '', stockQty: item.stockQty, stockWarning: item.stockWarning ?? 0, costPrice: item.costPrice ?? 0, sellingPrice: item.sellingPrice ?? 0, marginPercent: (item as any).marginPercent ?? null };
    this.itemDrawerMode = 'edit';
    this.editingItemId = item.id;
    this.isItemDrawerOpen = true;
  }

  closeItemDrawer(): void { if (!this.isSavingItem) this.isItemDrawerOpen = false; }

  onMarginChange(): void {
    if (this.itemForm.marginPercent && this.itemForm.marginPercent > 0 && this.itemForm.costPrice > 0) {
      const computed = this.itemForm.costPrice * (1 + this.itemForm.marginPercent / 100);
      if (confirm(`Set selling price to ₱${computed.toFixed(2)} based on ${this.itemForm.marginPercent}% margin?`)) {
        this.itemForm.sellingPrice = Math.round(computed * 100) / 100;
      }
    }
  }

  async saveItem(): Promise<void> {
    if (!this.itemForm.partName.trim()) { this.notify.warning('Required', 'Part name is required.'); return; }
    this.isSavingItem = true;
    try {
      // Auto-save brand and category to lookup tables
      if (this.itemForm.brand?.trim()) { void this.svc.createBrand(this.itemForm.brand.trim()); }
      if (this.itemForm.category?.trim()) { void this.svc.createCategory(this.itemForm.category.trim()); }

      const r = this.itemDrawerMode === 'create'
        ? await this.svc.create(this.itemForm)
        : await this.svc.update(this.editingItemId!, this.itemForm);
      if (!r.success) { this.notify.error('Failed', r.message ?? 'Operation failed.'); return; }
      this.notify.success('Saved', this.itemDrawerMode === 'create' ? 'Item added.' : 'Item updated.');
      this.isItemDrawerOpen = false;
      await this.loadItems();
    } catch { this.notify.error('Error', 'Unexpected error.'); }
    finally { this.isSavingItem = false; }
  }

  isLow(item: InventoryItem): boolean { return item.stockQty <= (item.stockWarning ?? 0); }

  // ── Purchase Orders ───────────────────────────────────────────────────────

  async loadPO(): Promise<void> {
    this.isLoadingPO = true;
    try {
      const r = await this.svc.getAllPO(this.poFilterStatus || undefined);
      let data = r.data ?? [];
      // Client-side supplier filter
      if (this.poFilterSupplier.trim()) {
        const q = this.poFilterSupplier.trim().toLowerCase();
        data = data.filter((po: any) => (po.supplierName ?? '').toLowerCase().includes(q));
      }
      this.purchaseOrders = data;
    }
    catch { this.purchaseOrders = []; }
    finally { this.isLoadingPO = false; }
  }

  private async loadSuppliers(): Promise<void> {
    try { const r = await this.svc.getSuppliers(); this.suppliers = r.data ?? []; }
    catch { this.suppliers = []; }
  }

  openCreatePO(): void { this.poForm = this.emptyPOForm(); this.poItems = [this.emptyPOItem()]; this.poItemSearchResults = [[]]; this.poItemSearching = [false]; this.poItemBrandSuggestions = [[]]; this.poItemCategorySuggestions = [[]]; this.showPoItemBrandDropdown = [false]; this.showPoItemCategoryDropdown = [false]; this.supplierSearchText = ''; this.supplierSearchResults = []; this.showSupplierDropdown = false; this.isPODrawerOpen = true; }
  closePODrawer(): void { if (!this.isSavingPO) this.isPODrawerOpen = false; }

  // Supplier smart search
  onSupplierSearchInput(): void {
    // Clear selection if user modifies text
    this.poForm.supplierId = null;
    const q = this.supplierSearchText.trim();
    if (this.supplierSearchTimer) clearTimeout(this.supplierSearchTimer);
    if (q.length < 1) { this.supplierSearchResults = []; this.showSupplierDropdown = false; return; }
    this.supplierSearchTimer = setTimeout(() => void this.doSupplierSearch(q), 250);
  }

  private async doSupplierSearch(q: string): Promise<void> {
    try {
      const r = await this.svc.searchSuppliers(q);
      this.supplierSearchResults = r.data ?? [];
      this.showSupplierDropdown = this.supplierSearchResults.length > 0;
    } catch { this.supplierSearchResults = []; this.showSupplierDropdown = false; }
  }

  selectSupplier(s: Supplier): void {
    this.poForm.supplierId = s.id;
    this.supplierSearchText = s.name;
    this.showSupplierDropdown = false;
  }

  hideSupplierDropdown(): void {
    // Delay to allow mousedown on dropdown items to fire first
    setTimeout(() => { this.showSupplierDropdown = false; }, 200);
  }

  onOrderDateChange(event: { dateStr: string }): void { this.poForm.orderDate = event.dateStr; }
  onExpectedDateChange(event: { dateStr: string }): void { this.poForm.expectedDate = event.dateStr; }

  addPOItem(): void { this.poItems.push(this.emptyPOItem()); this.poItemSearchResults.push([]); this.poItemSearching.push(false); this.poItemBrandSuggestions.push([]); this.poItemCategorySuggestions.push([]); this.showPoItemBrandDropdown.push(false); this.showPoItemCategoryDropdown.push(false); }
  removePOItem(i: number): void { if (this.poItems.length > 1) { this.poItems.splice(i, 1); this.poItemSearchResults.splice(i, 1); this.poItemSearching.splice(i, 1); this.poItemBrandSuggestions.splice(i, 1); this.poItemCategorySuggestions.splice(i, 1); this.showPoItemBrandDropdown.splice(i, 1); this.showPoItemCategoryDropdown.splice(i, 1); } }

  onPOItemNameInput(index: number): void {
    const q = this.poItems[index].itemName.trim();
    // Clear previous timer
    if (this.poItemSearchTimers[index]) clearTimeout(this.poItemSearchTimers[index]);
    // Clear selection if user is typing again
    this.poItems[index].inventoryId = null;
    if (q.length < 2) { this.poItemSearchResults[index] = []; return; }
    this.poItemSearchTimers[index] = setTimeout(() => void this.searchPOItem(index, q), 300);
  }

  private async searchPOItem(index: number, q: string): Promise<void> {
    this.poItemSearching[index] = true;
    try {
      const r = await this.svc.search(q);
      this.poItemSearchResults[index] = r.data ?? [];
    } catch { this.poItemSearchResults[index] = []; }
    finally { this.poItemSearching[index] = false; }
  }

  selectPOItemProduct(index: number, product: InventoryItem): void {
    this.poItems[index].inventoryId = product.id;
    this.poItems[index].itemName = product.partName;
    this.poItems[index].brand = product.brand ?? '';
    this.poItems[index].category = product.category ?? '';
    this.poItems[index].unitCost = product.costPrice ?? 0;
    this.poItemSearchResults[index] = [];
  }

  async savePO(): Promise<void> {
    const supplierName = this.supplierSearchText.trim();
    if (!this.poForm.supplierId && !supplierName) { this.notify.warning('Required', 'Please enter or select a supplier.'); return; }
    if (this.poItems.some((i) => !i.itemName.trim())) { this.notify.warning('Required', 'All items need a name.'); return; }
    this.isSavingPO = true;
    try {
      // If supplier not selected from search, create it
      if (!this.poForm.supplierId && supplierName) {
        const sr = await this.svc.createSupplier(supplierName);
        if (!sr.success || !sr.data) { this.notify.error('Failed', sr.message ?? 'Could not create supplier.'); return; }
        this.poForm.supplierId = sr.data.id;
      }

      // Auto-save brands and categories from PO items to lookup tables
      for (const item of this.poItems) {
        if (item.brand && typeof item.brand === 'string' && item.brand.trim()) { void this.svc.createBrand(item.brand.trim()); }
        if (item.category && typeof item.category === 'string' && item.category.trim()) { void this.svc.createCategory(item.category.trim()); }
      }

      const r = await this.svc.createPO({
        supplierId: Number(this.poForm.supplierId),
        comments: this.poForm.comments || undefined,
        items: this.poItems.map((i) => {
          const item: any = {
            itemName: i.itemName,
            quantity: Math.max(1, Math.round(i.quantity)),
            unitCost: Number(i.unitCost) || 0,
          };
          if (i.inventoryId) item.inventoryId = Number(i.inventoryId);
          if (i.brand?.trim()) item.brand = i.brand.trim();
          if (i.category?.trim()) item.category = i.category.trim();
          return item;
        }),
      });
      if (!r.success) { this.notify.error('Failed', r.message ?? 'Operation failed.'); return; }
      this.notify.success('Created', 'Purchase order created.');
      this.isPODrawerOpen = false;
      await this.loadPO();
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error('Error', Array.isArray(msg) ? msg[0] : (msg ?? 'Unexpected error.'));
    }
    finally { this.isSavingPO = false; }
  }

  async openPODetail(po: PurchaseOrder): Promise<void> {
    try { const r = await this.svc.getOnePO(po.id); this.poDetail = r.data ?? po; }
    catch { this.poDetail = po; }
    this.poDetailOpen = true;
  }

  closePODetail(): void { this.poDetailOpen = false; this.poDetail = null; }

  async editPO(po: PurchaseOrder): Promise<void> {
    if (!po.items?.length) { this.notify.warning('Required', 'At least one item is required.'); return; }
    if (po.items.some((i) => !i.itemName?.trim())) { this.notify.warning('Required', 'All items need a name.'); return; }
    try {
      const r = await this.svc.updatePO(po.id, {
        comments: po.comments ?? undefined,
        items: po.items.map((i) => ({
          id: i.id,
          inventoryId: i.inventoryId ?? undefined,
          itemName: i.itemName || (i as any).productName || '',
          brand: i.brand || undefined,
          category: i.category || undefined,
          quantity: Math.max(1, Math.round(i.quantity)),
          unitCost: Number(i.unitCost) || 0,
        })),
      });
      if (!r.success) { this.notify.error('Failed', r.message ?? 'Could not update PO.'); return; }
      this.notify.success('Updated', 'Purchase order updated.');
      await this.loadPO();
      // Refresh detail
      const detail = await this.svc.getOnePO(po.id);
      this.poDetail = detail.data ?? po;
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error('Error', Array.isArray(msg) ? msg[0] : (msg ?? 'Unexpected error.'));
    }
  }

  addPoDetailItem(): void {
    if (this.poDetail?.items) {
      this.poDetail.items.push({ itemName: '', brand: '', category: '', quantity: 1, unitCost: 0 });
    }
  }

  removePoDetailItem(index: number): void {
    if (this.poDetail?.items && this.poDetail.items.length > 1) {
      this.poDetail.items.splice(index, 1);
    }
  }

  async receivePO(id: number): Promise<void> {
    if (!confirm('Mark this PO as received and update stock?')) return;
    try {
      await this.svc.receivePO(id);
      this.notify.success('Received', 'Stock updated from PO.');
      this.closePODetail();
      await this.loadPO();
      await this.loadItems();
    } catch { this.notify.error('Error', 'Failed to receive PO.'); }
  }

  // ── Low Stock ─────────────────────────────────────────────────────────────

  async loadLowStock(): Promise<void> {
    this.isLoadingLowStock = true;
    try { const r = await this.svc.getLowStock(); this.lowStockItems = r.data ?? []; }
    catch { this.lowStockItems = []; }
    finally { this.isLoadingLowStock = false; }
  }

  // ── Import ────────────────────────────────────────────────────────────

  onImportFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) { this.importData = []; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      this.importData = this.parseCsv(text);
    };
    reader.readAsText(file);
  }

  private parseCsv(text: string): any[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    // Skip header row
    const rows = lines.slice(1);
    return rows.map(line => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      return {
        partName: cols[0] || '',
        brand: cols[1] || undefined,
        category: cols[2] || undefined,
        description: cols[3] || undefined,
        stockQty: Number(cols[4]) || 0,
        stockWarning: Number(cols[5]) || 0,
        costPrice: Number(cols[6]) || 0,
        sellingPrice: Number(cols[7]) || 0,
        marginPercent: Number(cols[8]) || undefined,
      };
    }).filter(item => item.partName);
  }

  async executeImport(): Promise<void> {
    if (!this.importData.length) return;
    this.isImporting = true;
    this.importResult = null;
    try {
      const r = await this.svc.bulkImport(this.importData);
      this.importResult = r;
      if (r.success) {
        this.importData = [];
        await this.loadItems();
      }
    } catch { this.importResult = { success: false, message: 'Unexpected error during import.' }; }
    finally { this.isImporting = false; }
  }

  downloadTemplate(): void {
    const csv = 'Part Name,Brand,Category,Description,Stock Qty,Stock Warning,Cost Price,Selling Price,Margin %\nSample Item,Brand X,Category A,Description here,10,5,100.00,150.00,50';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Stock Adjustment ──────────────────────────────────────────────────

  openAdjustStock(item: InventoryItem): void {
    this.adjustItem = item;
    this.adjustQty = 0;
    this.adjustNotes = '';
    this.adjustPassword = '';
    this.showAdjustModal = true;
  }

  async confirmAdjustStock(): Promise<void> {
    if (!this.adjustItem) return;
    if (!this.adjustPassword.trim()) { this.notify.warning('Required', 'Password is required for security.'); return; }
    if (this.adjustQty === 0) { this.notify.warning('Required', 'Adjustment quantity cannot be zero.'); return; }

    this.isAdjusting = true;
    try {
      // Verify password first
      const authCheck = await this.svc.verifyPassword(this.adjustPassword);
      if (!authCheck.success) { this.notify.error('Denied', 'Invalid password.'); return; }

      const r = await this.svc.adjustStock(this.adjustItem.id, this.adjustQty, this.adjustNotes);
      if (!r.success) { this.notify.error('Failed', r.message ?? 'Adjustment failed.'); return; }
      this.notify.success('Adjusted', `Stock updated by ${this.adjustQty > 0 ? '+' : ''}${this.adjustQty}`);
      this.showAdjustModal = false;
      await this.loadItems();
    } catch (e: any) {
      this.notify.error('Error', e?.response?.data?.message ?? 'Unexpected error.');
    }
    finally { this.isAdjusting = false; }
  }

  // ── Stock History ─────────────────────────────────────────────────────

  async openStockHistory(item: InventoryItem): Promise<void> {
    this.historyItem = item;
    this.showHistoryModal = true;
    this.isLoadingHistory = true;
    try {
      const r = await this.svc.getStockHistory(item.id);
      this.stockHistory = r.data ?? [];
    } catch { this.stockHistory = []; }
    finally { this.isLoadingHistory = false; }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Brand autocomplete for item form
  onBrandInput(value: string): void {
    if (this.brandSearchTimer) clearTimeout(this.brandSearchTimer);
    if (value.trim().length < 1) { this.brandSuggestions = []; this.showBrandDropdown = false; return; }
    this.brandSearchTimer = setTimeout(() => void this.searchBrands(value), 250);
  }

  private async searchBrands(q: string): Promise<void> {
    try { const r = await this.svc.getBrands(q); this.brandSuggestions = r.data ?? []; this.showBrandDropdown = this.brandSuggestions.length > 0; }
    catch { this.brandSuggestions = []; this.showBrandDropdown = false; }
  }

  selectBrand(name: string): void { this.itemForm.brand = name; this.showBrandDropdown = false; }

  // Category autocomplete for item form
  onCategoryInput(value: string): void {
    if (this.categorySearchTimer) clearTimeout(this.categorySearchTimer);
    if (value.trim().length < 1) { this.categorySuggestions = []; this.showCategoryDropdown = false; return; }
    this.categorySearchTimer = setTimeout(() => void this.searchCategories(value), 250);
  }

  private async searchCategories(q: string): Promise<void> {
    try { const r = await this.svc.getCategories(q); this.categorySuggestions = r.data ?? []; this.showCategoryDropdown = this.categorySuggestions.length > 0; }
    catch { this.categorySuggestions = []; this.showCategoryDropdown = false; }
  }

  selectCategory(name: string): void { this.itemForm.category = name; this.showCategoryDropdown = false; }

  // Brand autocomplete for PO items
  onPoItemBrandInput(index: number, value: string): void {
    if (value.trim().length < 1) { this.poItemBrandSuggestions[index] = []; this.showPoItemBrandDropdown[index] = false; return; }
    setTimeout(() => void this.searchPoItemBrands(index, value), 250);
  }

  private async searchPoItemBrands(index: number, q: string): Promise<void> {
    try { const r = await this.svc.getBrands(q); this.poItemBrandSuggestions[index] = r.data ?? []; this.showPoItemBrandDropdown[index] = (this.poItemBrandSuggestions[index]?.length ?? 0) > 0; }
    catch { this.poItemBrandSuggestions[index] = []; this.showPoItemBrandDropdown[index] = false; }
  }

  selectPoItemBrand(index: number, name: string): void { this.poItems[index].brand = name; this.showPoItemBrandDropdown[index] = false; }

  // Category autocomplete for PO items
  onPoItemCategoryInput(index: number, value: string): void {
    if (value.trim().length < 1) { this.poItemCategorySuggestions[index] = []; this.showPoItemCategoryDropdown[index] = false; return; }
    setTimeout(() => void this.searchPoItemCategories(index, value), 250);
  }

  private async searchPoItemCategories(index: number, q: string): Promise<void> {
    try { const r = await this.svc.getCategories(q); this.poItemCategorySuggestions[index] = r.data ?? []; this.showPoItemCategoryDropdown[index] = (this.poItemCategorySuggestions[index]?.length ?? 0) > 0; }
    catch { this.poItemCategorySuggestions[index] = []; this.showPoItemCategoryDropdown[index] = false; }
  }

  selectPoItemCategory(index: number, name: string): void { this.poItems[index].category = name; this.showPoItemCategoryDropdown[index] = false; }

  private emptyItemForm() { return { partName: '', category: '', brand: '', description: '', stockQty: 0, stockWarning: 0, costPrice: 0, sellingPrice: 0, marginPercent: null as number | null }; }
  private emptyPOForm() {
    const today = new Date().toISOString().slice(0, 10);
    return { supplierId: null as number | null, comments: '', orderDate: today, expectedDate: today };
  }
  private poItemUid = 0;
  private emptyPOItem(): PurchaseOrderItem & { _uid: number } { return { _uid: ++this.poItemUid, itemName: '', brand: '', category: '', quantity: 1, unitCost: 0, inventoryId: null }; }
}
