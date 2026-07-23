import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { DatePickerComponent } from '../../shared/components/form/date-picker/date-picker.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { InventoryItem, InventoryService, PurchaseOrder, PurchaseOrderItem, Supplier } from '../../shared/services/inventory.service';
import { NotificationService } from '../../shared/services/notification.service';
import { PosService } from '../../shared/services/pos.service';

type EditablePOItem = PurchaseOrderItem & {
  _uid: number;
  productId?: number | null;
  unitType?: string | null;
  stockQty?: number | null;
  variantLabel?: string | null;
};

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, DatePickerComponent, CanDirective],
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
  poItemBrandSuggestions: { id: number; name: string }[][] = [[]];
  poItemCategorySuggestions: { id: number; name: string }[][] = [[]];
  showPoItemBrandDropdown: boolean[] = [false];
  showPoItemCategoryDropdown: boolean[] = [false];
  private poItemUid = 0;

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
    this.poItemBrandSuggestions = [[]];
    this.poItemCategorySuggestions = [[]];
    this.showPoItemBrandDropdown = [false];
    this.showPoItemCategoryDropdown = [false];
    this.supplierSearchText = '';
    this.supplierSearchResults = [];
    this.showSupplierDropdown = false;
  }

  openCreatePO(): void {
    this.resetPOForm();
    this.isCreatePOOpen = true;
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
    this.poItemBrandSuggestions.push([]);
    this.poItemCategorySuggestions.push([]);
    this.showPoItemBrandDropdown.push(false);
    this.showPoItemCategoryDropdown.push(false);
  }

  removePOItem(i: number): void {
    if (this.poItems.length <= 1) return;
    this.poItems.splice(i, 1);
    this.poItemSearchResults.splice(i, 1);
    this.poItemSearching.splice(i, 1);
    this.poItemBrandSuggestions.splice(i, 1);
    this.poItemCategorySuggestions.splice(i, 1);
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
      this.poItemSearchResults[index] = r.data ?? [];
    } catch {
      this.poItemSearchResults[index] = [];
    } finally {
      this.poItemSearching[index] = false;
    }
  }

  async selectPOItemProduct(index: number, product: InventoryItem): Promise<void> {
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
    this.poItems[index].productId = product.productId ?? null;
    this.poItems[index].stockQty = Number(product.stockQty ?? 0);
    this.poItems[index].unitType = product.unitType ?? null;
    this.poItems[index].variantLabel = product.partName ?? '';
    this.poItemSearchResults[index] = [];

    if (product.productId && product.variantId) {
      try {
        const r = await this.posSvc.getInventoryProduct(product.productId);
        const variant = (r.data?.variants ?? []).find((v: { id: number }) => v.id === product.variantId);
        if (variant) {
          this.poItems[index].variantLabel = String(variant.variantName ?? product.partName);
          this.poItems[index].unitType = String(variant.unitType ?? product.unitType ?? 'piece');
          this.poItems[index].stockQty = Number(variant.stockQty ?? product.stockQty ?? 0);
          this.poItems[index].unitCost = Number(variant.costPrice ?? product.costPrice ?? 0);
        }
      } catch {
        /* keep search result data */
      }
    }
  }

  itemSourceLabel(item: EditablePOItem): string {
    if (item.variantId) return 'POS variant';
    if (item.inventoryId) return 'Inventory item';
    return 'New item';
  }

  onPoItemBrandInput(index: number, value: string): void {
    if (value.trim().length < 1) {
      this.poItemBrandSuggestions[index] = [];
      this.showPoItemBrandDropdown[index] = false;
      return;
    }
    setTimeout(() => void this.searchPoItemBrands(index, value), 250);
  }

  private async searchPoItemBrands(index: number, q: string): Promise<void> {
    try {
      const r = await this.svc.getBrands(q);
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

  onPoItemCategoryInput(index: number, value: string): void {
    if (value.trim().length < 1) {
      this.poItemCategorySuggestions[index] = [];
      this.showPoItemCategoryDropdown[index] = false;
      return;
    }
    setTimeout(() => void this.searchPoItemCategories(index, value), 250);
  }

  private async searchPoItemCategories(index: number, q: string): Promise<void> {
    try {
      const r = await this.svc.getCategories(q);
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
      }

      const r = await this.svc.createPO({
        supplierId: Number(this.poForm.supplierId),
        comments: this.poForm.comments || undefined,
        items: this.poItems.map((i) => {
          const item: PurchaseOrderItem = {
            itemName: i.itemName,
            quantity: Math.max(1, Math.round(i.quantity)),
            unitCost: Number(i.unitCost) || 0,
            brand: i.brand?.trim() || undefined,
            category: i.category?.trim() || undefined,
          };
          if (i.inventoryId) item.inventoryId = Number(i.inventoryId);
          if (i.variantId) item.variantId = Number(i.variantId);
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
  }

  closePODetail(): void {
    this.poDetail = null;
  }

  addPoDetailItem(): void {
    this.poDetail?.items?.push({ itemName: '', brand: '', category: '', quantity: 1, unitCost: 0 });
  }

  removePoDetailItem(index: number): void {
    if (this.poDetail?.items && this.poDetail.items.length > 1) {
      this.poDetail.items.splice(index, 1);
    }
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
      const r = await this.svc.updatePO(po.id, {
        comments: po.comments ?? undefined,
        items: po.items.map((i) => ({
          id: i.id,
          inventoryId: i.inventoryId ?? undefined,
          variantId: i.variantId ?? undefined,
          itemName: i.itemName || i.productName || '',
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
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error('Error', Array.isArray(msg) ? msg[0] : (msg ?? 'Unexpected error.'));
    }
  }

  async receivePO(id: number): Promise<void> {
    if (!confirm('Mark this PO as received and update stock?')) return;
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
    };
  }
}
