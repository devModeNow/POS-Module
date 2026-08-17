import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { DatePickerComponent } from '../../shared/components/form/date-picker/date-picker.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { ConfirmDialogComponent } from '../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import { InventoryItem, InventoryService, PurchaseOrder, PurchaseOrderItem, Supplier } from '../../shared/services/inventory.service';
import { InventoryProductRow, InventoryVariantRow, PosService } from '../../shared/services/pos.service';
import { OrgService } from '../../shared/services/org.service';
import { RbacService } from '../../shared/services/rbac.service';
import { NotificationService } from '../../shared/services/notification.service';
import { ActionBusyService } from '../../shared/services/action-busy.service';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import {
  kilosToStockGrams,
  stockGramsToKilos,
  tracksStockInGrams,
} from '../../shared/utils/weight-stock.util';

type MainTab = 'inventory' | 'purchase-orders' | 'reports';
type DrawerMode = 'create' | 'edit';
type PosInventoryView = 'products' | 'variants';
type InventoryItemFilter = 'active' | 'deleted';
type SortDirection = 'asc' | 'desc';

type InventoryTableColumn = {
  key: string;
  label: string;
  sortable: boolean;
  hideable: boolean;
};

type UnitQtyPriceForm = {
  qty: number;
  price: number;
};

type VariantUnitFormRow = {
  id?: number;
  unitType: string;
  sellingPrice: number;
  salePrice: number | null;
  isManualEntry: boolean;
  isDefault: boolean;
  productSource: 'Retail' | 'Wholesale';
  stockQty: number;
  stockWarning: number;
  costPrice: number;
  defaultQty: number;
  qtyPrices: UnitQtyPriceForm[];
  collapsed: boolean;
};

type VariantSubVariantFormRow = {
  id?: number;
  sortOrder?: number;
  tempType: 'hot' | 'iced' | '';
  sizeLabel: string;
  sellingPrice: number;
  salePrice: number | null;
  stockQty: number;
  stockWarning: number;
};

type VariantFormRow = {
  id?: number;
  variantName: string;
  costPrice: number;
  sellingPrice: number;
  salePrice: number | null;
  marginPercent: number | null;
  unitType: string;
  hasSugarLevel: boolean;
  barcode: string;
  collapsed: boolean;
  subVariantsCollapsed: boolean;
  unitsCollapsed: boolean;
  units: VariantUnitFormRow[];
  subVariants: VariantSubVariantFormRow[];
  imageUrl: string | null;
  imagePreview: string | null;
  imageFile: File | null;
};

type ProductFormState = {
  id: number | null;
  name: string;
  category: string;
  brand: string;
  description: string;
  imageUrl: string | null;
  imagePreview: string | null;
  imageFile: File | null;
  variants: VariantFormRow[];
};

type PosImportProductGroup = {
  name: string;
  category?: string;
  brand?: string;
  description?: string;
  variants: Array<{
    variantName: string;
    unitType?: string;
    stockQty: number;
    stockWarning: number;
    costPrice: number;
    sellingPrice: number;
    salePrice: number | null;
    barcode?: string | null;
  }>;
};

@Component({
  selector: 'app-inventory',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, DatePickerComponent, CanDirective, ConfirmDialogComponent],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit, OnDestroy {
  private orgContextSub?: Subscription;
  activeTab: MainTab = 'inventory';
  isPosOrg = false;

  // Inventory tab
  items: InventoryItem[] = [];
  variantItems: InventoryVariantRow[] = [];
  productItems: InventoryProductRow[] = [];
  posInventoryView: PosInventoryView = 'products';
  inventoryItemFilter: InventoryItemFilter = 'active';
  unitTypeOptions: { value: string; label: string; usageScope: 'Beverages' | 'Others' }[] = [];
  allUnitTypeOptions: { value: string; label: string; usageScope: 'Beverages' | 'Others' }[] = [];
  productForm: ProductFormState = this.emptyProductForm();
  editingProductId: number | null = null;
  editingVariantOnly = false;
  editingVariantId: number | null = null;
  search = '';
  searchFocused = false;
  private inventorySearchTimer: ReturnType<typeof setTimeout> | null = null;
  categoryFilter = '';
  categoryOptions: { id: number; name: string }[] = [];
  isLoadingItems = false;
  isItemDrawerOpen = false;
  isSavingItem = false;
  itemDrawerMode: DrawerMode = 'create';
  editingItemId: number | null = null;
  itemForm = this.emptyItemForm();
  itemImageFile: File | null = null;
  itemImagePreview: string | null = null;
  existingImageUrl: string | null = null;
  isUploadingImage = false;

  // Pagination
  currentPage = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50];
  sortColumn = '';
  sortDirection: SortDirection = 'asc';
  tableSettingsOpen = false;

  readonly variantTableColumns: InventoryTableColumn[] = [
    { key: 'image', label: 'Image', sortable: false, hideable: false },
    { key: 'variantName', label: 'Variant', sortable: true, hideable: true },
    { key: 'barcode', label: 'Barcode', sortable: true, hideable: true },
    { key: 'productName', label: 'Product', sortable: true, hideable: true },
    { key: 'category', label: 'Category', sortable: true, hideable: true },
    { key: 'unitType', label: 'Unit', sortable: true, hideable: true },
    { key: 'stockQty', label: 'Stock', sortable: true, hideable: true },
    { key: 'sellingPrice', label: 'Selling', sortable: true, hideable: true },
    { key: 'actions', label: 'Actions', sortable: false, hideable: false },
  ];

  readonly productTableColumns: InventoryTableColumn[] = [
    { key: 'image', label: 'Image', sortable: false, hideable: false },
    { key: 'name', label: 'Product', sortable: true, hideable: true },
    { key: 'category', label: 'Category', sortable: true, hideable: true },
    { key: 'variantCount', label: 'Variants', sortable: true, hideable: true },
    { key: 'totalStock', label: 'Total stock', sortable: true, hideable: true },
    { key: 'priceRange', label: 'Price range', sortable: true, hideable: true },
    { key: 'actions', label: 'Actions', sortable: false, hideable: false },
  ];

  variantColumnVisible: Record<string, boolean> = Object.fromEntries(
    this.variantTableColumns.map((c) => [c.key, true]),
  );
  productColumnVisible: Record<string, boolean> = Object.fromEntries(
    this.productTableColumns.map((c) => [c.key, true]),
  );

  get activeTableColumns(): InventoryTableColumn[] {
    return this.posInventoryView === 'variants' ? this.variantTableColumns : this.productTableColumns;
  }

  get activeColumnVisible(): Record<string, boolean> {
    return this.posInventoryView === 'variants' ? this.variantColumnVisible : this.productColumnVisible;
  }

  get visibleColumnCount(): number {
    return this.activeTableColumns.filter((c) => this.activeColumnVisible[c.key] !== false).length;
  }

  get isEditingVariantOnly(): boolean {
    return this.editingVariantOnly && this.editingVariantId != null;
  }

  get itemDrawerTitle(): string {
    if (!this.isPosOrg) {
      return this.itemDrawerMode === 'create' ? 'Add Item' : 'Edit Item';
    }
    if (this.isEditingVariantOnly) return 'Edit Variant';
    return this.itemDrawerMode === 'create' ? 'Add Product' : 'Edit Product';
  }

  get sortedFilteredVariants(): InventoryVariantRow[] {
    return this.applySort(this.filteredVariants, this.sortColumn);
  }

  get sortedFilteredProducts(): InventoryProductRow[] {
    return this.applySort(this.filteredProducts, this.sortColumn);
  }

  get isDeletedView(): boolean {
    return this.isPosOrg && this.inventoryItemFilter === 'deleted';
  }
  get inventorySearchSuggestions(): Array<{
    kind: 'product' | 'variant';
    id: number;
    label: string;
    sub?: string;
    imageUrl?: string | null;
  }> {
    const q = this.search.trim().toLowerCase();
    if (!q || !this.isPosOrg) return [];
    if (this.posInventoryView === 'variants') {
      return this.filteredVariants.slice(0, 8).map((v) => ({
        kind: 'variant' as const,
        id: v.id,
        label: v.variantName,
        sub: v.productName,
        imageUrl: v.imageUrl,
      }));
    }
    return this.filteredProducts.slice(0, 8).map((p) => ({
      kind: 'product' as const,
      id: p.id,
      label: p.name,
      sub: p.category ?? undefined,
      imageUrl: p.imageUrl,
    }));
  }
  get paginatedListLength(): number {
    if (!this.isPosOrg) return this.filteredItems.length;
    return this.posInventoryView === 'products' ? this.filteredProducts.length : this.filteredVariants.length;
  }
  get totalPages(): number {
    const count = this.isPosOrg
      ? (this.posInventoryView === 'products' ? this.filteredProducts.length : this.filteredVariants.length)
      : this.filteredItems.length;
    return Math.ceil(count / this.pageSize) || 1;
  }
  get filteredItems(): InventoryItem[] {
    if (!this.search.trim()) return this.items;
    const q = this.search.toLowerCase();
    return this.items.filter(i =>
      i.partName?.toLowerCase().includes(q) ||
      i.brand?.toLowerCase().includes(q) ||
      i.category?.toLowerCase().includes(q)
    );
  }
  get filteredVariants(): InventoryVariantRow[] {
    if (!this.search.trim()) return this.variantItems;
    const q = this.search.toLowerCase();
    return this.variantItems.filter(v =>
      v.productName?.toLowerCase().includes(q) ||
      v.variantName?.toLowerCase().includes(q) ||
      v.barcode?.toLowerCase().includes(q) ||
      v.category?.toLowerCase().includes(q)
    );
  }
  get filteredProducts(): InventoryProductRow[] {
    if (!this.search.trim()) return this.productItems;
    const q = this.search.toLowerCase();
    return this.productItems.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q)
    );
  }
  get paginatedItems(): InventoryItem[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredItems.slice(start, start + this.pageSize);
  }
  get paginatedVariants(): InventoryVariantRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.sortedFilteredVariants.slice(start, start + this.pageSize);
  }
  get paginatedProducts(): InventoryProductRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.sortedFilteredProducts.slice(start, start + this.pageSize);
  }
  goToPage(page: number): void { if (page >= 1 && page <= this.totalPages) this.currentPage = page; }
  nextPage(): void { this.goToPage(this.currentPage + 1); }
  prevPage(): void { this.goToPage(this.currentPage - 1); }
  onPageSizeChange(): void { this.currentPage = 1; }

  toggleSort(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.currentPage = 1;
  }

  sortIndicator(column: string): string {
    if (this.sortColumn !== column) return '';
    return this.sortDirection === 'asc' ? ' ↑' : ' ↓';
  }

  isColumnVisible(key: string): boolean {
    return this.activeColumnVisible[key] !== false;
  }

  toggleColumnVisibility(key: string): void {
    const target = this.posInventoryView === 'variants' ? this.variantColumnVisible : this.productColumnVisible;
    target[key] = !target[key];
  }

  resetTableSettings(): void {
    for (const col of this.activeTableColumns) {
      if (col.hideable) {
        this.activeColumnVisible[col.key] = true;
      }
    }
    this.sortColumn = '';
    this.sortDirection = 'asc';
    this.currentPage = 1;
  }

  private applySort<T>(rows: T[], column: string): T[] {
    if (!column) return rows;
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const leftValue = this.sortValue(left as Record<string, unknown>, column);
      const rightValue = this.sortValue(right as Record<string, unknown>, column);
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * dir;
      }
      return String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base' }) * dir;
    });
  }

  private sortValue(row: Record<string, unknown>, column: string): string | number {
    if (column === 'priceRange') return Number(row['minPrice'] ?? 0);
    const value = row[column];
    if (typeof value === 'number') return value;
    if (value == null) return '';
    return String(value);
  }

  onInventoryItemFilterChange(): void {
    this.currentPage = 1;
    void this.loadItems();
  }

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
  productCategorySuggestions: { id: number; name: string }[] = [];
  brandSearchTimer: ReturnType<typeof setTimeout> | null = null;
  categorySearchTimer: ReturnType<typeof setTimeout> | null = null;
  productCategorySearchTimer: ReturnType<typeof setTimeout> | null = null;
  showBrandDropdown = false;
  showCategoryDropdown = false;
  showProductCategoryDropdown = false;
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

  // POS Import/Export
  showPosImportModal = false;
  posImportFileName = '';
  posImportRows: PosImportProductGroup[] = [];
  isPosImporting = false;
  posImportResult: {
    success: boolean;
    importedProducts?: number;
    updatedProducts?: number;
    importedVariants?: number;
    updatedVariants?: number;
    errors?: string[];
    message?: string;
  } | null = null;

  get posImportVariantCount(): number {
    return this.posImportRows.reduce((sum, g) => sum + g.variants.length, 0);
  }

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

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmVariant: 'primary' | 'danger' = 'primary';
  private confirmAction: (() => void) | null = null;

  constructor(
    private readonly svc: InventoryService,
    private readonly posSvc: PosService,
    private readonly orgSvc: OrgService,
    private readonly rbacSvc: RbacService,
    private readonly notify: NotificationService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  ngOnInit(): void {
    this.syncPosOrgFlag();
    void this.loadCategoryOptions();
    void this.loadUnitTypeOptions();
    void this.loadItems();
    void this.loadSuppliers();

    this.orgContextSub = this.orgSvc.context$.subscribe(() => {
      const wasPosOrg = this.isPosOrg;
      this.syncPosOrgFlag();
      if (wasPosOrg !== this.isPosOrg) {
        void this.loadUnitTypeOptions();
        void this.loadItems();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.inventorySearchTimer) clearTimeout(this.inventorySearchTimer);
    this.orgContextSub?.unsubscribe();
  }

  private syncPosOrgFlag(): void {
    this.isPosOrg = this.orgSvc.isPosOrg() || this.rbacSvc.isPosOrg();
  }

  private hasInventoryData(): boolean {
    if (this.isPosOrg) {
      return this.productItems.length > 0 || this.variantItems.length > 0;
    }
    return this.items.length > 0;
  }

  switchTab(tab: MainTab): void {
    this.activeTab = tab;
    if (tab === 'inventory' && !this.hasInventoryData()) void this.loadItems();
    if (tab === 'purchase-orders' && this.purchaseOrders.length === 0) void this.loadPO();
    if (tab === 'reports') void this.loadLowStock();
  }

  // ── Inventory ─────────────────────────────────────────────────────────────

  async loadItems(): Promise<void> {
    this.isLoadingItems = true;
    try {
      await this.actionBusy.run('inventory-load', async () => {
        if (this.isPosOrg) {
          const deletedOnly = this.inventoryItemFilter === 'deleted';
          const [variantsR, productsR] = await Promise.all([
            this.posSvc.getInventoryVariants(
              undefined,
              this.categoryFilter || undefined,
              deletedOnly,
            ),
            this.posSvc.getInventoryProducts(
              undefined,
              this.categoryFilter || undefined,
              deletedOnly,
            ),
          ]);
          this.variantItems = variantsR?.success !== false && Array.isArray(variantsR?.data) ? variantsR.data : [];
          this.productItems = productsR?.success !== false && Array.isArray(productsR?.data) ? productsR.data : [];
          if (productsR?.success === false) {
            this.notify.error('Load failed', productsR.message ?? 'Could not load product types.');
          }
        } else {
          const r = await this.svc.getAll(
            this.search || undefined,
            this.categoryFilter || undefined,
          );
          this.items = r.data ?? [];
        }
      });
    }
    catch {
      this.items = [];
      this.variantItems = [];
      this.productItems = [];
    }
    finally { this.isLoadingItems = false; }
  }

  async loadCategoryOptions(): Promise<void> {
    try {
      const r = await this.svc.getCategories();
      this.categoryOptions = r.data ?? [];
    } catch {
      this.categoryOptions = [];
    }
  }

  async loadUnitTypeOptions(): Promise<void> {
    if (!this.isPosOrg) return;
    try {
      const r = await this.svc.getUnitTypes();
      if (r.success && r.data) {
        this.allUnitTypeOptions = r.data
          .filter((u) => u.isActive !== false)
          .map((u) => ({
            value: u.code,
            label: u.label,
            usageScope: (u.usageScope === 'Beverages' ? 'Beverages' : 'Others') as 'Beverages' | 'Others',
          }));
      } else {
        this.allUnitTypeOptions = [];
      }
    } catch {
      this.allUnitTypeOptions = [];
    }
    this.refreshUnitTypeOptionsForCategory();
  }

  isBeveragesCategory(category?: string | null): boolean {
    const n = String(category ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    return n === 'beverages' || n === 'bevarages';
  }

  normalizeBeveragesCategory(category: string): string {
    return this.isBeveragesCategory(category) ? 'Beverages' : category.trim();
  }

  refreshUnitTypeOptionsForCategory(): void {
    const scope: 'Beverages' | 'Others' = this.isBeveragesCategory(this.productForm.category)
      ? 'Beverages'
      : 'Others';
    this.unitTypeOptions = this.allUnitTypeOptions.filter((u) => u.usageScope === scope);
  }

  onProductCategoryPickedOrTyped(): void {
    if (this.isBeveragesCategory(this.productForm.category)) {
      this.productForm.category = 'Beverages';
      for (const v of this.productForm.variants) {
        v.unitsCollapsed = true;
      }
    } else {
      for (const v of this.productForm.variants) {
        v.unitsCollapsed = false;
      }
    }
    this.refreshUnitTypeOptionsForCategory();
    this.sanitizeProductFormUnits();
  }

  onCategoryFilterChange(): void {
    this.currentPage = 1;
    void this.loadItems();
  }

  onSearchInput(): void {
    this.currentPage = 1;
    if (!this.isPosOrg) {
      if (this.inventorySearchTimer) clearTimeout(this.inventorySearchTimer);
      this.inventorySearchTimer = setTimeout(() => void this.loadItems(), 300);
    }
  }

  onSearchBlur(): void {
    setTimeout(() => { this.searchFocused = false; }, 150);
  }

  pickInventorySearchSuggestion(item: { kind: 'product' | 'variant'; id: number; label: string }): void {
    this.search = item.label;
    this.searchFocused = false;
    this.currentPage = 1;
    if (item.kind === 'variant') {
      this.posInventoryView = 'variants';
      void this.openEditProductById(
        this.variantItems.find((v) => v.id === item.id)?.productId ?? 0,
        item.id,
      );
    } else {
      this.posInventoryView = 'products';
      void this.openEditProductById(item.id);
    }
  }

  openCreateItem(): void {
    if (this.isPosOrg) {
      void this.loadUnitTypeOptions().then(() => {
        const draft = this.loadProductFormDraft();
        this.productForm = draft ?? this.emptyProductForm();
        this.sanitizeProductFormUnits();
        this.editingProductId = null;
        this.editingVariantOnly = false;
        this.editingVariantId = null;
        this.itemDrawerMode = 'create';
        this.isItemDrawerOpen = true;
      });
      return;
    }
    const itemDraft = this.loadItemFormDraft();
    this.itemForm = itemDraft ?? this.emptyItemForm();
    this.itemDrawerMode = 'create';
    this.editingItemId = null;
    this.itemImageFile = null;
    this.itemImagePreview = null;
    this.existingImageUrl = null;
    this.isItemDrawerOpen = true;
  }

  openEditItem(item: InventoryItem): void {
    this.itemForm = {
      partName: item.partName,
      category: item.category ?? '',
      brand: item.brand ?? '',
      description: item.description ?? '',
      stockQty: item.stockQty,
      stockWarning: item.stockWarning ?? 0,
      costPrice: item.costPrice ?? 0,
      sellingPrice: item.sellingPrice ?? 0,
      salePrice: item.salePrice ?? null,
      marginPercent: item.marginPercent ?? this.computeMargin(item.costPrice ?? 0, item.sellingPrice ?? 0),
      unitType: item.unitType ?? 'piece',
    };
    this.itemDrawerMode = 'edit';
    this.editingItemId = item.id;
    this.itemImageFile = null;
    this.itemImagePreview = null;
    this.existingImageUrl = item.imageUrl ?? null;
    this.isItemDrawerOpen = true;
  }

  closeItemDrawer(): void {
    if (!this.isSavingItem) {
      this.persistFormDraft();
      this.isItemDrawerOpen = false;
      this.editingVariantOnly = false;
      this.editingVariantId = null;
    }
  }

  private draftStorageKey(suffix: string): string {
    const orgId = this.orgSvc.getContext().id ?? 0;
    return `inventoryFormDraft:${orgId}:${suffix}`;
  }

  private productFormHasDraftContent(): boolean {
    return Boolean(
      this.productForm.name.trim()
      || this.productForm.category.trim()
      || this.productForm.brand.trim()
      || this.productForm.description.trim()
      || this.productForm.variants.some((v) => v.variantName.trim()),
    );
  }

  private itemFormHasDraftContent(): boolean {
    return Boolean(this.itemForm.partName.trim() || this.itemForm.category.trim() || this.itemForm.brand.trim());
  }

  private persistFormDraft(): void {
    if (this.itemDrawerMode !== 'create') return;
    if (this.isPosOrg) {
      if (!this.productFormHasDraftContent()) {
        sessionStorage.removeItem(this.draftStorageKey('product'));
        return;
      }
      sessionStorage.setItem(this.draftStorageKey('product'), JSON.stringify({
        productForm: {
          ...this.productForm,
          imageFile: null,
          imagePreview: this.productForm.imageUrl ?? null,
          variants: this.productForm.variants.map((v) => ({
            ...v,
            imageFile: null,
            imagePreview: v.imageUrl ?? null,
          })),
        },
      }));
      return;
    }
    if (!this.itemFormHasDraftContent()) {
      sessionStorage.removeItem(this.draftStorageKey('item'));
      return;
    }
    sessionStorage.setItem(this.draftStorageKey('item'), JSON.stringify({ itemForm: this.itemForm }));
  }

  private loadProductFormDraft(): typeof this.productForm | null {
    try {
      const raw = sessionStorage.getItem(this.draftStorageKey('product'));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { productForm?: unknown };
      if (!parsed.productForm || typeof parsed.productForm !== 'object') return null;
      const form = parsed.productForm as typeof this.productForm;
      return {
        ...form,
        imageFile: null,
        variants: (form.variants?.length ? form.variants : [this.emptyVariantRow()]).map((v: typeof form.variants[number]) => ({
          ...v,
          collapsed: v.collapsed ?? false,
          unitsCollapsed: v.unitsCollapsed ?? this.isBeveragesCategory(form.category),
          imageFile: null,
          units: (() => {
            const beverages = this.isBeveragesCategory(form.category);
            const list = v.units?.length ? v.units : (beverages ? [] : [this.emptyUnitRow()]);
            return list.map((u, ui) => ({
              ...u,
              qtyPrices: Array.isArray(u.qtyPrices) ? u.qtyPrices : [],
              collapsed: u.collapsed ?? ui > 0,
            }));
          })(),
        })),
      };
    } catch {
      return null;
    }
  }

  private loadItemFormDraft(): typeof this.itemForm | null {
    try {
      const raw = sessionStorage.getItem(this.draftStorageKey('item'));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { itemForm?: unknown };
      if (!parsed.itemForm || typeof parsed.itemForm !== 'object') return null;
      return parsed.itemForm as typeof this.itemForm;
    } catch {
      return null;
    }
  }

  private clearFormDrafts(): void {
    sessionStorage.removeItem(this.draftStorageKey('product'));
    sessionStorage.removeItem(this.draftStorageKey('item'));
  }

  readonly unitTypes = ['piece', 'grams', 'kilo', 'pack', 'sack', 'liter', 'box', 'bottle', 'can', 'tray'];

  private defaultUnitTypeCode(): string {
    return this.unitTypeOptions?.[0]?.value ?? 'piece';
  }

  private activeUnitTypeCodes(): Set<string> {
    return new Set(this.unitTypeOptions.map((o) => o.value.toLowerCase()));
  }

  private sanitizeProductFormUnits(): void {
    const activeCodes = this.activeUnitTypeCodes();
    if (!activeCodes.size) return;

    const defaultCode = this.defaultUnitTypeCode();
    const beverages = this.isBeveragesCategory(this.productForm.category);
    for (let vi = 0; vi < this.productForm.variants.length; vi++) {
      const v = this.productForm.variants[vi];
      v.units = v.units.filter((u) =>
        activeCodes.has(this.normalizeUnitType(u.unitType).toLowerCase()),
      );
      if (!v.units.length) {
        // Beverages: unit types are optional (pricing comes from sub-variants).
        if (!beverages) {
          v.units = [this.emptyUnitRow()];
        }
      }
      if (v.units.length && !v.units.some((u) => u.isDefault)) {
        v.units[0].isDefault = true;
      }
      for (const u of v.units) {
        if (!activeCodes.has(this.normalizeUnitType(u.unitType).toLowerCase())) {
          u.unitType = defaultCode;
        }
      }
      this.syncVariantPrimaryUnit(vi);
    }
  }

  unitPriceHint(unit: VariantUnitFormRow | string): string {
    const u = typeof unit === 'string'
      ? { unitType: unit, defaultQty: 1, isManualEntry: false } as VariantUnitFormRow
      : unit;
    if (this.unitPricesByDefaultQty(u)) {
      const qty = this.toFiniteNumber(u.defaultQty, this.isGramsUnit(u.unitType) ? 200 : 1);
      return `Price for ${qty} ${this.unitQtyLabel(u.unitType)}`;
    }
    if (u.unitType === 'kilo') return 'Price per kilo';
    if (u.unitType === 'grams') return 'Price per gram';
    return 'Selling price per unit';
  }

  unitSalePriceHint(unit: VariantUnitFormRow): string {
    if (this.unitPricesByDefaultQty(unit)) {
      const qty = this.toFiniteNumber(unit.defaultQty, 200);
      return `Sale price for ${qty} ${this.unitQtyLabel(unit.unitType)}`;
    }
    return 'Sale price';
  }

  unitPriceHelper(unit: VariantUnitFormRow): string {
    const qty = this.toFiniteNumber(unit.defaultQty, 200);
    return `Enter the sell price for ${qty} ${this.unitQtyLabel(unit.unitType)}. Cashier qty still sells by the gram.`;
  }

  unitPricesByDefaultQty(unit: Pick<VariantUnitFormRow, 'unitType' | 'isManualEntry'>): boolean {
    return this.isGramsUnit(unit.unitType) || Boolean(unit.isManualEntry);
  }

  private normalizeQtyPricesForm(raw: unknown): UnitQtyPriceForm[] {
    if (!Array.isArray(raw)) return [];
    const out: UnitQtyPriceForm[] = [];
    const seen = new Set<number>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const qty = this.toFiniteNumber((item as { qty?: unknown }).qty, 0);
      const price = this.toFiniteNumber((item as { price?: unknown }).price, 0);
      if (qty <= 0 || price < 0) continue;
      const key = Math.round(qty * 1000) / 1000;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ qty: key, price: Math.round(price * 100) / 100 });
    }
    return out.sort((a, b) => a.qty - b.qty);
  }

  addQtyPriceRow(variantIndex: number, unitIndex: number): void {
    const unit = this.productForm.variants[variantIndex]?.units?.[unitIndex];
    if (!unit) return;
    if (!unit.qtyPrices) unit.qtyPrices = [];
    const last = unit.qtyPrices[unit.qtyPrices.length - 1];
    const nextQty = last
      ? Math.round((Number(last.qty) + (this.isGramsUnit(unit.unitType) ? 25 : 1)) * 1000) / 1000
      : (this.isGramsUnit(unit.unitType) ? 25 : 1);
    unit.qtyPrices = [...unit.qtyPrices, { qty: nextQty, price: 0 }];
    this.syncUnitDefaultFromQtyPrices(unit);
  }

  removeQtyPriceRow(variantIndex: number, unitIndex: number, tierIndex: number): void {
    const unit = this.productForm.variants[variantIndex]?.units?.[unitIndex];
    if (!unit?.qtyPrices?.length) return;
    unit.qtyPrices = unit.qtyPrices.filter((_, i) => i !== tierIndex);
    this.syncUnitDefaultFromQtyPrices(unit);
  }

  onQtyPriceChange(variantIndex: number, unitIndex: number): void {
    const unit = this.productForm.variants[variantIndex]?.units?.[unitIndex];
    if (!unit) return;
    this.syncUnitDefaultFromQtyPrices(unit);
    this.onUnitPriceChange(variantIndex);
  }

  private syncUnitDefaultFromQtyPrices(unit: VariantUnitFormRow): void {
    const tiers = this.normalizeQtyPricesForm(unit.qtyPrices);
    unit.qtyPrices = tiers;
    if (!tiers.length) return;
    unit.defaultQty = tiers[0].qty;
    // Keep form selling price aligned with first tier total (grams: price for that qty).
    unit.sellingPrice = tiers[0].price;
  }

  private unitQtyLabel(unitType: string | null | undefined): string {
    const t = this.normalizeUnitType(unitType);
    if (t === 'grams' || t === 'manual') return 'g';
    if (t === 'kilo') return 'kg';
    return t || 'unit';
  }

  /** Form shows price for default qty; DB stores per-gram for weight units. */
  private unitPriceFromStorage(
    unit: Pick<VariantUnitFormRow, 'unitType' | 'isManualEntry' | 'defaultQty'>,
    storedPrice: number | null | undefined,
  ): number | null {
    if (storedPrice == null) return null;
    const price = this.toFiniteNumber(storedPrice, 0);
    if (!this.unitPricesByDefaultQty(unit)) return price;
    const qty = Math.max(0.01, this.toFiniteNumber(unit.defaultQty, 200));
    return Math.round(price * qty * 10000) / 10000;
  }

  private unitPriceToStorage(
    unit: Pick<VariantUnitFormRow, 'unitType' | 'isManualEntry' | 'defaultQty'>,
    formPrice: number | null | undefined,
  ): number | null {
    if (formPrice == null) return null;
    const price = this.toFiniteNumber(formPrice, 0);
    if (!this.unitPricesByDefaultQty(unit)) return price;
    const qty = Math.max(0.01, this.toFiniteNumber(unit.defaultQty, 200));
    return Math.round((price / qty) * 1000000) / 1000000;
  }

  onCostPriceChange(): void {
    this.syncMarginFromPrices();
    if (this.itemForm.marginPercent != null && this.itemForm.marginPercent > 0) {
      this.applyMarginToSellingPrice();
    }
  }

  onSellingPriceChange(): void {
    this.syncMarginFromPrices();
  }

  onMarginPercentChange(): void {
    this.applyMarginToSellingPrice();
  }

  private computeMargin(cost: number, selling: number): number | null {
    const c = Number(cost);
    const s = Number(selling);
    if (!Number.isFinite(c) || !Number.isFinite(s) || c <= 0 || s <= 0) return null;
    const margin = ((s - c) / c) * 100;
    if (!Number.isFinite(margin)) return null;
    const clamped = Math.max(-99999999.99, Math.min(99999999.99, margin));
    return Math.round(clamped * 100) / 100;
  }

  private toFiniteNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private syncMarginFromPrices(): void {
    const margin = this.computeMargin(this.itemForm.costPrice, this.itemForm.sellingPrice);
    this.itemForm.marginPercent = margin;
  }

  private applyMarginToSellingPrice(): void {
    if (!this.itemForm.costPrice || this.itemForm.costPrice <= 0) return;
    if (this.itemForm.marginPercent == null) return;
    const computed = this.itemForm.costPrice * (1 + this.itemForm.marginPercent / 100);
    this.itemForm.sellingPrice = Math.round(computed * 100) / 100;
  }


  onPosInventoryViewChange(view: PosInventoryView): void {
    this.posInventoryView = view;
    this.currentPage = 1;
    this.sortColumn = '';
    this.sortDirection = 'asc';
    this.tableSettingsOpen = false;
  }

  async openEditProductById(productId: number, singleVariantId?: number): Promise<void> {
    try {
      await this.loadUnitTypeOptions();
      const r = await this.posSvc.getInventoryProduct(productId);
      if (!r.success || !r.data) {
        this.notify.error('Error', r.message ?? 'Failed to load product.');
        return;
      }
      await this.populateProductForm(r.data, singleVariantId);
    } catch {
      this.notify.error('Error', 'Failed to load product.');
    }
  }

  async openEditProduct(variant: InventoryVariantRow): Promise<void> {
    await this.openEditProductById(variant.productId, variant.id);
  }

  private async populateProductForm(
    d: {
    id: number;
    name: string;
    category?: string | null;
    brand?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    variants?: Array<InventoryVariantRow>;
  },
    singleVariantId?: number,
  ): Promise<void> {
      this.productForm = {
        id: d.id,
        name: d.name,
        category: d.category ?? '',
        brand: d.brand ?? '',
        description: d.description ?? '',
        imageUrl: d.imageUrl ?? null,
        imagePreview: d.imageUrl ?? null,
        imageFile: null,
        variants: (d.variants ?? []).map((v) => {
          const beverages = this.isBeveragesCategory(d.category);
          const unitSource = v.units?.length
            ? v.units
            : beverages
              ? []
              : [{
                  unitType: this.normalizeUnitType(v.unitType),
                  sellingPrice: v.sellingPrice ?? 0,
                  salePrice: v.salePrice ?? null,
                  isManualEntry: false,
                  isDefault: true,
                  productSource: this.resolveProductSource(v.productSource, v.unitType, false),
                }];
          const units = unitSource.map((u, ui): VariantUnitFormRow => {
            const unitType = this.normalizeUnitType(u.unitType);
            const rawStock = Number((u as { stockQty?: number }).stockQty ?? 0);
            const rawWarning = Number((u as { stockWarning?: number }).stockWarning ?? 0);
            const unitCost = Number((u as { costPrice?: number }).costPrice ?? v.costPrice ?? 0);
            const isGrams = this.isGramsUnit(unitType);
            const fallbackDefault = isGrams ? 200 : 1;
            const defaultQty = Math.max(
              0.01,
              Number((u as { defaultQty?: number }).defaultQty ?? fallbackDefault) || fallbackDefault,
            );
            const qtyPrices = this.normalizeQtyPricesForm((u as { qtyPrices?: unknown }).qtyPrices);
            const effectiveDefault = qtyPrices.length ? qtyPrices[0].qty : defaultQty;
            const unitRowBase = {
              unitType,
              isManualEntry: false,
              defaultQty: effectiveDefault,
            };
            const storedSelling = u.sellingPrice ?? 0;
            const storedSale = u.salePrice ?? null;
            const unitId = Number((u as { id?: number }).id);
            let sellingPrice = this.unitPriceFromStorage(unitRowBase, storedSelling) ?? 0;
            if (qtyPrices.length) {
              sellingPrice = qtyPrices[0].price;
            }
            return {
              id: Number.isFinite(unitId) && unitId > 0 ? unitId : undefined,
              unitType,
              sellingPrice,
              salePrice: this.unitPriceFromStorage(unitRowBase, storedSale),
              isManualEntry: false,
              isDefault: Boolean(u.isDefault) || ui === 0,
              productSource: this.resolveProductSource(
                (u as { productSource?: string }).productSource,
                unitType,
                false,
              ),
              stockQty: this.unitStockFromStorage(unitType, rawStock, false),
              stockWarning: this.unitStockFromStorage(unitType, rawWarning, false),
              costPrice: unitCost,
              defaultQty: effectiveDefault,
              qtyPrices,
              collapsed: ui > 0,
            };
          });
          const primaryUnit = units.find((u) => u.isDefault) ?? units[0];
          return {
          id: v.id,
          variantName: v.variantName,
          costPrice: primaryUnit?.costPrice ?? v.costPrice ?? 0,
          sellingPrice: primaryUnit?.sellingPrice ?? v.sellingPrice ?? 0,
          salePrice: primaryUnit?.salePrice ?? v.salePrice ?? null,
          unitType: this.normalizeUnitType(v.unitType),
          marginPercent: v.marginPercent ?? null,
          hasSugarLevel: Boolean(v.hasSugarLevel),
          barcode: String(v.barcode ?? ''),
          collapsed: false,
          subVariantsCollapsed: false,
          unitsCollapsed: true,
          units,
          subVariants: (v.subVariants ?? []).map((s): VariantSubVariantFormRow => {
            const temp = String(s.tempType ?? '').toLowerCase();
            return {
              id: s.id,
              sortOrder: Number(s.sortOrder ?? 0) || undefined,
              tempType: temp === 'hot' || temp === 'iced' ? temp : '',
              sizeLabel: String(s.sizeLabel ?? ''),
              sellingPrice: Number(s.sellingPrice ?? 0),
              salePrice: s.salePrice ?? null,
              stockQty: Number((s as { stockQty?: number }).stockQty ?? 0),
              stockWarning: Number((s as { stockWarning?: number }).stockWarning ?? 0),
            };
          }),
          imageUrl: v.imageUrl ?? null,
          imagePreview: v.imageUrl ?? null,
          imageFile: null,
        };
        }),
      };
      if (!this.productForm.variants.length) {
        this.productForm.variants = [this.emptyVariantRow()];
      }
      if (singleVariantId) {
        this.productForm.variants = this.productForm.variants.filter((v) => v.id === singleVariantId);
        if (!this.productForm.variants.length) {
          this.notify.error('Error', 'Variant not found on this product.');
          return;
        }
        this.editingVariantOnly = true;
        this.editingVariantId = singleVariantId;
        this.productForm.variants[0].collapsed = false;
      } else {
        this.editingVariantOnly = false;
        this.editingVariantId = null;
        this.productForm.variants.forEach((v, index) => {
          v.collapsed = index > 0;
        });
      }
      this.sanitizeProductFormUnits();
      this.refreshUnitTypeOptionsForCategory();
      this.editingProductId = d.id;
      this.itemDrawerMode = 'edit';
      this.isItemDrawerOpen = true;
  }

  addVariantRow(): void {
    for (const v of this.productForm.variants) {
      v.collapsed = true;
    }
    const row = this.emptyVariantRow(this.isBeveragesCategory(this.productForm.category));
    row.collapsed = false;
    this.productForm.variants.unshift(row);
  }

  moveVariantRow(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= this.productForm.variants.length) return;
    const [row] = this.productForm.variants.splice(index, 1);
    this.productForm.variants.splice(nextIndex, 0, row);
  }

  duplicateVariantRow(index: number): void {
    if (this.isEditingVariantOnly) return;
    const source = this.productForm.variants[index];
    if (!source) return;
    const baseName = String(source.variantName ?? '').trim() || 'Variant';
    const copy = {
      id: undefined as number | undefined,
      variantName: `${baseName} (copy)`,
      costPrice: Number(source.costPrice ?? 0),
      sellingPrice: Number(source.sellingPrice ?? 0),
      salePrice: source.salePrice != null ? Number(source.salePrice) : null,
      marginPercent: source.marginPercent != null ? Number(source.marginPercent) : null,
      unitType: this.normalizeUnitType(source.unitType),
      hasSugarLevel: Boolean(source.hasSugarLevel),
      barcode: '',
      collapsed: false,
      subVariantsCollapsed: false,
      unitsCollapsed: this.isBeveragesCategory(this.productForm.category),
      units: (source.units?.length ? source.units : [this.emptyUnitRow()]).map((u, ui) => ({
        id: undefined as number | undefined,
        unitType: this.normalizeUnitType(u.unitType),
        sellingPrice: Number(u.sellingPrice ?? 0),
        salePrice: u.salePrice != null ? Number(u.salePrice) : null,
        isManualEntry: false,
        isDefault: Boolean(u.isDefault) || ui === 0,
        productSource: this.resolveProductSource(u.productSource, u.unitType, u.isManualEntry),
        stockQty: 0,
        stockWarning: Number(u.stockWarning ?? 0),
        costPrice: Number(u.costPrice ?? 0),
        defaultQty: Math.max(0.01, Number(u.defaultQty ?? (this.isGramsUnit(u.unitType) ? 200 : 1))),
        qtyPrices: this.normalizeQtyPricesForm(u.qtyPrices).map((t) => ({ ...t })),
        collapsed: ui > 0,
      })),
      subVariants: (source.subVariants ?? []).map((s) => ({
        sortOrder: Number(s.sortOrder ?? 0) || undefined,
        tempType: (s.tempType === 'hot' || s.tempType === 'iced' ? s.tempType : '') as 'hot' | 'iced' | '',
        sizeLabel: String(s.sizeLabel ?? ''),
        sellingPrice: Number(s.sellingPrice ?? 0),
        salePrice: s.salePrice != null ? Number(s.salePrice) : null,
        stockQty: 0,
        stockWarning: Number(s.stockWarning ?? 0),
      })),
      imageUrl: source.imageUrl ?? null,
      imagePreview: source.imagePreview ?? source.imageUrl ?? null,
      imageFile: null as File | null,
    };
    if (!copy.units.some((u) => u.isDefault) && copy.units.length) {
      copy.units[0].isDefault = true;
    }
    for (const v of this.productForm.variants) {
      v.collapsed = true;
    }
    this.productForm.variants.unshift(copy);
    this.syncVariantPrimaryUnit(0);
  }

  addUnitRow(variantIndex: number): void {
    this.productForm.variants[variantIndex].unitsCollapsed = false;
    const used = new Set(
      this.productForm.variants[variantIndex].units.map((u) =>
        this.normalizeUnitType(u.unitType).toLowerCase(),
      ),
    );
    const available = this.unitTypeOptions.find((o) => !used.has(o.value.toLowerCase()));
    const row = this.emptyUnitRow();
    if (available) {
      row.unitType = available.value;
      row.defaultQty = this.isGramsUnit(available.value) ? 200 : 1;
    }
    row.isDefault = false;
    row.collapsed = false;
    this.applyUnitProductSourceByUnitType(row);
    const primary = this.productForm.variants[variantIndex].units.find((u) => u.isDefault)
      ?? this.productForm.variants[variantIndex].units[0];
    if (primary) {
      row.costPrice = this.toFiniteNumber(primary.costPrice, 0);
    }
    for (const u of this.productForm.variants[variantIndex].units) {
      u.collapsed = true;
    }
    this.productForm.variants[variantIndex].units.unshift(row);
  }

  duplicateUnitRow(variantIndex: number, unitIndex: number): void {
    const units = this.productForm.variants[variantIndex]?.units;
    const source = units?.[unitIndex];
    if (!source) return;

    this.productForm.variants[variantIndex].unitsCollapsed = false;
    const copy: VariantUnitFormRow = {
      id: undefined,
      unitType: this.normalizeUnitType(source.unitType),
      sellingPrice: Number(source.sellingPrice ?? 0),
      salePrice: source.salePrice != null ? Number(source.salePrice) : null,
      isManualEntry: Boolean(source.isManualEntry),
      isDefault: false,
      productSource: source.productSource,
      stockQty: Number(source.stockQty ?? 0),
      stockWarning: Number(source.stockWarning ?? 0),
      costPrice: Number(source.costPrice ?? 0),
      defaultQty: Math.max(0.01, Number(source.defaultQty ?? 1)),
      qtyPrices: this.normalizeQtyPricesForm(source.qtyPrices).map((t) => ({ ...t })),
      collapsed: false,
    };
    this.applyUnitProductSourceByUnitType(copy);
    for (const u of units) {
      u.collapsed = true;
    }
    units.splice(unitIndex + 1, 0, copy);
    this.syncVariantPrimaryUnit(variantIndex);

    this.notify.success(
      'Unit duplicated',
      `Copied “${this.normalizeUnitType(source.unitType)}”. Edit prices, stock, or quantity prices, then save.`,
    );
  }

  toggleUnitCollapsed(variantIndex: number, unitIndex: number): void {
    const unit = this.productForm.variants[variantIndex]?.units?.[unitIndex];
    if (!unit) return;
    unit.collapsed = !unit.collapsed;
  }

  setDefaultUnit(variantIndex: number, unitIndex: number): void {
    this.productForm.variants[variantIndex].units.forEach((u, i) => {
      u.isDefault = i === unitIndex;
    });
    this.syncVariantPrimaryUnit(variantIndex);
  }

  removeUnitRow(variantIndex: number, unitIndex: number): void {
    const units = this.productForm.variants[variantIndex].units;
    const beverages = this.isBeveragesCategory(this.productForm.category);
    if (!beverages && units.length <= 1) return;
    const wasDefault = units[unitIndex].isDefault;
    units.splice(unitIndex, 1);
    if (wasDefault && units.length) {
      units[0].isDefault = true;
    }
    this.syncVariantPrimaryUnit(variantIndex);
  }

  onUnitTypeChange(variantIndex: number, unitIndex: number): void {
    const unit = this.productForm.variants[variantIndex].units[unitIndex];
    unit.isManualEntry = false;
    this.applyUnitProductSourceByUnitType(unit);
    const suggested = this.isGramsUnit(unit.unitType) ? 200 : 1;
    const current = Number(unit.defaultQty);
    if (!Number.isFinite(current) || current <= 0 || current === 1 || current === 200) {
      unit.defaultQty = suggested;
    }
    this.syncVariantPrimaryUnit(variantIndex);
  }

  onUnitPriceChange(variantIndex: number): void {
    this.syncVariantPrimaryUnit(variantIndex);
    this.onVariantSellingChange(variantIndex);
  }

  private normalizeUnitType(unitType: string | null | undefined): string {
    const normalized = String(unitType ?? 'piece').trim().toLowerCase();
    if (normalized === 'manual' || normalized === 'gram') return 'grams';
    return normalized || 'piece';
  }

  isGramsUnit(unitType: string | null | undefined): boolean {
    const normalized = this.normalizeUnitType(unitType).toLowerCase();
    return normalized === 'grams' || normalized === 'manual';
  }

  /** Show kg stock fields only when a grams/manual unit (Retail weight) exists. */
  variantTracksWeightStock(v: {
    unitType?: string | null;
    units?: Array<{ unitType?: string | null; isManualEntry?: boolean; productSource?: string }>;
  }): boolean {
    const units = v.units ?? [];
    if (units.length) {
      return units.some(
        (u) =>
          Boolean(u.isManualEntry) ||
          this.isGramsUnit(u.unitType) ||
          String(u.productSource ?? '').toLowerCase() === 'retail',
      );
    }
    return this.isGramsUnit(v.unitType);
  }

  unitStockQtyLabel(unit: VariantUnitFormRow): string {
    return this.isGramsUnit(unit.unitType) || unit.isManualEntry ? 'Stock qty (kg)' : 'Stock qty';
  }

  unitStockWarningLabel(unit: VariantUnitFormRow): string {
    return this.isGramsUnit(unit.unitType) || unit.isManualEntry
      ? 'Low-stock warning (kg)'
      : 'Low-stock warning';
  }

  private unitStockToStorage(unit: VariantUnitFormRow): number {
    const qty = this.toFiniteNumber(unit.stockQty, 0);
    return this.isGramsUnit(unit.unitType) || unit.isManualEntry ? kilosToStockGrams(qty) : qty;
  }

  private unitStockFromStorage(unitType: string, stockQty: number, isManualEntry = false): number {
    return this.isGramsUnit(unitType) || isManualEntry
      ? stockGramsToKilos(stockQty)
      : this.toFiniteNumber(stockQty, 0);
  }

  resolveProductSource(
    _value: unknown,
    unitType?: string | null,
    isManualEntry?: boolean,
  ): 'Retail' | 'Wholesale' {
    // Grams/manual → Retail. Every other unit type → Wholesale (not selectable).
    if (isManualEntry || this.isGramsUnit(unitType)) return 'Retail';
    return 'Wholesale';
  }

  private applyUnitProductSourceByUnitType(unit: VariantUnitFormRow): void {
    unit.productSource = this.resolveProductSource(unit.productSource, unit.unitType, unit.isManualEntry);
  }

  onUnitProductSourceChange(variantIndex: number, unitIndex: number): void {
    const unit = this.productForm.variants[variantIndex].units[unitIndex];
    this.applyUnitProductSourceByUnitType(unit);
    this.syncVariantPrimaryUnit(variantIndex);
  }

  isUnitProductSourceLocked(_unit: VariantUnitFormRow): boolean {
    // Source is derived from unit type; user cannot override.
    return true;
  }

  unitProductSourceHint(unit: VariantUnitFormRow): string {
    return this.isGramsUnit(unit.unitType) || unit.isManualEntry
      ? 'Grams units always use Retail.'
      : 'Non-grams units always use Wholesale.';
  }

  private syncVariantPrimaryUnit(variantIndex: number): void {
    const v = this.productForm.variants[variantIndex];
    const primary = v.units.find((u) => u.isDefault) ?? v.units[0];
    if (!primary) return;
    v.unitType = primary.unitType;
    v.sellingPrice = primary.sellingPrice;
    v.salePrice = primary.salePrice;
    v.costPrice = this.toFiniteNumber(primary.costPrice, 0);
    v.marginPercent = this.computeMargin(v.costPrice, v.sellingPrice);
  }

  onUnitCostChange(variantIndex: number): void {
    this.syncVariantPrimaryUnit(variantIndex);
  }

  productImageDisplay(): string | null {
    return this.productForm.imagePreview ?? this.productForm.imageUrl ?? null;
  }

  variantImageDisplay(variant: { imagePreview?: string | null; imageUrl?: string | null }): string | null {
    return variant.imagePreview ?? variant.imageUrl ?? null;
  }

  onProductImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
      this.notify.error('Invalid image', 'Use JPEG/PNG/WebP under 2MB.');
      input.value = '';
      return;
    }
    this.productForm.imageFile = file;
    if (this.productForm.imagePreview?.startsWith('blob:')) {
      URL.revokeObjectURL(this.productForm.imagePreview);
    }
    this.productForm.imagePreview = URL.createObjectURL(file);
    input.value = '';
  }

  clearProductImageSelection(): void {
    this.productForm.imageFile = null;
    if (this.productForm.imagePreview?.startsWith('blob:')) {
      URL.revokeObjectURL(this.productForm.imagePreview);
    }
    this.productForm.imagePreview = this.productForm.imageUrl ?? null;
  }

  onVariantImageSelected(event: Event, index: number): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
      this.notify.error('Invalid image', 'Use JPEG/PNG/WebP under 2MB.');
      return;
    }
    const v = this.productForm.variants[index];
    v.imageFile = file;
    v.imagePreview = URL.createObjectURL(file);
  }

  removeVariantRow(index: number): void {
    if (this.productForm.variants.length <= 1) return;
    this.productForm.variants.splice(index, 1);
  }

  toggleSubVariantsCollapsed(index: number): void {
    const variant = this.productForm.variants[index];
    if (!variant) return;
    variant.subVariantsCollapsed = !variant.subVariantsCollapsed;
  }

  toggleVariantCollapsed(index: number): void {
    const variant = this.productForm.variants[index];
    if (!variant) return;
    variant.collapsed = !variant.collapsed;
  }

  toggleUnitsCollapsed(index: number): void {
    const variant = this.productForm.variants[index];
    if (!variant) return;
    variant.unitsCollapsed = !variant.unitsCollapsed;
  }

  onVariantCostChange(index: number): void {
    const v = this.productForm.variants[index];
    v.marginPercent = this.computeMargin(v.costPrice, v.sellingPrice);
  }

  onVariantSellingChange(index: number): void {
    const v = this.productForm.variants[index];
    v.marginPercent = this.computeMargin(v.costPrice, v.sellingPrice);
  }

  requestSaveProduct(): void {
    if (this.isSavingItem) return;
    if (!this.isEditingVariantOnly && !this.productForm.name.trim()) {
      this.notify.warning('Required', 'Product name is required.');
      return;
    }
    const variantNames = this.productForm.variants
      .map((v) => v.variantName.trim().toLowerCase())
      .filter(Boolean);
    if (!variantNames.length) {
      this.notify.warning('Required', 'Add at least one variant with a name.');
      return;
    }
    if (new Set(variantNames).size !== variantNames.length) {
      this.notify.warning('Duplicate variants', 'Each variant must have a unique name.');
      return;
    }
    for (const v of this.productForm.variants) {
      if (this.isBeveragesCategory(this.productForm.category)) continue;
      if (!(v.units ?? []).length) {
        this.notify.warning(
          'Required',
          `Variant “${v.variantName.trim() || 'Untitled'}” needs at least one unit type.`,
        );
        return;
      }
    }
    const barcodes = this.productForm.variants
      .map((v) => v.barcode.trim().toLowerCase())
      .filter(Boolean);
    if (new Set(barcodes).size !== barcodes.length) {
      this.notify.warning('Duplicate barcodes', 'Each barcode must be unique.');
      return;
    }
    const label = this.isEditingVariantOnly
      ? 'Save changes to this variant?'
      : this.itemDrawerMode === 'create'
        ? 'Add this product?'
        : 'Save changes to this product?';
    this.openConfirm('Confirm save', label, () => void this.saveProduct());
  }

  private buildVariantPayload(v: VariantFormRow) {
    const beverages = this.isBeveragesCategory(this.productForm.category);
    const unitsSource = v.units?.length
      ? v.units
      : beverages
        ? []
        : [{
          unitType: this.defaultUnitTypeCode(),
          sellingPrice: Number(v.sellingPrice ?? 0),
          salePrice: v.salePrice ?? null,
          isManualEntry: false,
          isDefault: true,
          productSource: 'Wholesale' as const,
          stockQty: 0,
          stockWarning: 0,
          costPrice: Number(v.costPrice ?? 0),
          defaultQty: 1,
          qtyPrices: [] as UnitQtyPriceForm[],
          collapsed: false,
        }];
    const primary = unitsSource.find((u) => u.isDefault) ?? unitsSource[0];
    const unitsPayload = unitsSource.map((u) => {
      const qtyPrices = this.normalizeQtyPricesForm(u.qtyPrices);
      const defaultQty = Math.max(
        0.01,
        qtyPrices[0]?.qty
          ?? this.toFiniteNumber(u.defaultQty, this.isGramsUnit(u.unitType) || u.isManualEntry ? 200 : 1),
      );
      const formSelling = qtyPrices.length ? qtyPrices[0].price : u.sellingPrice;
      const unitMeta = { unitType: u.unitType, isManualEntry: Boolean(u.isManualEntry), defaultQty };
      return {
        id: u.id,
        unitType: u.unitType,
        sellingPrice: this.unitPriceToStorage(unitMeta, formSelling) ?? 0,
        salePrice: this.unitPriceToStorage(unitMeta, u.salePrice),
        isManualEntry: false,
        isDefault: Boolean(u.isDefault),
        // Beverages do not use product source; default Retail for any optional unit rows.
        productSource: beverages
          ? 'Retail'
          : this.resolveProductSource(u.productSource, u.unitType, u.isManualEntry),
        stockQty: this.unitStockToStorage(u),
        stockWarning:
          this.isGramsUnit(u.unitType) || u.isManualEntry
            ? kilosToStockGrams(this.toFiniteNumber(u.stockWarning, 0))
            : this.toFiniteNumber(u.stockWarning, 0),
        costPrice: this.toFiniteNumber(u.costPrice, 0),
        defaultQty,
        qtyPrices,
      };
    });
    const primaryStored = unitsPayload.find((u) => u.isDefault) ?? unitsPayload[0];
    const sellingPrice = this.toFiniteNumber(
      primaryStored?.sellingPrice ?? primary?.sellingPrice ?? v.sellingPrice,
      0,
    );
    const costPrice = this.toFiniteNumber(primary?.costPrice ?? v.costPrice, 0);
    const wholesaleUnits = unitsPayload.filter(
      (u) => !this.isGramsUnit(u.unitType) && String(u.productSource).toLowerCase() !== 'retail',
    );
    const retailUnits = unitsPayload.filter(
      (u) => this.isGramsUnit(u.unitType) || String(u.productSource).toLowerCase() === 'retail',
    );
    const subStockQty = beverages
      ? (v.subVariants ?? []).reduce((sum, s) => sum + this.toFiniteNumber(s.stockQty, 0), 0)
      : 0;
    const subStockWarning = beverages
      ? (v.subVariants ?? []).reduce((sum, s) => sum + this.toFiniteNumber(s.stockWarning, 0), 0)
      : 0;
    return {
      id: v.id,
      variantName: v.variantName.trim(),
      stockQty: wholesaleUnits.reduce((sum, u) => sum + this.toFiniteNumber(u.stockQty, 0), 0) + subStockQty,
      stockWarning:
        wholesaleUnits.reduce((sum, u) => sum + this.toFiniteNumber(u.stockWarning, 0), 0) + subStockWarning,
      retailStockQty: retailUnits.reduce((sum, u) => sum + this.toFiniteNumber(u.stockQty, 0), 0),
      retailStockWarning: retailUnits.reduce((sum, u) => sum + this.toFiniteNumber(u.stockWarning, 0), 0),
      costPrice,
      sellingPrice,
      salePrice: primaryStored?.salePrice ?? primary?.salePrice ?? v.salePrice ?? null,
      unitType: primary?.unitType ?? v.unitType,
      marginPercent: this.computeMargin(costPrice, sellingPrice),
      hasSugarLevel: this.isBeveragesCategory(this.productForm.category) ? Boolean(v.hasSugarLevel) : false,
      productSource: beverages
        ? 'Retail'
        : this.resolveProductSource(
            primary?.productSource,
            primary?.unitType ?? v.unitType,
            primary?.isManualEntry,
          ),
      barcode: v.barcode.trim() || null,
      units: unitsPayload,
      subVariants: this.isBeveragesCategory(this.productForm.category)
        ? (v.subVariants ?? [])
            .filter((s) => String(s.sizeLabel ?? '').trim())
            .map((s) => ({
              id: s.id,
              sortOrder: s.sortOrder,
              tempType: s.tempType || null,
              sizeLabel: String(s.sizeLabel).trim(),
              sellingPrice: this.toFiniteNumber(s.sellingPrice, 0),
              salePrice: s.salePrice ?? null,
              stockQty: this.toFiniteNumber(s.stockQty, 0),
              stockWarning: this.toFiniteNumber(s.stockWarning, 0),
            }))
        : [],
    };
  }

  async saveProduct(): Promise<void> {
    if (this.isSavingItem) return;
    this.isSavingItem = true;
    try {
      if (this.productForm.category?.trim()) {
        this.productForm.category = this.normalizeBeveragesCategory(this.productForm.category);
        await this.svc.createCategory(this.productForm.category.trim());
        await this.loadCategoryOptions();
      }
      const productId = this.productForm.id ?? this.editingProductId ?? undefined;
      const variantPayloads = this.productForm.variants
        .filter((v) => v.variantName.trim())
        .map((v) => this.buildVariantPayload(v));

      if (!variantPayloads.length) {
        this.notify.warning('Required', 'Add at least one variant.');
        return;
      }

      if (this.isEditingVariantOnly && this.editingVariantId) {
        const local = this.productForm.variants[0];
        if (!local.imageFile && !local.imagePreview && !local.imageUrl) {
          local.imageFile = await this.generatePlaceholderImage(`${this.productForm.name} ${local.variantName}`.trim());
        }
        const r = await this.posSvc.saveInventoryVariant(this.editingVariantId, variantPayloads[0]);
        if (!r.success) {
          this.notify.error('Failed', r.message ?? 'Could not save variant.');
          return;
        }
        let uploadedImageUrl: string | null | undefined;
        if (local.imageFile) {
          const upload = await this.posSvc.uploadVariantImage(this.editingVariantId, local.imageFile);
          if (!upload.success) {
            this.notify.warning('Image', upload.message ?? 'Variant image upload failed.');
          } else {
            uploadedImageUrl = upload.data?.imageUrl ?? null;
          }
        }
        this.notify.success('Saved', 'Variant updated.');
        this.isItemDrawerOpen = false;
        this.editingVariantOnly = false;
        const patchedVariantId = this.editingVariantId;
        const parentProductId = this.editingProductId;
        this.editingVariantId = null;
        this.clearFormDrafts();
        this.patchVariantOnlyLocal(patchedVariantId, variantPayloads[0], uploadedImageUrl, parentProductId);
        return;
      }

      if (!this.productForm.imageFile && !this.productForm.imagePreview && !this.productForm.imageUrl) {
        this.productForm.imageFile = await this.generatePlaceholderImage(this.productForm.name.trim() || 'Product');
      }
      for (const v of this.productForm.variants) {
        if (!v.variantName.trim()) continue;
        if (!v.imageFile && !v.imagePreview && !v.imageUrl) {
          v.imageFile = await this.generatePlaceholderImage(`${this.productForm.name} ${v.variantName}`.trim());
        }
      }

      const payload = {
        id: productId,
        name: this.productForm.name.trim(),
        category: this.productForm.category || undefined,
        brand: this.productForm.brand || undefined,
        description: this.productForm.description || undefined,
        variants: variantPayloads,
      };
      const r = await this.posSvc.saveInventoryProduct(payload);
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not save product.');
        return;
      }
      const savedId = r.id ?? productId;
      if (!savedId) {
        this.notify.error('Failed', 'Product saved but no product id was returned.');
        return;
      }
      let productImageUrl: string | null | undefined;
      if (this.productForm.imageFile) {
        const upload = await this.posSvc.uploadProductImage(savedId, this.productForm.imageFile);
        if (!upload.success) {
          this.notify.error('Image upload failed', upload.message ?? 'Product saved but image upload failed.');
        } else {
          productImageUrl = upload.data?.imageUrl ?? null;
        }
      }

      const fresh = await this.posSvc.getInventoryProduct(savedId);
      if (fresh.success && fresh.data) {
        const variantImageUpdates = new Map<number, string>();
        for (const local of this.productForm.variants) {
          if (!local.imageFile || !local.variantName.trim()) continue;
          const remote = (fresh.data.variants ?? []).find((sv: InventoryVariantRow) => sv.variantName === local.variantName.trim());
          if (remote?.id) {
            const upload = await this.posSvc.uploadVariantImage(remote.id, local.imageFile);
            if (!upload.success) {
              this.notify.warning('Image', upload.message ?? `Variant "${local.variantName}" image upload failed.`);
            } else if (upload.data?.imageUrl) {
              variantImageUpdates.set(remote.id, upload.data.imageUrl);
            }
          }
        }
        const patchedVariants = (fresh.data.variants ?? []).map((v: InventoryVariantRow) => ({
          ...v,
          imageUrl: variantImageUpdates.get(v.id) ?? v.imageUrl,
        }));
        this.applyProductToLocalState(
          { ...fresh.data, imageUrl: productImageUrl !== undefined ? productImageUrl : fresh.data.imageUrl },
          patchedVariants,
        );
      }

      this.notify.success('Saved', this.itemDrawerMode === 'create' ? 'Product added.' : 'Product updated.');
      this.isItemDrawerOpen = false;
      this.editingProductId = null;
      if (this.itemDrawerMode === 'create') {
        this.clearFormDrafts();
      }
    } catch {
      this.notify.error('Error', 'Unexpected error.');
    } finally {
      this.isSavingItem = false;
    }
  }

  private patchVariantOnlyLocal(
    variantId: number,
    payload: ReturnType<typeof this.buildVariantPayload>,
    imageUrl: string | null | undefined,
    productId: number | null,
  ): void {
    const idx = this.variantItems.findIndex((v) => v.id === variantId);
    if (idx >= 0) {
      const existing = this.variantItems[idx];
      this.variantItems[idx] = {
        ...existing,
        variantName: payload.variantName,
        stockQty: payload.stockQty,
        stockWarning: payload.stockWarning,
        costPrice: payload.costPrice,
        sellingPrice: payload.sellingPrice,
        salePrice: payload.salePrice,
        unitType: payload.unitType ?? existing.unitType,
        marginPercent: payload.marginPercent,
        barcode: payload.barcode ?? existing.barcode ?? null,
        imageUrl: imageUrl !== undefined ? imageUrl : existing.imageUrl,
      };
    }
    this.recomputeProductAggregates(productId);
  }

  private recomputeProductAggregates(productId: number | null | undefined): void {
    if (!productId) return;
    const idx = this.productItems.findIndex((p) => p.id === productId);
    if (idx < 0) return;
    const variants = this.variantItems.filter((v) => v.productId === productId);
    const prices = variants.map((v) => v.sellingPrice || 0);
    this.productItems[idx] = {
      ...this.productItems[idx],
      variantCount: variants.length,
      totalStock: variants.reduce((sum, v) => sum + (v.stockQty || 0), 0),
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      hasSale: variants.some((v) => v.salePrice != null && v.salePrice > 0 && v.salePrice < v.sellingPrice),
    };
  }

  private applyProductToLocalState(
    product: { id: number; name: string; category?: string | null; brand?: string | null; imageUrl?: string | null },
    variants: Array<InventoryVariantRow & Record<string, unknown>>,
  ): void {
    this.variantItems = this.variantItems.filter((v) => v.productId !== product.id);
    const mappedVariants: InventoryVariantRow[] = variants.map((v) => ({
      id: v.id,
      productId: product.id,
      productName: product.name,
      category: product.category ?? null,
      brand: product.brand ?? null,
      variantName: String(v.variantName ?? ''),
      stockQty: Number(v.stockQty ?? 0),
      stockWarning: Number(v.stockWarning ?? 0),
      costPrice: Number(v.costPrice ?? 0),
      sellingPrice: Number(v.sellingPrice ?? 0),
      salePrice: v.salePrice != null ? Number(v.salePrice) : null,
      unitType: (v.unitType as string | null | undefined) ?? null,
      marginPercent: v.marginPercent != null ? Number(v.marginPercent) : null,
      barcode: (v.barcode as string | null | undefined) ?? null,
      imageUrl: (v.imageUrl as string | null | undefined) ?? null,
    }));
    this.variantItems = [...mappedVariants, ...this.variantItems];

    const prices = mappedVariants.map((v) => v.sellingPrice || 0);
    const productRow: InventoryProductRow = {
      id: product.id,
      name: product.name,
      category: product.category ?? null,
      brand: product.brand ?? null,
      imageUrl: product.imageUrl ?? null,
      variantCount: mappedVariants.length,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      totalStock: mappedVariants.reduce((sum, v) => sum + v.stockQty, 0),
      hasSale: mappedVariants.some((v) => v.salePrice != null && v.salePrice > 0 && v.salePrice < v.sellingPrice),
    };
    const idx = this.productItems.findIndex((p) => p.id === product.id);
    if (idx >= 0) {
      this.productItems[idx] = productRow;
    } else {
      this.productItems = [productRow, ...this.productItems];
    }
  }

  // ── Auto-generated placeholder images ───────────────────────────────────

  private hashStringToHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 360;
  }

  private getInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  initialsFor(name: string | null | undefined): string {
    return this.getInitials(name || '');
  }

  avatarColorFor(name: string | null | undefined): string {
    const hue = this.hashStringToHue((name || 'Product').trim());
    return `hsl(${hue}, 55%, 45%)`;
  }

  private async generatePlaceholderImage(label: string): Promise<File> {
    const text = (label || 'Product').trim() || 'Product';
    const size = 400;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new File([new Blob()], 'placeholder.png', { type: 'image/png' });

    const hue = this.hashStringToHue(text);
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, `hsl(${hue}, 55%, 48%)`);
    gradient.addColorStop(1, `hsl(${hue}, 55%, 30%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `bold ${Math.round(size * 0.36)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.getInitials(text), size / 2, size * 0.44);

    const bannerHeight = size * 0.16;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, size - bannerHeight, size, bannerHeight);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `600 ${Math.round(size * 0.075)}px Arial, sans-serif`;
    const truncated = text.length > 24 ? `${text.slice(0, 22)}…` : text;
    ctx.fillText(truncated, size / 2, size - bannerHeight / 2);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', 0.92));
    const finalBlob = blob ?? (await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png')));
    const safeName = text.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'placeholder';
    const ext = finalBlob?.type === 'image/webp' ? 'webp' : 'png';
    return new File([finalBlob ?? new Blob()], `${safeName}.${ext}`, { type: finalBlob?.type || 'image/png' });
  }

  requestDeleteVariant(variant: InventoryVariantRow): void {
    this.openConfirm(
      'Remove variant?',
      `Remove "${variant.variantName}" from ${variant.productName}? It will be hidden from sales and inventory lists. You can restore it from Deleted Items.`,
      () => void this.deleteVariant(variant.id),
      'danger',
    );
  }

  requestDuplicateVariant(variant: InventoryVariantRow): void {
    this.openConfirm(
      'Duplicate variant?',
      `Create a copy of "${variant.variantName}" under ${variant.productName}? Settings, units, and sub-variants will be copied. Stock starts at 0.`,
      () => void this.duplicateVariant(variant),
    );
  }

  async duplicateVariant(variant: InventoryVariantRow): Promise<void> {
    try {
      const r = await this.posSvc.duplicateInventoryVariant(variant.id);
      if (!r.success || !r.data) {
        this.notify.error('Failed', r.message ?? 'Could not duplicate variant.');
        return;
      }
      const copied: InventoryVariantRow = {
        ...r.data,
        stockQty: Number(r.data.stockQty ?? 0),
        stockWarning: Number(r.data.stockWarning ?? 0),
        costPrice: Number(r.data.costPrice ?? 0),
        sellingPrice: Number(r.data.sellingPrice ?? 0),
        salePrice: r.data.salePrice != null ? Number(r.data.salePrice) : null,
      };
      this.variantItems = [copied, ...this.variantItems.filter((v) => v.id !== copied.id)];
      this.recomputeProductAggregates(copied.productId);
      this.notify.success('Duplicated', `"${copied.variantName}" created.`);
    } catch {
      this.notify.error('Error', 'Failed to duplicate variant.');
    }
  }

  async deleteVariant(variantId: number): Promise<void> {
    try {
      const r = await this.posSvc.deleteInventoryVariant(variantId);
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not delete variant.');
        return;
      }
      this.notify.success('Deleted', 'Variant removed.');
      const removed = this.variantItems.find((v) => v.id === variantId);
      this.variantItems = this.variantItems.filter((v) => v.id !== variantId);
      if (removed) this.recomputeProductAggregates(removed.productId);
    } catch {
      this.notify.error('Error', 'Failed to delete variant.');
    }
  }

  requestDeleteProduct(variant: InventoryVariantRow): void {
    this.requestDeleteProductById(variant.productId, variant.productName);
  }

  requestDeleteProductRow(product: InventoryProductRow): void {
    this.requestDeleteProductById(product.id, product.name);
  }

  private requestDeleteProductById(productId: number, productName: string): void {
    this.openConfirm(
      'Remove product?',
      `Remove "${productName}" and all its variants? Items will be hidden, not permanently deleted. Restore them from Deleted Items.`,
      () => void this.deleteProduct(productId),
      'danger',
    );
  }

  requestRestoreVariant(variant: InventoryVariantRow): void {
    this.openConfirm(
      'Restore variant?',
      `Restore "${variant.variantName}" under ${variant.productName}?`,
      () => void this.restoreVariant(variant.id),
    );
  }

  async restoreVariant(variantId: number): Promise<void> {
    try {
      const r = await this.posSvc.restoreInventoryVariant(variantId);
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not restore variant.');
        return;
      }
      this.notify.success('Restored', 'Variant restored.');
      if (this.isDeletedView) {
        this.variantItems = this.variantItems.filter((v) => v.id !== variantId);
      }
    } catch {
      this.notify.error('Error', 'Failed to restore variant.');
    }
  }

  requestRestoreProductRow(product: InventoryProductRow): void {
    this.openConfirm(
      'Restore product?',
      `Restore "${product.name}" and all its variants?`,
      () => void this.restoreProduct(product.id),
    );
  }

  async restoreProduct(productId: number): Promise<void> {
    try {
      const r = await this.posSvc.restoreInventoryProduct(productId);
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not restore product.');
        return;
      }
      this.notify.success('Restored', 'Product restored.');
      if (this.isDeletedView) {
        this.productItems = this.productItems.filter((p) => p.id !== productId);
        this.variantItems = this.variantItems.filter((v) => v.productId !== productId);
      }
    } catch {
      this.notify.error('Error', 'Failed to restore product.');
    }
  }

  async deleteProduct(productId: number): Promise<void> {
    try {
      const r = await this.posSvc.deleteInventoryProduct(productId);
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not delete product.');
        return;
      }
      this.notify.success('Deleted', 'Product removed.');
      this.productItems = this.productItems.filter((p) => p.id !== productId);
      this.variantItems = this.variantItems.filter((v) => v.productId !== productId);
    } catch {
      this.notify.error('Error', 'Failed to delete product.');
    }
  }

  openConfirm(title: string, message: string, action: () => void, variant: 'primary' | 'danger' = 'primary'): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.confirmVariant = variant;
    this.confirmAction = action;
    this.confirmOpen = true;
  }

  onConfirmDialog(): void {
    this.confirmOpen = false;
    this.confirmAction?.();
    this.confirmAction = null;
  }

  onCancelDialog(): void {
    this.confirmOpen = false;
    this.confirmAction = null;
  }

  async saveItem(): Promise<void> {
    if (this.isPosOrg) {
      this.requestSaveProduct();
      return;
    }
    if (!this.itemForm.partName.trim()) { this.notify.warning('Required', 'Part name is required.'); return; }
    this.openConfirm(
      this.itemDrawerMode === 'create' ? 'Add item?' : 'Save changes?',
      this.itemDrawerMode === 'create' ? 'Add this inventory item?' : 'Save changes to this item?',
      () => void this.doSaveItem(),
    );
  }

  private async doSaveItem(): Promise<void> {
    this.isSavingItem = true;
    try {
      if (this.itemForm.brand?.trim()) { void this.svc.createBrand(this.itemForm.brand.trim()); }
      if (this.itemForm.category?.trim()) { void this.svc.createCategory(this.itemForm.category.trim()); }

      let itemId: number | null = null;
      if (this.itemDrawerMode === 'create') {
        const createResult = await this.svc.create(this.itemForm);
        if (!createResult.success) {
          this.notify.error('Failed', createResult.message ?? 'Operation failed.');
          return;
        }
        itemId = createResult.id ?? null;
      } else {
        const updateResult = await this.svc.update(this.editingItemId!, this.itemForm);
        if (!updateResult.success) {
          this.notify.error('Failed', updateResult.message ?? 'Operation failed.');
          return;
        }
        itemId = this.editingItemId;
      }

      if (itemId && this.itemImageFile) {
        const upload = await this.svc.uploadImage(itemId, this.itemImageFile);
        if (!upload.success) {
          this.notify.warning('Image', upload.message ?? 'Item saved but image upload failed.');
        }
      }

      this.notify.success('Saved', this.itemDrawerMode === 'create' ? 'Item added.' : 'Item updated.');
      this.isItemDrawerOpen = false;
      this.itemImageFile = null;
      this.itemImagePreview = null;
      if (this.itemDrawerMode === 'create') {
        this.clearFormDrafts();
      }
      await this.loadItems();
    } catch { this.notify.error('Error', 'Unexpected error.'); }
    finally { this.isSavingItem = false; }
  }

  onItemImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.notify.error('Invalid File', 'Only image files are allowed.');
      input.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.notify.error('Too Large', 'Image must be under 2MB.');
      input.value = '';
      return;
    }
    this.itemImageFile = file;
    this.itemImagePreview = URL.createObjectURL(file);
    input.value = '';
  }

  clearItemImageSelection(): void {
    this.itemImageFile = null;
    if (this.itemImagePreview) URL.revokeObjectURL(this.itemImagePreview);
    this.itemImagePreview = null;
  }

  async removeExistingItemImage(): Promise<void> {
    if (!this.editingItemId) return;
    this.isUploadingImage = true;
    try {
      const r = await this.svc.removeImage(this.editingItemId);
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not remove image.');
        return;
      }
      this.existingImageUrl = null;
      this.notify.success('Removed', 'Item image removed.');
      await this.loadItems();
    } catch {
      this.notify.error('Error', 'Failed to remove image.');
    } finally {
      this.isUploadingImage = false;
    }
  }

  itemImageDisplay(): string | null {
    return this.itemImagePreview ?? this.existingImageUrl;
  }

  isLow(item: InventoryItem): boolean { return item.stockQty <= (item.stockWarning ?? 0); }

  isVariantLowStock(v: InventoryVariantRow): boolean {
    return v.stockQty <= v.stockWarning;
  }

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
    this.poItems[index].variantId = null;
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
    if (product.variantId) {
      this.poItems[index].variantId = product.variantId;
      this.poItems[index].inventoryId = null;
    } else {
      this.poItems[index].inventoryId = product.id;
      this.poItems[index].variantId = null;
    }
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
          if (i.variantId) item.variantId = Number(i.variantId);
          if (i.brand?.trim()) item.brand = i.brand.trim();
          if (i.category?.trim()) item.category = i.category.trim();
          item.productSource = this.resolveProductSource(i.productSource, null, false);
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
          variantId: i.variantId ?? undefined,
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
    this.openConfirm(
      'Receive purchase order?',
      'Mark this PO as received and update stock?',
      () => void this.doReceivePO(id),
    );
  }

  private async doReceivePO(id: number): Promise<void> {
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

  // ── POS Import / Export ─────────────────────────────────────────────────

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private readonly posExportHeaders = [
    'Product Name', 'Category', 'Brand', 'Description', 'Variant Name',
    'Barcode', 'Unit Type', 'Stock Qty', 'Stock Warning', 'Cost Price', 'Selling Price', 'Sale Price',
  ];

  async exportPosInventory(): Promise<void> {
    if (!this.variantItems.length) {
      this.notify.warning('No data', 'No inventory data to export.');
      return;
    }
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Inventory');
      sheet.columns = this.posExportHeaders.map((h: string) => ({ width: Math.max(14, h.length + 4) }));
      const headerRow = sheet.addRow(this.posExportHeaders);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell: { fill: unknown }) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      });
      for (const v of this.variantItems) {
        sheet.addRow([
          v.productName, v.category || '', v.brand || '', '',
          v.variantName, v.barcode || '', v.unitType || 'piece', v.stockQty, v.stockWarning,
          v.costPrice, v.sellingPrice, v.salePrice ?? '',
        ]);
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      this.downloadBlob(blob, `pos-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      this.notify.error('Error', 'Failed to export inventory.');
    }
  }

  async downloadPosTemplate(): Promise<void> {
    const sampleRows = [
      ['Peanut', 'Snacks', 'Brand X', 'Roasted peanuts', 'Garlic', '4801234567890', 'piece', 50, 10, 5, 10, ''],
      ['Peanut', 'Snacks', 'Brand X', 'Roasted peanuts', 'Honey Roasted', '4801234567891', 'piece', 30, 10, 6, 12, ''],
    ];
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Template');
      sheet.columns = this.posExportHeaders.map((h: string) => ({ width: Math.max(14, h.length + 4) }));
      const headerRow = sheet.addRow(this.posExportHeaders);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell: { fill: unknown }) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      });
      sampleRows.forEach((row) => sheet.addRow(row));
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      this.downloadBlob(blob, 'pos-inventory-import-template.xlsx');
    } catch {
      this.notify.error('Error', 'Failed to generate template.');
    }
  }

  openPosImportModal(): void {
    this.posImportRows = [];
    this.posImportFileName = '';
    this.posImportResult = null;
    this.showPosImportModal = true;
  }

  closePosImportModal(): void {
    if (this.isPosImporting) return;
    this.showPosImportModal = false;
  }

  async onPosImportFileSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.posImportResult = null;
    if (!file) {
      this.posImportRows = [];
      this.posImportFileName = '';
      return;
    }
    this.posImportFileName = file.name;
    try {
      const rawRows = file.name.toLowerCase().endsWith('.csv')
        ? this.parsePosCsvRows(await file.text())
        : await this.parsePosXlsxRows(file);
      this.posImportRows = this.buildPosImportGroups(rawRows);
      if (!this.posImportRows.length) {
        this.notify.warning('No rows', 'No valid product rows found in the selected file.');
      }
    } catch {
      this.posImportRows = [];
      this.notify.error('Error', 'Failed to read the file. Check the format and try again.');
    }
  }

  private parsePosCsvRows(text: string): Array<Record<string, string>> {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
      return row;
    });
  }

  private async parsePosXlsxRows(file: File): Promise<Array<Record<string, string>>> {
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell: { value: unknown }, colNumber: number) => {
      headers[colNumber] = String(cell.value ?? '').trim();
    });
    const rows: Array<Record<string, string>> = [];
    sheet.eachRow((row: { eachCell: (cb: (cell: { value: unknown }, colNumber: number) => void) => void }, rowNumber: number) => {
      if (rowNumber === 1) return;
      const obj: Record<string, string> = {};
      row.eachCell((cell, colNumber) => {
        const key = headers[colNumber];
        if (key) obj[key] = cell.value != null ? String(cell.value) : '';
      });
      if (Object.values(obj).some((v) => v.trim())) rows.push(obj);
    });
    return rows;
  }

  private pickField(row: Record<string, string>, keys: string[]): string {
    const lowerMap = new Map(Object.keys(row).map((k) => [k.trim().toLowerCase(), row[k]]));
    for (const key of keys) {
      const v = lowerMap.get(key.toLowerCase());
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  private buildPosImportGroups(rows: Array<Record<string, string>>): PosImportProductGroup[] {
    const groups = new Map<string, PosImportProductGroup>();
    for (const row of rows) {
      const name = this.pickField(row, ['Product Name', 'ProductName', 'Product']);
      if (!name) continue;
      const key = name.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, {
          name,
          category: this.pickField(row, ['Category']) || undefined,
          brand: this.pickField(row, ['Brand']) || undefined,
          description: this.pickField(row, ['Description']) || undefined,
          variants: [],
        });
      }
      const group = groups.get(key)!;
      const variantName = this.pickField(row, ['Variant Name', 'VariantName', 'Variant']) || name;
      const salePriceRaw = this.pickField(row, ['Sale Price', 'SalePrice']);
      group.variants.push({
        variantName,
        unitType: this.pickField(row, ['Unit Type', 'UnitType', 'Unit']) || undefined,
        stockQty: Number(this.pickField(row, ['Stock Qty', 'StockQty', 'Stock'])) || 0,
        stockWarning: Number(this.pickField(row, ['Stock Warning', 'StockWarning'])) || 0,
        costPrice: Number(this.pickField(row, ['Cost Price', 'CostPrice'])) || 0,
        sellingPrice: Number(this.pickField(row, ['Selling Price', 'SellingPrice'])) || 0,
        salePrice: salePriceRaw ? Number(salePriceRaw) : null,
        barcode: this.pickField(row, ['Barcode', 'SKU', 'Upc', 'EAN']) || null,
      });
    }
    return Array.from(groups.values());
  }

  async executePosImport(): Promise<void> {
    if (!this.posImportRows.length) return;
    this.isPosImporting = true;
    this.posImportResult = null;
    try {
      const r = await this.posSvc.bulkImportProducts(this.posImportRows);
      this.posImportResult = r;
      if (r.success) {
        this.posImportRows = [];
        this.posImportFileName = '';
        await this.loadCategoryOptions();
        await this.loadItems();
      }
    } catch {
      this.posImportResult = { success: false, message: 'Unexpected error during import.' };
    } finally {
      this.isPosImporting = false;
    }
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

  onProductCategoryInput(value: string): void {
    this.refreshUnitTypeOptionsForCategory();
    this.sanitizeProductFormUnits();
    if (this.productCategorySearchTimer) clearTimeout(this.productCategorySearchTimer);
    if (value.trim().length < 1) {
      this.productCategorySuggestions = [];
      this.showProductCategoryDropdown = false;
      return;
    }
    this.productCategorySearchTimer = setTimeout(() => void this.searchProductCategories(value), 250);
  }

  private async searchProductCategories(q: string): Promise<void> {
    try {
      const r = await this.svc.getCategories(q);
      this.productCategorySuggestions = r.data ?? [];
      this.showProductCategoryDropdown = this.productCategorySuggestions.length > 0;
    } catch {
      this.productCategorySuggestions = [];
      this.showProductCategoryDropdown = false;
    }
  }

  selectProductCategory(name: string): void {
    this.productForm.category = name;
    this.showProductCategoryDropdown = false;
    this.onProductCategoryPickedOrTyped();
  }

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

  private emptySubVariantRow(): VariantSubVariantFormRow {
    return {
      sortOrder: undefined,
      tempType: '',
      sizeLabel: '',
      sellingPrice: 0,
      salePrice: null,
      stockQty: 0,
      stockWarning: 0,
    };
  }

  private emptyUnitRow(): VariantUnitFormRow {
    const unitType = this.defaultUnitTypeCode();
    const isGrams = this.isGramsUnit(unitType);
    return {
      unitType,
      sellingPrice: 0,
      salePrice: null,
      isManualEntry: false,
      isDefault: true,
      productSource: this.resolveProductSource(null, unitType, false),
      stockQty: 0,
      stockWarning: 0,
      costPrice: 0,
      defaultQty: isGrams ? 200 : 1,
      qtyPrices: [],
      collapsed: false,
    };
  }

  private emptyVariantRow(unitsCollapsed = false): VariantFormRow {
    // unitsCollapsed=true for beverages (optional units). Do not read productForm here —
    // this runs during field init of productForm itself.
    return {
      id: undefined,
      variantName: '',
      costPrice: 0,
      sellingPrice: 0,
      salePrice: null,
      marginPercent: null,
      unitType: 'piece',
      hasSugarLevel: false,
      barcode: '',
      collapsed: false,
      subVariantsCollapsed: false,
      unitsCollapsed,
      units: unitsCollapsed ? [] : [this.emptyUnitRow()],
      subVariants: [],
      imageUrl: null,
      imagePreview: null,
      imageFile: null,
    };
  }

  addSubVariantRow(variantIndex: number): void {
    const list = this.productForm.variants[variantIndex].subVariants ?? [];
    list.unshift(this.emptySubVariantRow());
    list.forEach((item: VariantSubVariantFormRow, index: number) => { item.sortOrder = index + 1; });
    this.productForm.variants[variantIndex].subVariants = list;
  }

  moveSubVariantRow(variantIndex: number, subIndex: number, direction: -1 | 1): void {
    const list = this.productForm.variants[variantIndex].subVariants ?? [];
    const nextIndex = subIndex + direction;
    if (subIndex < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    const [row] = list.splice(subIndex, 1);
    list.splice(nextIndex, 0, row);
    list.forEach((item: VariantSubVariantFormRow, index: number) => { item.sortOrder = index + 1; });
    this.productForm.variants[variantIndex].subVariants = list;
  }

  removeSubVariantRow(variantIndex: number, subIndex: number): void {
    const list = this.productForm.variants[variantIndex].subVariants ?? [];
    if (subIndex < 0 || subIndex >= list.length) return;
    list.splice(subIndex, 1);
    list.forEach((item: VariantSubVariantFormRow, index: number) => { item.sortOrder = index + 1; });
    this.productForm.variants[variantIndex].subVariants = list;
  }

  private emptyProductForm(): ProductFormState {
    return {
      id: null,
      name: '',
      category: '',
      brand: '',
      description: '',
      imageUrl: null,
      imagePreview: null,
      imageFile: null,
      variants: [this.emptyVariantRow()],
    };
  }

  private emptyItemForm() {
    return {
      partName: '',
      category: '',
      brand: '',
      description: '',
      stockQty: 0,
      stockWarning: 0,
      costPrice: 0,
      sellingPrice: 0,
      salePrice: null as number | null,
      marginPercent: null as number | null,
      unitType: 'piece',
    };
  }
  private emptyPOForm() {
    const today = new Date().toISOString().slice(0, 10);
    return { supplierId: null as number | null, comments: '', orderDate: today, expectedDate: today };
  }
  private poItemUid = 0;
  private emptyPOItem(): PurchaseOrderItem & { _uid: number } {
    return {
      _uid: ++this.poItemUid,
      itemName: '',
      brand: '',
      category: '',
      productSource: 'Wholesale',
      quantity: 1,
      unitCost: 0,
      inventoryId: null,
      variantId: null,
    };
  }
}
