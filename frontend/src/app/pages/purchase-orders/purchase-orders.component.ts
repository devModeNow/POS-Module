import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { DatePickerComponent } from '../../shared/components/form/date-picker/date-picker.component';
import { ConfirmDialogComponent } from '../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { InventoryItem, InventoryService, PurchaseOrder, PurchaseOrderItem, Supplier } from '../../shared/services/inventory.service';
import { NotificationService } from '../../shared/services/notification.service';
import { PosService } from '../../shared/services/pos.service';

type EditablePOItem = PurchaseOrderItem & {
  _uid: number;
  productId?: number | null;
  productName?: string | null;
  unitType?: string | null;
  stockQty?: number | null;
  variantLabel?: string | null;
  availableUnits?: string[];
};

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, DatePickerComponent, CanDirective, ConfirmDialogComponent],
  templateUrl: './purchase-orders.component.html',
})
export class PurchaseOrdersComponent implements OnInit {
  purchaseOrders: PurchaseOrder[] = [];
  poFilterStatus = '';
  poFilterSupplier = '';
  isLoadingPO = false;
  isSavingPO = false;
  isCreatePOOpen = false;

  poDetail: PurchaseOrder | null = null;

  poForm = this.emptyPOForm();
  poItems: EditablePOItem[] = [this.emptyPOItem()];

  supplierSearchText = '';
  supplierSearchResults: Supplier[] = [];
  showSupplierDropdown = false;
  private supplierSearchTimer: ReturnType<typeof setTimeout> | null = null;

  poItemSearchResults: InventoryItem[][] = [[]];
  poItemSearching: boolean[] = [false];
  poItemSearchTimers: ReturnType<typeof setTimeout>[] = [];
  poItemProductTypeSuggestions: { id: number; name: string }[][] = [[]];
  poItemUnitTypeSuggestions: { code: string; label: string }[][] = [[]];
  poItemBrandSuggestions: { id: number; name: string }[][] = [[]];
  poItemCategorySuggestions: { id: number; name: string }[][] = [[]];
  showPoItemProductTypeDropdown: boolean[] = [false];
  showPoItemUnitTypeDropdown: boolean[] = [false];
  showPoItemBrandDropdown: boolean[] = [false];
  showPoItemCategoryDropdown: boolean[] = [false];
  private poItemProductTypeTimers: ReturnType<typeof setTimeout>[] = [];
  private poItemUnitTypeTimers: ReturnType<typeof setTimeout>[] = [];
  private poItemBrandTimers: ReturnType<typeof setTimeout>[] = [];
  private poItemCategoryTimers: ReturnType<typeof setTimeout>[] = [];
  private orgUnitTypes: { code: string; label: string }[] = [];
  private poItemUid = 0;

  // Draft PO detail item smart-search state (parallel to create form arrays)
  detailItemSearchResults: InventoryItem[][] = [];
  detailItemSearchTimers: ReturnType<typeof setTimeout>[] = [];
  detailItemProductTypeSuggestions: { id: number; name: string }[][] = [];
  detailItemUnitTypeSuggestions: { code: string; label: string }[][] = [];
  detailItemBrandSuggestions: { id: number; name: string }[][] = [];
  detailItemCategorySuggestions: { id: number; name: string }[][] = [];
  showDetailItemProductTypeDropdown: boolean[] = [];
  showDetailItemUnitTypeDropdown: boolean[] = [];
  showDetailItemBrandDropdown: boolean[] = [];
  showDetailItemCategoryDropdown: boolean[] = [];
  private detailItemProductTypeTimers: ReturnType<typeof setTimeout>[] = [];
  private detailItemUnitTypeTimers: ReturnType<typeof setTimeout>[] = [];
  private detailItemBrandTimers: ReturnType<typeof setTimeout>[] = [];
  private detailItemCategoryTimers: ReturnType<typeof setTimeout>[] = [];

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmVariant: 'primary' | 'danger' = 'primary';
  private confirmAction: (() => void) | null = null;

  constructor(
    private readonly svc: InventoryService,
    private readonly notify: NotificationService,
    private readonly posSvc: PosService,
  ) {}

  ngOnInit(): void {
    void this.loadPO();
  }

  async loadPO(): Promise<void> {
    this.isLoadingPO = true;
    try {
      const r = await this.svc.getAllPO(this.poFilterStatus || undefined);
      let data = r.data ?? [];
      if (this.poFilterSupplier.trim()) {
        const q = this.poFilterSupplier.trim().toLowerCase();
        data = data.filter((po) => (po.supplierName ?? '').toLowerCase().includes(q));
      }
      this.purchaseOrders = data;
    } catch {
      this.purchaseOrders = [];
    } finally {
      this.isLoadingPO = false;
    }
  }

  resetPOForm(): void {
    this.poForm = this.emptyPOForm();
    this.poItems = [this.emptyPOItem()];
    this.poItemSearchResults = [[]];
    this.poItemSearching = [false];
    this.poItemProductTypeSuggestions = [[]];
    this.poItemUnitTypeSuggestions = [[]];
    this.poItemBrandSuggestions = [[]];
    this.poItemCategorySuggestions = [[]];
    this.showPoItemProductTypeDropdown = [false];
    this.showPoItemUnitTypeDropdown = [false];
    this.showPoItemBrandDropdown = [false];
    this.showPoItemCategoryDropdown = [false];
    this.supplierSearchText = '';
    this.supplierSearchResults = [];
    this.showSupplierDropdown = false;
  }

  openCreatePO(): void {
    this.resetPOForm();
    this.isCreatePOOpen = true;
    void this.ensureOrgUnitTypes();
  }

  private async ensureOrgUnitTypes(): Promise<void> {
    if (this.orgUnitTypes.length) return;
    try {
      const r = await this.svc.getUnitTypes();
      this.orgUnitTypes = (r.data ?? [])
        .filter((u) => u.isActive !== false)
        .map((u) => ({
          code: String(u.code || '').trim(),
          label: String(u.label || u.code || '').trim(),
        }))
        .filter((u) => !!u.code);
    } catch {
      this.orgUnitTypes = [];
    }
  }

  closeCreatePO(): void {
    if (this.isSavingPO) return;
    this.isCreatePOOpen = false;
  }

  onSupplierSearchInput(): void {
    this.poForm.supplierId = null;
    const q = this.supplierSearchText.trim();
    if (this.supplierSearchTimer) clearTimeout(this.supplierSearchTimer);
    if (q.length < 1) {
      this.supplierSearchResults = [];
      this.showSupplierDropdown = false;
      return;
    }
    this.supplierSearchTimer = setTimeout(() => void this.doSupplierSearch(q), 250);
  }

  private async doSupplierSearch(q: string): Promise<void> {
    try {
      const r = await this.svc.searchSuppliers(q);
      this.supplierSearchResults = r.data ?? [];
      this.showSupplierDropdown = this.supplierSearchResults.length > 0;
    } catch {
      this.supplierSearchResults = [];
      this.showSupplierDropdown = false;
    }
  }

  selectSupplier(s: Supplier): void {
    this.poForm.supplierId = s.id;
    this.supplierSearchText = s.name;
    this.showSupplierDropdown = false;
  }

  hideSupplierDropdown(): void {
    setTimeout(() => {
      this.showSupplierDropdown = false;
    }, 200);
  }

  onOrderDateChange(event: { dateStr: string }): void {
    this.poForm.orderDate = event.dateStr;
  }

  onExpectedDateChange(event: { dateStr: string }): void {
    this.poForm.expectedDate = event.dateStr;
  }

  addPOItem(): void {
    this.poItems.push(this.emptyPOItem());
    this.poItemSearchResults.push([]);
    this.poItemSearching.push(false);
    this.poItemProductTypeSuggestions.push([]);
    this.poItemUnitTypeSuggestions.push([]);
    this.poItemBrandSuggestions.push([]);
    this.poItemCategorySuggestions.push([]);
    this.showPoItemProductTypeDropdown.push(false);
    this.showPoItemUnitTypeDropdown.push(false);
    this.showPoItemBrandDropdown.push(false);
    this.showPoItemCategoryDropdown.push(false);
  }

  removePOItem(i: number): void {
    if (this.poItems.length <= 1) return;
    this.poItems.splice(i, 1);
    this.poItemSearchResults.splice(i, 1);
    this.poItemSearching.splice(i, 1);
    this.poItemProductTypeSuggestions.splice(i, 1);
    this.poItemUnitTypeSuggestions.splice(i, 1);
    this.poItemBrandSuggestions.splice(i, 1);
    this.poItemCategorySuggestions.splice(i, 1);
    this.showPoItemProductTypeDropdown.splice(i, 1);
    this.showPoItemUnitTypeDropdown.splice(i, 1);
    this.showPoItemBrandDropdown.splice(i, 1);
    this.showPoItemCategoryDropdown.splice(i, 1);
  }

  onPOItemNameInput(index: number): void {
    const q = this.poItems[index].itemName.trim();
    if (this.poItemSearchTimers[index]) clearTimeout(this.poItemSearchTimers[index]);
    this.poItems[index].inventoryId = null;
    this.poItems[index].variantId = null;
    if (q.length < 2) {
      this.poItemSearchResults[index] = [];
      return;
    }
    this.poItemSearchTimers[index] = setTimeout(() => void this.searchPOItem(index, q), 300);
  }

  private async searchPOItem(index: number, q: string): Promise<void> {
    this.poItemSearching[index] = true;
    try {
      const r = await this.svc.search(q);
      // PO smart search should return specific variants only (not legacy product types).
      this.poItemSearchResults[index] = (r.data ?? []).filter(
        (item) => item.source === 'pos' && !!item.variantId,
      );
    } catch {
      this.poItemSearchResults[index] = [];
    } finally {
      this.poItemSearching[index] = false;
    }
  }

  async selectPOItemProduct(index: number, product: InventoryItem): Promise<void> {
    if (!product.variantId) {
      this.notify.warning('Variant required', 'Select a specific variant for this purchase order.');
      return;
    }
    this.poItems[index].variantId = product.variantId;
    this.poItems[index].inventoryId = null;
    this.poItems[index].itemName = product.variantName || product.partName;
    this.poItems[index].productName = product.productName || product.partName;
    this.poItems[index].brand = product.brand ?? '';
    this.poItems[index].category = product.category ?? '';
    this.poItems[index].unitCost = product.costPrice ?? 0;
    this.poItems[index].productId = product.productId ?? null;
    this.poItems[index].stockQty = Number(product.stockQty ?? 0);
    this.poItems[index].unitType = product.unitType ?? 'piece';
    this.poItems[index].variantLabel = product.variantName || product.partName;
    this.poItems[index].availableUnits = product.unitType ? [String(product.unitType)] : ['piece'];
    this.poItemSearchResults[index] = [];

    if (product.productId && product.variantId) {
      try {
        const r = await this.posSvc.getInventoryProduct(product.productId);
        const variant = (r.data?.variants ?? []).find((v: { id: number }) => v.id === product.variantId);
        if (variant) {
          this.poItems[index].productName = String(r.data?.name ?? product.productName ?? '');
          this.poItems[index].variantLabel = String(variant.variantName ?? product.variantName ?? product.partName);
          this.poItems[index].itemName = this.poItems[index].variantLabel || this.poItems[index].itemName;
          this.poItems[index].stockQty = Number(variant.stockQty ?? product.stockQty ?? 0);
          this.poItems[index].unitCost = Number(variant.costPrice ?? product.costPrice ?? 0);
          const units = Array.isArray(variant.units)
            ? variant.units.map((u: { unitType?: string }) => String(u.unitType || '').trim()).filter(Boolean)
            : [];
          const fallback = String(variant.unitType ?? product.unitType ?? 'piece');
          this.poItems[index].availableUnits = units.length ? units : [fallback];
          if (!this.poItems[index].unitType || !this.poItems[index].availableUnits!.includes(this.poItems[index].unitType)) {
            this.poItems[index].unitType = this.poItems[index].availableUnits![0] ?? fallback;
          }
        }
      } catch {
        /* keep search result data */
      }
    }
  }

  itemSourceLabel(item: EditablePOItem): string {
    if (item.variantId) return 'POS variant';
    return 'New item';
  }

  onPoItemProductTypeInput(index: number, value: string): void {
    if (this.poItemProductTypeTimers[index]) clearTimeout(this.poItemProductTypeTimers[index]);
    this.poItemProductTypeTimers[index] = setTimeout(
      () => void this.searchPoItemProductTypes(index, value ?? ''),
      250,
    );
  }

  private async searchPoItemProductTypes(index: number, q: string): Promise<void> {
    try {
      const r = await this.posSvc.getProducts(q.trim() || undefined);
      const rows = (r.data ?? [])
        .map((p) => ({ id: p.id, name: String(p.name ?? '').trim() }))
        .filter((p) => !!p.name);
      // Deduplicate by lowercased name.
      const seen = new Set<string>();
      this.poItemProductTypeSuggestions[index] = rows.filter((p) => {
        const key = p.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      this.showPoItemProductTypeDropdown[index] = this.poItemProductTypeSuggestions[index].length > 0;
    } catch {
      this.poItemProductTypeSuggestions[index] = [];
      this.showPoItemProductTypeDropdown[index] = false;
    }
  }

  selectPoItemProductType(index: number, name: string, productId?: number): void {
    this.poItems[index].productName = name;
    if (productId) this.poItems[index].productId = productId;
    this.showPoItemProductTypeDropdown[index] = false;
  }

  hidePoItemProductTypeDropdown(index: number): void {
    setTimeout(() => {
      this.showPoItemProductTypeDropdown[index] = false;
    }, 180);
  }

  onPoItemUnitTypeInput(index: number, value: string): void {
    if (this.poItemUnitTypeTimers[index]) clearTimeout(this.poItemUnitTypeTimers[index]);
    this.poItemUnitTypeTimers[index] = setTimeout(
      () => void this.searchPoItemUnitTypes(index, value ?? ''),
      150,
    );
  }

  private async searchPoItemUnitTypes(index: number, q: string): Promise<void> {
    await this.ensureOrgUnitTypes();
    const query = q.trim().toLowerCase();
    const fromVariant = (this.poItems[index].availableUnits ?? []).map((code) => ({
      code,
      label: code,
    }));
    const merged = [...fromVariant, ...this.orgUnitTypes];
    const seen = new Set<string>();
    const unique = merged.filter((u) => {
      const key = u.code.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.poItemUnitTypeSuggestions[index] = query
      ? unique.filter(
          (u) =>
            u.code.toLowerCase().includes(query) ||
            u.label.toLowerCase().includes(query),
        )
      : unique;
    this.showPoItemUnitTypeDropdown[index] = this.poItemUnitTypeSuggestions[index].length > 0;
  }

  selectPoItemUnitType(index: number, code: string): void {
    this.poItems[index].unitType = code;
    this.showPoItemUnitTypeDropdown[index] = false;
  }

  hidePoItemUnitTypeDropdown(index: number): void {
    setTimeout(() => {
      this.showPoItemUnitTypeDropdown[index] = false;
    }, 180);
  }

  onPoItemBrandInput(index: number, value: string): void {
    if (this.poItemBrandTimers[index]) clearTimeout(this.poItemBrandTimers[index]);
    this.poItemBrandTimers[index] = setTimeout(
      () => void this.searchPoItemBrands(index, value ?? ''),
      250,
    );
  }

  private async searchPoItemBrands(index: number, q: string): Promise<void> {
    try {
      const r = await this.svc.getBrands(q.trim() || undefined);
      this.poItemBrandSuggestions[index] = r.data ?? [];
      this.showPoItemBrandDropdown[index] = (this.poItemBrandSuggestions[index]?.length ?? 0) > 0;
    } catch {
      this.poItemBrandSuggestions[index] = [];
      this.showPoItemBrandDropdown[index] = false;
    }
  }

  selectPoItemBrand(index: number, name: string): void {
    this.poItems[index].brand = name;
    this.showPoItemBrandDropdown[index] = false;
  }

  hidePoItemBrandDropdown(index: number): void {
    setTimeout(() => {
      this.showPoItemBrandDropdown[index] = false;
    }, 180);
  }

  onPoItemCategoryInput(index: number, value: string): void {
    if (this.poItemCategoryTimers[index]) clearTimeout(this.poItemCategoryTimers[index]);
    this.poItemCategoryTimers[index] = setTimeout(
      () => void this.searchPoItemCategories(index, value ?? ''),
      250,
    );
  }

  private async searchPoItemCategories(index: number, q: string): Promise<void> {
    try {
      const r = await this.svc.getCategories(q.trim() || undefined);
      this.poItemCategorySuggestions[index] = r.data ?? [];
      this.showPoItemCategoryDropdown[index] = (this.poItemCategorySuggestions[index]?.length ?? 0) > 0;
    } catch {
      this.poItemCategorySuggestions[index] = [];
      this.showPoItemCategoryDropdown[index] = false;
    }
  }

  selectPoItemCategory(index: number, name: string): void {
    this.poItems[index].category = name;
    this.showPoItemCategoryDropdown[index] = false;
  }

  hidePoItemCategoryDropdown(index: number): void {
    setTimeout(() => {
      this.showPoItemCategoryDropdown[index] = false;
    }, 180);
  }

  async savePO(): Promise<void> {
    const supplierName = this.supplierSearchText.trim();
    if (!this.poForm.supplierId && !supplierName) {
      this.notify.warning('Required', 'Please enter or select a supplier.');
      return;
    }
    if (this.poItems.some((i) => !i.itemName.trim())) {
      this.notify.warning('Required', 'All items need a name.');
      return;
    }

    this.isSavingPO = true;
    try {
      if (!this.poForm.supplierId && supplierName) {
        const sr = await this.svc.createSupplier(supplierName);
        if (!sr.success || !sr.data) {
          this.notify.error('Failed', sr.message ?? 'Could not create supplier.');
          return;
        }
        this.poForm.supplierId = sr.data.id;
      }

      for (const item of this.poItems) {
        if (item.brand?.trim()) void this.svc.createBrand(item.brand.trim());
        if (item.category?.trim()) void this.svc.createCategory(item.category.trim());
        const unit = String(item.unitType ?? '').trim();
        if (unit) {
          const exists = this.orgUnitTypes.some(
            (u) => u.code.toLowerCase() === unit.toLowerCase(),
          );
          if (!exists) {
            void this.svc.createUnitType({
              code: unit.toLowerCase().replace(/\s+/g, '_'),
              label: unit,
            }).then(() => {
              this.orgUnitTypes = [];
            });
          }
        }
      }

      const r = await this.svc.createPO({
        supplierId: Number(this.poForm.supplierId),
        comments: this.poForm.comments || undefined,
        items: this.poItems.map((i) => {
          const item: PurchaseOrderItem = {
            itemName: i.itemName,
            productName: i.productName?.trim() || undefined,
            quantity: Math.max(1, Math.round(i.quantity)),
            unitCost: Number(i.unitCost) || 0,
            brand: i.brand?.trim() || undefined,
            category: i.category?.trim() || undefined,
          };
          if (i.inventoryId) item.inventoryId = Number(i.inventoryId);
          if (i.variantId) item.variantId = Number(i.variantId);
          if (i.unitType?.trim()) item.unitType = i.unitType.trim();
          return item;
        }),
      });
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Operation failed.');
        return;
      }
      this.notify.success('Created', 'Purchase order created.');
      this.resetPOForm();
      this.isCreatePOOpen = false;
      await this.loadPO();
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error('Error', Array.isArray(msg) ? msg[0] : (msg ?? 'Unexpected error.'));
    } finally {
      this.isSavingPO = false;
    }
  }

  async openPODetail(po: PurchaseOrder): Promise<void> {
    try {
      const r = await this.svc.getOnePO(po.id);
      this.poDetail = r.data ?? po;
    } catch {
      this.poDetail = po;
    }
    this.resetDetailItemSearchState(this.poDetail?.items?.length ?? 0);
    void this.ensureOrgUnitTypes();
  }

  closePODetail(): void {
    this.poDetail = null;
    this.resetDetailItemSearchState(0);
  }

  private resetDetailItemSearchState(count: number): void {
    this.detailItemSearchResults = Array.from({ length: count }, () => []);
    this.detailItemSearchTimers = [];
    this.detailItemProductTypeSuggestions = Array.from({ length: count }, () => []);
    this.detailItemUnitTypeSuggestions = Array.from({ length: count }, () => []);
    this.detailItemBrandSuggestions = Array.from({ length: count }, () => []);
    this.detailItemCategorySuggestions = Array.from({ length: count }, () => []);
    this.showDetailItemProductTypeDropdown = Array.from({ length: count }, () => false);
    this.showDetailItemUnitTypeDropdown = Array.from({ length: count }, () => false);
    this.showDetailItemBrandDropdown = Array.from({ length: count }, () => false);
    this.showDetailItemCategoryDropdown = Array.from({ length: count }, () => false);
    this.detailItemProductTypeTimers = [];
    this.detailItemUnitTypeTimers = [];
    this.detailItemBrandTimers = [];
    this.detailItemCategoryTimers = [];
  }

  private ensureDetailSlot(index: number): void {
    while (this.detailItemSearchResults.length <= index) {
      this.detailItemSearchResults.push([]);
      this.detailItemProductTypeSuggestions.push([]);
      this.detailItemUnitTypeSuggestions.push([]);
      this.detailItemBrandSuggestions.push([]);
      this.detailItemCategorySuggestions.push([]);
      this.showDetailItemProductTypeDropdown.push(false);
      this.showDetailItemUnitTypeDropdown.push(false);
      this.showDetailItemBrandDropdown.push(false);
      this.showDetailItemCategoryDropdown.push(false);
    }
  }

  addPoDetailItem(): void {
    this.poDetail?.items?.push({
      itemName: '',
      productName: '',
      unitType: '',
      brand: '',
      category: '',
      quantity: 1,
      unitCost: 0,
      availableUnits: [],
    });
    this.detailItemSearchResults.push([]);
    this.detailItemProductTypeSuggestions.push([]);
    this.detailItemUnitTypeSuggestions.push([]);
    this.detailItemBrandSuggestions.push([]);
    this.detailItemCategorySuggestions.push([]);
    this.showDetailItemProductTypeDropdown.push(false);
    this.showDetailItemUnitTypeDropdown.push(false);
    this.showDetailItemBrandDropdown.push(false);
    this.showDetailItemCategoryDropdown.push(false);
  }

  removePoDetailItem(index: number): void {
    if (this.poDetail?.items && this.poDetail.items.length > 1) {
      this.poDetail.items.splice(index, 1);
      this.detailItemSearchResults.splice(index, 1);
      this.detailItemProductTypeSuggestions.splice(index, 1);
      this.detailItemUnitTypeSuggestions.splice(index, 1);
      this.detailItemBrandSuggestions.splice(index, 1);
      this.detailItemCategorySuggestions.splice(index, 1);
      this.showDetailItemProductTypeDropdown.splice(index, 1);
      this.showDetailItemUnitTypeDropdown.splice(index, 1);
      this.showDetailItemBrandDropdown.splice(index, 1);
      this.showDetailItemCategoryDropdown.splice(index, 1);
    }
  }

  onDetailItemNameInput(index: number): void {
    const item = this.poDetail?.items?.[index];
    if (!item) return;
    this.ensureDetailSlot(index);
    const q = String(item.itemName ?? '').trim();
    if (this.detailItemSearchTimers[index]) clearTimeout(this.detailItemSearchTimers[index]);
    item.inventoryId = null;
    item.variantId = null;
    if (q.length < 2) {
      this.detailItemSearchResults[index] = [];
      return;
    }
    this.detailItemSearchTimers[index] = setTimeout(() => void this.searchDetailItem(index, q), 300);
  }

  private async searchDetailItem(index: number, q: string): Promise<void> {
    try {
      const r = await this.svc.search(q);
      this.detailItemSearchResults[index] = (r.data ?? []).filter(
        (row) => row.source === 'pos' && !!row.variantId,
      );
    } catch {
      this.detailItemSearchResults[index] = [];
    }
  }

  async selectDetailItemProduct(index: number, product: InventoryItem): Promise<void> {
    const item = this.poDetail?.items?.[index];
    if (!item) return;
    if (!product.variantId) {
      this.notify.warning('Variant required', 'Select a specific variant for this purchase order.');
      return;
    }
    item.variantId = product.variantId;
    item.inventoryId = null;
    item.itemName = product.variantName || product.partName;
    item.productName = product.productName || product.partName;
    item.brand = product.brand ?? '';
    item.category = product.category ?? '';
    item.unitCost = product.costPrice ?? 0;
    item.unitType = product.unitType ?? 'piece';
    item.availableUnits = product.unitType ? [String(product.unitType)] : ['piece'];
    this.detailItemSearchResults[index] = [];

    if (product.productId && product.variantId) {
      try {
        const r = await this.posSvc.getInventoryProduct(product.productId);
        const variant = (r.data?.variants ?? []).find((v: { id: number }) => v.id === product.variantId);
        if (variant) {
          item.productName = String(r.data?.name ?? product.productName ?? '');
          item.itemName = String(variant.variantName ?? product.variantName ?? product.partName);
          item.unitCost = Number(variant.costPrice ?? product.costPrice ?? 0);
          const units = Array.isArray(variant.units)
            ? variant.units.map((u: { unitType?: string }) => String(u.unitType || '').trim()).filter(Boolean)
            : [];
          const fallback = String(variant.unitType ?? product.unitType ?? 'piece');
          item.availableUnits = units.length ? units : [fallback];
          const available = item.availableUnits ?? [fallback];
          if (!item.unitType || !available.includes(String(item.unitType))) {
            item.unitType = available[0] ?? fallback;
          }
        }
      } catch {
        /* keep search result data */
      }
    }
  }

  onDetailItemProductTypeInput(index: number, value: string): void {
    this.ensureDetailSlot(index);
    if (this.detailItemProductTypeTimers[index]) clearTimeout(this.detailItemProductTypeTimers[index]);
    this.detailItemProductTypeTimers[index] = setTimeout(
      () => void this.searchDetailItemProductTypes(index, value ?? ''),
      250,
    );
  }

  private async searchDetailItemProductTypes(index: number, q: string): Promise<void> {
    try {
      const r = await this.posSvc.getProducts(q.trim() || undefined);
      const rows = (r.data ?? [])
        .map((p) => ({ id: p.id, name: String(p.name ?? '').trim() }))
        .filter((p) => !!p.name);
      const seen = new Set<string>();
      this.detailItemProductTypeSuggestions[index] = rows.filter((p) => {
        const key = p.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      this.showDetailItemProductTypeDropdown[index] = this.detailItemProductTypeSuggestions[index].length > 0;
    } catch {
      this.detailItemProductTypeSuggestions[index] = [];
      this.showDetailItemProductTypeDropdown[index] = false;
    }
  }

  selectDetailItemProductType(index: number, name: string): void {
    const item = this.poDetail?.items?.[index];
    if (!item) return;
    item.productName = name;
    this.showDetailItemProductTypeDropdown[index] = false;
  }

  hideDetailItemProductTypeDropdown(index: number): void {
    setTimeout(() => {
      this.showDetailItemProductTypeDropdown[index] = false;
    }, 180);
  }

  onDetailItemUnitTypeInput(index: number, value: string): void {
    this.ensureDetailSlot(index);
    if (this.detailItemUnitTypeTimers[index]) clearTimeout(this.detailItemUnitTypeTimers[index]);
    this.detailItemUnitTypeTimers[index] = setTimeout(
      () => void this.searchDetailItemUnitTypes(index, value ?? ''),
      150,
    );
  }

  private async searchDetailItemUnitTypes(index: number, q: string): Promise<void> {
    await this.ensureOrgUnitTypes();
    const item = this.poDetail?.items?.[index];
    const query = q.trim().toLowerCase();
    const fromVariant = (item?.availableUnits ?? []).map((code) => ({ code, label: code }));
    const merged = [...fromVariant, ...this.orgUnitTypes];
    const seen = new Set<string>();
    const unique = merged.filter((u) => {
      const key = u.code.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.detailItemUnitTypeSuggestions[index] = query
      ? unique.filter(
          (u) =>
            u.code.toLowerCase().includes(query) ||
            u.label.toLowerCase().includes(query),
        )
      : unique;
    this.showDetailItemUnitTypeDropdown[index] = this.detailItemUnitTypeSuggestions[index].length > 0;
  }

  selectDetailItemUnitType(index: number, code: string): void {
    const item = this.poDetail?.items?.[index];
    if (!item) return;
    item.unitType = code;
    this.showDetailItemUnitTypeDropdown[index] = false;
  }

  hideDetailItemUnitTypeDropdown(index: number): void {
    setTimeout(() => {
      this.showDetailItemUnitTypeDropdown[index] = false;
    }, 180);
  }

  onDetailItemBrandInput(index: number, value: string): void {
    this.ensureDetailSlot(index);
    if (this.detailItemBrandTimers[index]) clearTimeout(this.detailItemBrandTimers[index]);
    this.detailItemBrandTimers[index] = setTimeout(
      () => void this.searchDetailItemBrands(index, value ?? ''),
      250,
    );
  }

  private async searchDetailItemBrands(index: number, q: string): Promise<void> {
    try {
      const r = await this.svc.getBrands(q.trim() || undefined);
      this.detailItemBrandSuggestions[index] = r.data ?? [];
      this.showDetailItemBrandDropdown[index] = (this.detailItemBrandSuggestions[index]?.length ?? 0) > 0;
    } catch {
      this.detailItemBrandSuggestions[index] = [];
      this.showDetailItemBrandDropdown[index] = false;
    }
  }

  selectDetailItemBrand(index: number, name: string): void {
    const item = this.poDetail?.items?.[index];
    if (!item) return;
    item.brand = name;
    this.showDetailItemBrandDropdown[index] = false;
  }

  hideDetailItemBrandDropdown(index: number): void {
    setTimeout(() => {
      this.showDetailItemBrandDropdown[index] = false;
    }, 180);
  }

  onDetailItemCategoryInput(index: number, value: string): void {
    this.ensureDetailSlot(index);
    if (this.detailItemCategoryTimers[index]) clearTimeout(this.detailItemCategoryTimers[index]);
    this.detailItemCategoryTimers[index] = setTimeout(
      () => void this.searchDetailItemCategories(index, value ?? ''),
      250,
    );
  }

  private async searchDetailItemCategories(index: number, q: string): Promise<void> {
    try {
      const r = await this.svc.getCategories(q.trim() || undefined);
      this.detailItemCategorySuggestions[index] = r.data ?? [];
      this.showDetailItemCategoryDropdown[index] = (this.detailItemCategorySuggestions[index]?.length ?? 0) > 0;
    } catch {
      this.detailItemCategorySuggestions[index] = [];
      this.showDetailItemCategoryDropdown[index] = false;
    }
  }

  selectDetailItemCategory(index: number, name: string): void {
    const item = this.poDetail?.items?.[index];
    if (!item) return;
    item.category = name;
    this.showDetailItemCategoryDropdown[index] = false;
  }

  hideDetailItemCategoryDropdown(index: number): void {
    setTimeout(() => {
      this.showDetailItemCategoryDropdown[index] = false;
    }, 180);
  }

  async editPO(po: PurchaseOrder): Promise<void> {
    if (!po.items?.length) {
      this.notify.warning('Required', 'At least one item is required.');
      return;
    }
    if (po.items.some((i) => !i.itemName?.trim())) {
      this.notify.warning('Required', 'All items need a name.');
      return;
    }
    try {
      for (const item of po.items) {
        if (item.brand?.trim()) void this.svc.createBrand(item.brand.trim());
        if (item.category?.trim()) void this.svc.createCategory(item.category.trim());
        const unit = String(item.unitType ?? '').trim();
        if (unit) {
          const exists = this.orgUnitTypes.some((u) => u.code.toLowerCase() === unit.toLowerCase());
          if (!exists) {
            void this.svc.createUnitType({
              code: unit.toLowerCase().replace(/\s+/g, '_'),
              label: unit,
            }).then(() => {
              this.orgUnitTypes = [];
            });
          }
        }
      }

      const r = await this.svc.updatePO(po.id, {
        comments: po.comments ?? undefined,
        items: po.items.map((i) => ({
          id: i.id,
          inventoryId: i.inventoryId ?? undefined,
          variantId: i.variantId ?? undefined,
          itemName: i.itemName || i.productName || '',
          productName: i.productName || undefined,
          unitType: i.unitType || undefined,
          brand: i.brand || undefined,
          category: i.category || undefined,
          quantity: Math.max(1, Math.round(i.quantity)),
          unitCost: Number(i.unitCost) || 0,
        })),
      });
      if (!r.success) {
        this.notify.error('Failed', r.message ?? 'Could not update PO.');
        return;
      }
      this.notify.success('Updated', 'Purchase order updated.');
      await this.loadPO();
      const detail = await this.svc.getOnePO(po.id);
      this.poDetail = detail.data ?? po;
      this.resetDetailItemSearchState(this.poDetail?.items?.length ?? 0);
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error('Error', Array.isArray(msg) ? msg[0] : (msg ?? 'Unexpected error.'));
    }
  }

  async receivePO(id: number): Promise<void> {
    this.openConfirm(
      'Receive purchase order?',
      'Mark this PO as received and update stock?',
      () => void this.doReceivePO(id),
      'primary',
    );
  }

  private async doReceivePO(id: number): Promise<void> {
    try {
      const r = await this.svc.receivePO(id);
      if (!r.success) {
        this.notify.error('Error', r.message ?? 'Failed to receive PO.');
        return;
      }
      this.notify.success('Received', 'Stock updated from PO.');
      this.poDetail = null;
      await this.loadPO();
    } catch {
      this.notify.error('Error', 'Failed to receive PO.');
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

  poStatusClass(status: string): string {
    const value = String(status ?? '').toLowerCase();
    if (value === 'received') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    if (value === 'cancelled') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
  }

  lineTotal(item: { quantity: number; unitCost: number }): number {
    return Number(item.quantity || 0) * Number(item.unitCost || 0);
  }

  private emptyPOForm() {
    const today = new Date().toISOString().slice(0, 10);
    return { supplierId: null as number | null, comments: '', orderDate: today, expectedDate: today };
  }

  private emptyPOItem(): EditablePOItem {
    return {
      _uid: ++this.poItemUid,
      itemName: '',
      productName: '',
      brand: '',
      category: '',
      quantity: 1,
      unitCost: 0,
      inventoryId: null,
      variantId: null,
      productId: null,
      unitType: null,
      stockQty: null,
      variantLabel: null,
      availableUnits: [],
    };
  }
}
