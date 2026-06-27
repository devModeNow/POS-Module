import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { DatePickerComponent } from '../../shared/components/form/date-picker/date-picker.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { ConfirmDialogComponent } from '../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import { InventoryItem, InventoryService, PurchaseOrder, PurchaseOrderItem, Supplier } from '../../shared/services/inventory.service';
import { InventoryProductRow, InventoryVariantRow, PosService } from '../../shared/services/pos.service';
import { OrgService } from '../../shared/services/org.service';
import { NotificationService } from '../../shared/services/notification.service';

type MainTab = 'inventory' | 'purchase-orders' | 'reports';
type DrawerMode = 'create' | 'edit';
type PosInventoryView = 'products' | 'variants';

@Component({
  selector: 'app-inventory',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, DatePickerComponent, CanDirective, ConfirmDialogComponent],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit {
  activeTab: MainTab = 'inventory';
  isPosOrg = false;

  // Inventory tab
  items: InventoryItem[] = [];
  variantItems: InventoryVariantRow[] = [];
  productItems: InventoryProductRow[] = [];
  posInventoryView: PosInventoryView = 'products';
  productForm = this.emptyProductForm();
  editingProductId: number | null = null;
  search = '';
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
    return this.filteredVariants.slice(start, start + this.pageSize);
  }
  get paginatedProducts(): InventoryProductRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredProducts.slice(start, start + this.pageSize);
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

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmVariant: 'primary' | 'danger' = 'primary';
  private confirmAction: (() => void) | null = null;

  constructor(
    private readonly svc: InventoryService,
    private readonly posSvc: PosService,
    private readonly orgSvc: OrgService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    this.isPosOrg = this.orgSvc.isPosOrg();
    void this.loadCategoryOptions();
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
    try {
      if (this.isPosOrg) {
        const [variantsR, productsR] = await Promise.all([
          this.posSvc.getInventoryVariants(
            this.search || undefined,
            this.categoryFilter || undefined,
          ),
          this.posSvc.getInventoryProducts(
            this.search || undefined,
            this.categoryFilter || undefined,
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

  onCategoryFilterChange(): void {
    void this.loadItems();
  }

  openCreateItem(): void {
    if (this.isPosOrg) {
      this.productForm = this.emptyProductForm();
      this.editingProductId = null;
      this.itemDrawerMode = 'create';
      this.isItemDrawerOpen = true;
      return;
    }
    this.itemForm = this.emptyItemForm();
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

  closeItemDrawer(): void { if (!this.isSavingItem) this.isItemDrawerOpen = false; }

  readonly unitTypes = ['piece', 'grams', 'kilo', 'pack', 'sack', 'liter', 'box', 'bottle', 'can', 'tray', 'manual'];
  readonly unitTypeOptions: { value: string; label: string }[] = [
    { value: 'piece', label: 'Piece' },
    { value: 'pack', label: 'Pack' },
    { value: 'kilo', label: 'Kilo' },
    { value: 'sack', label: 'Sack' },
    { value: 'grams', label: 'Grams (fixed unit)' },
    { value: 'manual', label: 'Manual (enter grams at POS)' },
    { value: 'liter', label: 'Liter' },
    { value: 'box', label: 'Box' },
    { value: 'bottle', label: 'Bottle' },
    { value: 'can', label: 'Can' },
    { value: 'tray', label: 'Tray' },
  ];

  unitPriceHint(unitType: string): string {
    if (unitType === 'manual') return 'Price per gram';
    if (unitType === 'kilo') return 'Price per kilo';
    if (unitType === 'grams') return 'Price per gram pack/unit';
    return 'Selling price per unit';
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
  }

  async openEditProductById(productId: number): Promise<void> {
    try {
      const r = await this.posSvc.getInventoryProduct(productId);
      if (!r.success || !r.data) {
        this.notify.error('Error', r.message ?? 'Failed to load product.');
        return;
      }
      await this.populateProductForm(r.data);
    } catch {
      this.notify.error('Error', 'Failed to load product.');
    }
  }

  async openEditProduct(variant: InventoryVariantRow): Promise<void> {
    await this.openEditProductById(variant.productId);
  }

  private async populateProductForm(d: {
    id: number;
    name: string;
    category?: string | null;
    brand?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    variants?: Array<InventoryVariantRow & { units?: Array<{ unitType: string; sellingPrice: number; salePrice?: number | null; isManualEntry?: boolean }> }>;
  }): Promise<void> {
      this.productForm = {
        id: d.id,
        name: d.name,
        category: d.category ?? '',
        brand: d.brand ?? '',
        description: d.description ?? '',
        imageUrl: d.imageUrl ?? null,
        imagePreview: d.imageUrl ?? null,
        imageFile: null,
        variants: (d.variants ?? []).map((v: InventoryVariantRow & { units?: Array<{ unitType: string; sellingPrice: number; salePrice?: number | null; isManualEntry?: boolean }> }) => ({
          id: v.id,
          variantName: v.variantName,
          stockQty: v.stockQty,
          stockWarning: v.stockWarning ?? 0,
          costPrice: v.costPrice ?? 0,
          sellingPrice: v.sellingPrice ?? 0,
          salePrice: v.salePrice ?? null,
          unitType: v.unitType ?? 'piece',
          marginPercent: v.marginPercent ?? null,
          units: (v.units?.length ? v.units : [{
            unitType: v.unitType ?? 'piece',
            sellingPrice: v.sellingPrice ?? 0,
            salePrice: v.salePrice ?? null,
            isManualEntry: v.unitType === 'manual',
          }]).map((u) => ({
            unitType: u.unitType,
            sellingPrice: u.sellingPrice ?? 0,
            salePrice: u.salePrice ?? null,
            isManualEntry: Boolean(u.isManualEntry) || u.unitType === 'manual',
          })),
          imageUrl: v.imageUrl ?? null,
          imagePreview: v.imageUrl ?? null,
          imageFile: null,
        })),
      };
      if (!this.productForm.variants.length) {
        this.productForm.variants = [this.emptyVariantRow()];
      }
      this.editingProductId = d.id;
      this.itemDrawerMode = 'edit';
      this.isItemDrawerOpen = true;
  }

  addVariantRow(): void {
    this.productForm.variants.unshift(this.emptyVariantRow());
  }

  addUnitRow(variantIndex: number): void {
    this.productForm.variants[variantIndex].units.push(this.emptyUnitRow());
  }

  removeUnitRow(variantIndex: number, unitIndex: number): void {
    const units = this.productForm.variants[variantIndex].units;
    if (units.length <= 1) return;
    units.splice(unitIndex, 1);
    this.syncVariantPrimaryUnit(variantIndex);
  }

  onUnitTypeChange(variantIndex: number, unitIndex: number): void {
    const unit = this.productForm.variants[variantIndex].units[unitIndex];
    unit.isManualEntry = unit.unitType === 'manual';
    this.syncVariantPrimaryUnit(variantIndex);
  }

  onUnitPriceChange(variantIndex: number): void {
    this.syncVariantPrimaryUnit(variantIndex);
    this.onVariantSellingChange(variantIndex);
  }

  private syncVariantPrimaryUnit(variantIndex: number): void {
    const v = this.productForm.variants[variantIndex];
    const primary = v.units[0];
    if (!primary) return;
    v.unitType = primary.unitType;
    v.sellingPrice = primary.sellingPrice;
    v.salePrice = primary.salePrice;
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
    if (!this.productForm.name.trim()) {
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
    const label = this.itemDrawerMode === 'create' ? 'Add this product?' : 'Save changes to this product?';
    this.openConfirm('Confirm save', label, () => void this.saveProduct());
  }

  async saveProduct(): Promise<void> {
    if (this.isSavingItem) return;
    this.isSavingItem = true;
    try {
      if (this.productForm.category?.trim()) {
        await this.svc.createCategory(this.productForm.category.trim());
        await this.loadCategoryOptions();
      }
      const productId = this.productForm.id ?? this.editingProductId ?? undefined;
      const payload = {
        id: productId,
        name: this.productForm.name.trim(),
        category: this.productForm.category || undefined,
        brand: this.productForm.brand || undefined,
        description: this.productForm.description || undefined,
        variants: this.productForm.variants
          .filter((v) => v.variantName.trim())
          .map((v) => {
            const sellingPrice = this.toFiniteNumber(v.units[0]?.sellingPrice ?? v.sellingPrice, 0);
            const costPrice = this.toFiniteNumber(v.costPrice, 0);
            return {
              id: v.id,
              variantName: v.variantName.trim(),
              stockQty: this.toFiniteNumber(v.stockQty, 0),
              stockWarning: this.toFiniteNumber(v.stockWarning, 0),
              costPrice,
              sellingPrice,
              salePrice: v.units[0]?.salePrice ?? v.salePrice ?? null,
              unitType: v.units[0]?.unitType ?? v.unitType,
              marginPercent: this.computeMargin(costPrice, sellingPrice),
              units: v.units.map((u) => ({
                unitType: u.unitType,
                sellingPrice: this.toFiniteNumber(u.sellingPrice, 0),
                salePrice: u.salePrice ?? null,
                isManualEntry: u.isManualEntry || u.unitType === 'manual',
              })),
            };
          }),
      };
      if (!payload.variants.length) {
        this.notify.warning('Required', 'Add at least one variant.');
        return;
      }
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
      if (this.productForm.imageFile) {
        const upload = await this.posSvc.uploadProductImage(savedId, this.productForm.imageFile);
        if (!upload.success) {
          this.notify.error('Image upload failed', upload.message ?? 'Product saved but image upload failed.');
        }
      }
      {
        const fresh = await this.posSvc.getInventoryProduct(savedId);
        const savedVariants = fresh.data?.variants ?? [];
        for (const local of this.productForm.variants) {
          if (!local.imageFile || !local.variantName.trim()) continue;
          const remote = savedVariants.find((sv: InventoryVariantRow) => sv.variantName === local.variantName.trim());
          if (remote?.id) {
            const upload = await this.posSvc.uploadVariantImage(remote.id, local.imageFile);
            if (!upload.success) {
              this.notify.warning('Image', upload.message ?? `Variant "${local.variantName}" image upload failed.`);
            }
          }
        }
      }
      this.notify.success('Saved', this.itemDrawerMode === 'create' ? 'Product added.' : 'Product updated.');
      this.isItemDrawerOpen = false;
      this.editingProductId = null;
      await this.loadItems();
    } catch {
      this.notify.error('Error', 'Unexpected error.');
    } finally {
      this.isSavingItem = false;
    }
  }

  requestDeleteVariant(variant: InventoryVariantRow): void {
    this.openConfirm(
      'Delete variant?',
      `Delete "${variant.variantName}" from ${variant.productName}? Other variants will be kept.`,
      () => void this.deleteVariant(variant.id),
      'danger',
    );
  }

  async deleteVariant(variantId: number): Promise<void> {
    try {
      const r = await this.posSvc.deleteInventoryVariant(variantId);
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not delete variant.');
        return;
      }
      this.notify.success('Deleted', 'Variant removed.');
      await this.loadItems();
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
      'Delete product type?',
      `Delete "${productName}" and all its variants? This cannot be undone.`,
      () => void this.deleteProduct(productId),
      'danger',
    );
  }

  async deleteProduct(productId: number): Promise<void> {
    try {
      const r = await this.posSvc.deleteInventoryProduct(productId);
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not delete product.');
        return;
      }
      this.notify.success('Deleted', 'Product removed.');
      await this.loadItems();
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

  private emptyUnitRow() {
    return {
      unitType: 'piece',
      sellingPrice: 0,
      salePrice: null as number | null,
      isManualEntry: false,
    };
  }

  private emptyVariantRow() {
    return {
      id: undefined as number | undefined,
      variantName: '',
      stockQty: 0,
      stockWarning: 0,
      costPrice: 0,
      sellingPrice: 0,
      salePrice: null as number | null,
      marginPercent: null as number | null,
      unitType: 'piece',
      units: [this.emptyUnitRow()],
      imageUrl: null as string | null,
      imagePreview: null as string | null,
      imageFile: null as File | null,
    };
  }

  private emptyProductForm() {
    return {
      id: null as number | null,
      name: '',
      category: '',
      brand: '',
      description: '',
      imageUrl: null as string | null,
      imagePreview: null as string | null,
      imageFile: null as File | null,
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
  private emptyPOItem(): PurchaseOrderItem & { _uid: number } { return { _uid: ++this.poItemUid, itemName: '', brand: '', category: '', quantity: 1, unitCost: 0, inventoryId: null }; }
}
