import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogComponent } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import {
  CartLine,
  PosDiscount,
  PosPaymentMethod,
  PosProduct,
  PosService,
  PosVariant,
  PosVariantUnit,
} from '../../../shared/services/pos.service';
import { PosCartService } from '../../../shared/services/pos-cart.service';
import { OrgService } from '../../../shared/services/org.service';
import { NotificationService } from '../../../shared/services/notification.service';

@Component({
  selector: 'app-pos-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './pos-dashboard.component.html',
})
export class PosDashboardComponent implements OnInit {
  state: 'loading' | 'loaded' | 'error' = 'loading';
  errorMessage = '';
  orgName = 'POS';
  search = '';
  selectedCategory = '';
  categories: string[] = [];
  products: PosProduct[] = [];
  discounts: PosDiscount[] = [];
  paymentMethods: PosPaymentMethod[] = [];
  cart: CartLine[] = [];
  cartOpen = false;
  isCheckingOut = false;

  showVariantModal = false;
  selectedProduct: PosProduct | null = null;
  variants: PosVariant[] = [];
  variantsLoading = false;
  variantQty: Record<number, number> = {};
  variantSelectedUnit: Record<number, string> = {};
  variantSearch = '';

  showCheckoutModal = false;
  selectedDiscountId: number | null = null;
  selectedPaymentMethodId: number | null = null;
  amountReceived = 0;
  checkoutSuccess: { changeDue: number; totalAmount: number } | null = null;

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmVariant: 'primary' | 'danger' = 'primary';
  private confirmAction: (() => void) | null = null;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly posService: PosService,
    private readonly cartService: PosCartService,
    private readonly orgService: OrgService,
    private readonly notify: NotificationService,
  ) {}

  private orgId(): number {
    return this.orgService.getContext().id ?? 0;
  }

  private persistCart(): void {
    this.cartService.save(this.orgId(), this.cart);
    if (!this.cart.length) this.cartOpen = false;
  }

  ngOnInit(): void {
    this.orgName = this.orgService.getContext().name ?? 'POS';
    this.cart = this.cartService.load(this.orgId()).map((line) => ({
      ...line,
      cartKey: line.cartKey ?? this.cartService.cartKey(line.variantId, line.unitType ?? 'piece'),
      unitType: line.unitType ?? 'piece',
    }));
    this.cartOpen = this.cart.length > 0;
    void this.loadCategories();
    void this.loadDiscounts();
    void this.loadPaymentMethods();
    void this.loadProducts();
  }

  get selectedDiscount(): PosDiscount | null {
    if (!this.selectedDiscountId) return null;
    return this.discounts.find((d) => d.id === this.selectedDiscountId) ?? null;
  }

  async loadCategories(): Promise<void> {
    try {
      const r = await this.posService.getCategories();
      this.categories = r.data ?? [];
    } catch {
      this.categories = [];
    }
  }

  async loadDiscounts(): Promise<void> {
    try {
      const r = await this.posService.getDiscounts();
      this.discounts = (r.data ?? []).filter((d) => d.discountType !== 'auto_sale');
    } catch {
      this.discounts = [];
    }
  }

  async loadPaymentMethods(): Promise<void> {
    try {
      const r = await this.posService.getPaymentMethods();
      this.paymentMethods = r.data ?? [];
      if (this.paymentMethods.length) {
        this.selectedPaymentMethodId = this.paymentMethods.find((m) => m.code === 'cash')?.id ?? this.paymentMethods[0].id;
      }
    } catch {
      this.paymentMethods = [];
    }
  }

  async loadProducts(): Promise<void> {
    this.state = 'loading';
    this.errorMessage = '';
    try {
      const r = await this.posService.getProducts(this.search, this.selectedCategory || undefined);
      if (!r.success || !r.data) {
        this.state = 'error';
        this.errorMessage = r.message ?? 'Failed to load products.';
        return;
      }
      this.products = r.data;
      this.syncCartStock();
      this.state = 'loaded';
    } catch {
      this.state = 'error';
      this.errorMessage = 'Failed to load products. Please try again.';
    }
  }

  onSearchInput(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadProducts(), 300);
  }

  onCategoryChange(): void {
    void this.loadProducts();
  }

  clearSearch(): void {
    this.search = '';
    void this.loadProducts();
  }

  clearCategory(): void {
    this.selectedCategory = '';
    void this.loadProducts();
  }

  async openProduct(product: PosProduct): Promise<void> {
    if (product.totalStock <= 0) {
      this.notify.warning('Out of stock', `${product.name} is currently unavailable.`);
      return;
    }
    this.selectedProduct = product;
    this.showVariantModal = true;
    this.variantsLoading = true;
    this.variantQty = {};
    this.variantSelectedUnit = {};
    this.variantSearch = '';
    try {
      const r = await this.posService.getVariants(product.id);
      this.variants = (r.data ?? []).map((v) => ({
        ...v,
        units: v.units?.length ? v.units : [{
          unitType: v.unitType ?? 'piece',
          sellingPrice: v.sellingPrice,
          salePrice: v.salePrice,
          isManualEntry: v.unitType === 'manual',
        }],
      }));
      for (const v of this.variants) {
        this.variantQty[v.id] = this.defaultVariantQty(v);
        this.variantSelectedUnit[v.id] = v.units[0]?.unitType ?? 'piece';
      }
    } catch {
      this.variants = [];
    } finally {
      this.variantsLoading = false;
    }
  }

  closeVariantModal(): void {
    this.showVariantModal = false;
    this.selectedProduct = null;
    this.variants = [];
    this.variantSearch = '';
  }

  get filteredModalVariants(): PosVariant[] {
    const q = this.variantSearch.trim().toLowerCase();
    if (!q) return this.variants;
    return this.variants.filter(
      (v) =>
        v.variantName.toLowerCase().includes(q) ||
        v.productName.toLowerCase().includes(q),
    );
  }

  selectedUnitFor(variant: PosVariant): PosVariantUnit {
    const key = this.variantSelectedUnit[variant.id] ?? variant.units[0]?.unitType ?? 'piece';
    return (
      variant.units.find((u) => u.unitType === key) ??
      variant.units[0] ?? {
        unitType: 'piece',
        sellingPrice: variant.sellingPrice,
        salePrice: variant.salePrice,
        isManualEntry: false,
      }
    );
  }

  onVariantUnitChange(variant: PosVariant): void {
    const unit = this.selectedUnitFor(variant);
    this.variantQty[variant.id] = unit.isManualEntry ? 100 : 1;
  }

  addVariantToCart(variant: PosVariant): void {
    const unit = this.selectedUnitFor(variant);
    const isManual = unit.isManualEntry;
    const rawQty = Number(this.variantQty[variant.id]) || 0;
    const qty = isManual
      ? Math.round(Math.max(0.01, rawQty) * 1000) / 1000
      : Math.max(1, Math.floor(rawQty));
    if (variant.stockQty <= 0) {
      this.notify.warning('Out of stock', `${variant.variantName} is unavailable.`);
      return;
    }
    if (qty > variant.stockQty) {
      this.notify.warning('Stock limit', `Only ${variant.stockQty} ${this.unitLabel(unit.unitType)} available.`);
      return;
    }

    const cartKey = this.cartService.cartKey(variant.id, unit.unitType);
    const existing = this.cart.find((l) => l.cartKey === cartKey);
    const imageUrl = variant.imageUrl ?? variant.productImageUrl ?? this.selectedProduct?.imageUrl ?? null;
    if (existing) {
      if (existing.quantity + qty > variant.stockQty) {
        this.notify.warning('Stock limit', `Only ${variant.stockQty} ${this.unitLabel(unit.unitType)} available.`);
        return;
      }
      existing.quantity = Math.round((existing.quantity + qty) * 1000) / 1000;
      existing.sellingPrice = unit.sellingPrice;
      existing.salePrice = unit.salePrice;
    } else {
      this.cart = [
        ...this.cart,
        {
          cartKey,
          variantId: variant.id,
          productName: variant.productName,
          variantName: variant.variantName,
          sellingPrice: unit.sellingPrice,
          salePrice: unit.salePrice,
          quantity: qty,
          stockQty: variant.stockQty,
          imageUrl,
          unitType: unit.unitType,
          isManualEntry: unit.isManualEntry,
        },
      ];
    }
    this.persistCart();
    this.cartOpen = true;
    this.notify.success('Added', `${variant.variantName} added to cart.`);
  }

  incrementLine(line: CartLine): void {
    const step = line.isManualEntry ? 10 : 1;
    if (line.quantity + step > line.stockQty) {
      this.notify.warning('Stock limit', `Only ${line.stockQty} ${this.unitLabel(line.unitType)} available.`);
      return;
    }
    line.quantity = Math.round((line.quantity + step) * 1000) / 1000;
    this.persistCart();
  }

  decrementLine(line: CartLine): void {
    const step = line.isManualEntry ? 10 : 1;
    const minQty = line.isManualEntry ? 0.01 : 1;
    if (line.quantity <= minQty) {
      this.requestRemoveLine(line);
      return;
    }
    line.quantity = Math.round(Math.max(minQty, line.quantity - step) * 1000) / 1000;
    this.persistCart();
  }

  requestRemoveLine(line: CartLine): void {
    this.openConfirm('Remove item?', `Remove ${line.variantName} from cart?`, () => {
      this.cart = this.cart.filter((l) => l.cartKey !== line.cartKey);
      this.persistCart();
    });
  }

  requestClearCart(): void {
    if (!this.cart.length) return;
    this.openConfirm('Clear cart?', 'Remove all items from the cart?', () => {
      this.cart = [];
      this.selectedDiscountId = null;
      this.cartService.clear(this.orgId());
      this.cartOpen = false;
    }, 'danger');
  }

  cartCount(): number {
    return this.cart.length;
  }

  cartRegularSubtotal(): number {
    return this.cart.reduce((sum, line) => sum + line.sellingPrice * line.quantity, 0);
  }

  lineUnitPrice(line: CartLine): number {
    return this.posService.computeLineUnitPrice(
      line.sellingPrice,
      line.salePrice,
      this.selectedDiscount,
      line.quantity,
    );
  }

  lineTotal(line: CartLine): number {
    return Math.round(this.lineUnitPrice(line) * line.quantity * 100) / 100;
  }

  cartSubtotal(): number {
    return Math.round(this.cart.reduce((sum, line) => sum + this.lineTotal(line), 0) * 100) / 100;
  }

  cartSaleSavings(): number {
    const atSale = this.cart.reduce((sum, line) => {
      const unit = this.posService.effectiveUnitPrice(line.sellingPrice, line.salePrice);
      return sum + unit * line.quantity;
    }, 0);
    return Math.round((this.cartRegularSubtotal() - atSale) * 100) / 100;
  }

  cartOrderDiscount(): number {
    const discount = this.selectedDiscount;
    if (!discount || (discount.discountType !== 'percent' && discount.discountType !== 'fixed')) {
      return 0;
    }
    return this.posService.computeOrderDiscount(this.cartSubtotal(), discount);
  }

  cartDiscountAmount(): number {
    const discount = this.selectedDiscount;
    if (discount?.discountType === 'percent' || discount?.discountType === 'fixed') {
      return Math.round((this.cartSaleSavings() + this.cartOrderDiscount()) * 100) / 100;
    }
    return Math.round((this.cartRegularSubtotal() - this.cartSubtotal()) * 100) / 100;
  }

  cartTotal(): number {
    return Math.round((this.cartSubtotal() - this.cartOrderDiscount()) * 100) / 100;
  }

  changeDue(): number {
    const received = Number(this.amountReceived) || 0;
    return Math.round((received - this.cartTotal()) * 100) / 100;
  }

  canConfirmCheckout(): boolean {
    const received = Number(this.amountReceived) || 0;
    return (
      received >= this.cartTotal() &&
      this.cart.length > 0 &&
      !this.isCheckingOut &&
      !!this.selectedPaymentMethodId
    );
  }

  toggleCart(): void {
    this.cartOpen = !this.cartOpen;
  }

  openCheckoutModal(): void {
    if (this.cart.length === 0) {
      this.notify.warning('Empty cart', 'Add products before checking out.');
      return;
    }
    this.selectedDiscountId = null;
    this.amountReceived = 0;
    this.checkoutSuccess = null;
    this.showCheckoutModal = true;
  }

  closeCheckoutModal(): void {
    if (!this.isCheckingOut) {
      this.showCheckoutModal = false;
      this.checkoutSuccess = null;
    }
  }

  onDiscountChange(): void {
    // Keep amount received as cashier entered; do not auto-fill.
  }

  displayPrice(product: PosProduct): { price: number; original?: number } {
    if (product.hasSale && product.minSalePrice != null) {
      return { price: product.minSalePrice, original: product.minPrice };
    }
    return { price: product.minPrice };
  }

  hasSalePrice(line: CartLine): boolean {
    return line.salePrice != null && line.salePrice > 0 && line.salePrice < line.sellingPrice;
  }

  requestConfirmCheckout(): void {
    this.openConfirm(
      'Complete sale?',
      `Confirm sale for ₱${this.formatCurrency(this.cartTotal())}?`,
      () => void this.confirmCheckout(),
    );
  }

  async confirmCheckout(): Promise<void> {
    if (!this.canConfirmCheckout() || this.isCheckingOut) return;
    this.isCheckingOut = true;
    try {
      const r = await this.posService.checkout({
        items: this.cart.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unitType: line.unitType,
        })),
        discountId: this.selectedDiscountId,
        amountPaid: Number(this.amountReceived) || 0,
        paymentMethodId: this.selectedPaymentMethodId,
      });
      if (!r.success || !r.data) {
        this.notify.error('Checkout failed', r.message ?? 'Unable to complete sale.');
        return;
      }
      this.checkoutSuccess = {
        changeDue: r.data.changeDue ?? this.changeDue(),
        totalAmount: r.data.totalAmount,
      };
      this.notify.success('Sale complete', `Change: ₱${this.formatCurrency(this.checkoutSuccess.changeDue)}`);
      this.cart = [];
      this.cartService.clear(this.orgId());
      this.cartOpen = false;
      this.selectedDiscountId = null;
      this.amountReceived = 0;
      await this.loadProducts();
      setTimeout(() => {
        this.showCheckoutModal = false;
        this.checkoutSuccess = null;
      }, 2500);
    } catch {
      this.notify.error('Error', 'Checkout failed. Please try again.');
    } finally {
      this.isCheckingOut = false;
    }
  }

  formatCurrency(value: number): string {
    return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  productImage(product: PosProduct): string | null {
    return product.imageUrl ?? null;
  }

  unitLabel(unit?: string | null): string {
    if (!unit) return 'pc';
    if (unit === 'manual') return 'g';
    return unit;
  }

  isManualUnit(unit?: string | null): boolean {
    return unit === 'manual';
  }

  defaultVariantQty(variant: PosVariant): number {
    const unit = this.selectedUnitFor(variant);
    return unit.isManualEntry ? 100 : 1;
  }

  variantQtyLabel(variant: PosVariant): string {
    const unit = this.selectedUnitFor(variant);
    if (unit.isManualEntry) return this.manualQtyLabel(unit.unitType);
    return this.unitLabel(unit.unitType);
  }

  manualQtyLabel(unitType: string): string {
    if (unitType === 'manual' || unitType === 'grams') return 'Grams';
    if (unitType === 'kilo') return 'Kilos';
    return 'Quantity';
  }

  formatQuantityWithUnit(line: CartLine): string {
    const qty = line.quantity % 1 === 0 ? String(line.quantity) : line.quantity.toFixed(2);
    return `${qty} ${this.unitLabel(line.unitType)}`;
  }

  variantPriceLabel(variant: PosVariant): string {
    const unit = this.selectedUnitFor(variant);
    if (unit.isManualEntry || unit.unitType === 'grams') return '/ g';
    if (unit.unitType === 'kilo') return '/ kilo';
    return '';
  }

  variantImage(variant: PosVariant): string | null {
    return variant.imageUrl ?? variant.productImageUrl ?? this.selectedProduct?.imageUrl ?? null;
  }

  unitOptionLabel(unitType: string, isManualEntry: boolean): string {
    if (isManualEntry) return `${unitType} (enter qty)`;
    return unitType;
  }

  discountLabel(d: PosDiscount): string {
    if (d.discountType === 'percent') return `${d.name} (${d.discountValue}%)`;
    if (d.discountType === 'auto_bulk') return `${d.name} (${d.discountValue}% off ${d.bulkMinQty}+)`;
    return d.name;
  }

  paymentMethodLabel(m: PosPaymentMethod): string {
    return m.name;
  }

  openConfirm(title: string, message: string, action: () => void, dialogVariant: 'primary' | 'danger' = 'primary'): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.confirmVariant = dialogVariant;
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

  private syncCartStock(): void {
    for (const line of this.cart) {
      const product = this.products.find((p) => p.name === line.productName);
      if (product) {
        line.stockQty = product.totalStock;
      }
    }
  }
}
