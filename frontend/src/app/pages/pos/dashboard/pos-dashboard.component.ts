import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CartLine,
  PosDiscount,
  PosProduct,
  PosService,
} from '../../../shared/services/pos.service';
import { OrgService } from '../../../shared/services/org.service';
import { NotificationService } from '../../../shared/services/notification.service';

@Component({
  selector: 'app-pos-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  cart: CartLine[] = [];
  cartOpen = true;
  isCheckingOut = false;

  showCheckoutModal = false;
  selectedDiscountId: number | null = null;
  amountReceived = 0;
  checkoutSuccess: { changeDue: number; totalAmount: number } | null = null;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly posService: PosService,
    private readonly orgService: OrgService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    this.orgName = this.orgService.getContext().name ?? 'POS';
    void this.loadCategories();
    void this.loadDiscounts();
    void this.loadProducts();
  }

  get selectedDiscount(): PosDiscount | null {
    if (!this.selectedDiscountId) return null;
    return this.discounts.find((d) => d.id === this.selectedDiscountId) ?? null;
  }

  async loadCategories(): Promise<void> {
    try {
      const response = await this.posService.getCategories();
      this.categories = response.data ?? [];
    } catch {
      this.categories = [];
    }
  }

  async loadDiscounts(): Promise<void> {
    try {
      const response = await this.posService.getDiscounts();
      this.discounts = response.data ?? [];
    } catch {
      this.discounts = [];
    }
  }

  async loadProducts(): Promise<void> {
    this.state = 'loading';
    this.errorMessage = '';
    try {
      const response = await this.posService.getProducts(
        this.search,
        this.selectedCategory || undefined,
      );
      if (!response.success || !response.data) {
        this.state = 'error';
        this.errorMessage = response.message ?? 'Failed to load products.';
        return;
      }
      this.products = response.data;
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

  addToCart(product: PosProduct): void {
    if (product.stockQty <= 0) {
      this.notify.warning('Out of stock', `${product.partName} is currently unavailable.`);
      return;
    }

    const existing = this.cart.find((line) => line.inventoryId === product.id);
    if (existing) {
      if (existing.quantity >= product.stockQty) {
        this.notify.warning('Stock limit', `Only ${product.stockQty} available for ${product.partName}.`);
        return;
      }
      existing.quantity += 1;
    } else {
      this.cart = [
        ...this.cart,
        {
          inventoryId: product.id,
          partName: product.partName,
          sellingPrice: product.sellingPrice,
          salePrice: product.salePrice,
          quantity: 1,
          stockQty: product.stockQty,
          imageUrl: product.imageUrl,
          unitType: product.unitType,
        },
      ];
    }
    this.cartOpen = true;
  }

  incrementLine(line: CartLine): void {
    if (line.quantity >= line.stockQty) {
      this.notify.warning('Stock limit', `Only ${line.stockQty} available.`);
      return;
    }
    line.quantity += 1;
  }

  decrementLine(line: CartLine): void {
    if (line.quantity <= 1) {
      this.removeLine(line);
      return;
    }
    line.quantity -= 1;
  }

  removeLine(line: CartLine): void {
    this.cart = this.cart.filter((item) => item.inventoryId !== line.inventoryId);
  }

  clearCart(): void {
    this.cart = [];
    this.selectedDiscountId = null;
  }

  cartCount(): number {
    return this.cart.reduce((sum, line) => sum + line.quantity, 0);
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
    return this.cart.reduce((sum, line) => sum + this.lineTotal(line), 0);
  }

  cartDiscountAmount(): number {
    const discount = this.selectedDiscount;
    const subtotal = this.cartSubtotal();
    if (!discount) return 0;

    if (discount.discountType === 'percent' || discount.discountType === 'fixed') {
      return this.posService.computeOrderDiscount(subtotal, discount);
    }

    const regular = this.cart.reduce(
      (sum, line) => sum + line.sellingPrice * line.quantity,
      0,
    );
    return Math.round((regular - subtotal) * 100) / 100;
  }

  cartTotal(): number {
    const subtotal = this.cartSubtotal();
    const discount = this.selectedDiscount;
    if (discount?.discountType === 'percent' || discount?.discountType === 'fixed') {
      return Math.round((subtotal - this.cartDiscountAmount()) * 100) / 100;
    }
    return subtotal;
  }

  changeDue(): number {
    const received = Number(this.amountReceived) || 0;
    return Math.round((received - this.cartTotal()) * 100) / 100;
  }

  canConfirmCheckout(): boolean {
    const received = Number(this.amountReceived) || 0;
    return received >= this.cartTotal() && this.cart.length > 0 && !this.isCheckingOut;
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
    this.amountReceived = this.cartSubtotal();
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
    this.amountReceived = this.cartTotal();
  }

  displayPrice(product: PosProduct): number {
    if (this.selectedDiscount?.discountType === 'auto_sale' && product.salePrice) {
      return product.salePrice;
    }
    return product.sellingPrice;
  }

  hasSalePrice(product: PosProduct): boolean {
    return product.salePrice != null && product.salePrice > 0 && product.salePrice < product.sellingPrice;
  }

  async confirmCheckout(): Promise<void> {
    if (!this.canConfirmCheckout() || this.isCheckingOut) return;

    this.isCheckingOut = true;
    try {
      const response = await this.posService.checkout({
        items: this.cart.map((line) => ({ inventoryId: line.inventoryId, quantity: line.quantity })),
        discountId: this.selectedDiscountId,
        amountPaid: Number(this.amountReceived) || 0,
      });

      if (!response.success || !response.data) {
        this.notify.error('Checkout failed', response.message ?? 'Unable to complete sale.');
        return;
      }

      this.checkoutSuccess = {
        changeDue: response.data.changeDue ?? this.changeDue(),
        totalAmount: response.data.totalAmount,
      };
      this.notify.success('Sale complete', `Change: ₱${this.formatCurrency(this.checkoutSuccess.changeDue)}`);
      this.cart = [];
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
    return unit;
  }

  discountLabel(d: PosDiscount): string {
    if (d.discountType === 'percent') return `${d.name} (${d.discountValue}%)`;
    if (d.discountType === 'auto_bulk') return `${d.name} (${d.discountValue}% off ${d.bulkMinQty}+)`;
    return d.name;
  }

  private syncCartStock(): void {
    this.cart = this.cart
      .map((line) => {
        const product = this.products.find((p) => p.id === line.inventoryId);
        if (!product) return null;
        const updated: CartLine = {
          ...line,
          stockQty: product.stockQty,
          sellingPrice: product.sellingPrice,
          salePrice: product.salePrice,
          quantity: Math.min(line.quantity, product.stockQty),
          unitType: product.unitType ?? line.unitType,
        };
        return updated;
      })
      .filter((line): line is CartLine => line !== null && line.quantity > 0);
  }
}
