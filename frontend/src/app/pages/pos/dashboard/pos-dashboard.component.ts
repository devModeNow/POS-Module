import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CartLine, PosProduct, PosService } from '../../../shared/services/pos.service';
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
  products: PosProduct[] = [];
  cart: CartLine[] = [];
  cartOpen = true;
  isCheckingOut = false;

  showCheckoutModal = false;
  discountAmount = 0;
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
    void this.loadProducts();
  }

  async loadProducts(): Promise<void> {
    this.state = 'loading';
    this.errorMessage = '';
    try {
      const response = await this.posService.getProducts(this.search);
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

  clearSearch(): void {
    this.search = '';
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
    this.discountAmount = 0;
  }

  cartCount(): number {
    return this.cart.reduce((sum, line) => sum + line.quantity, 0);
  }

  cartSubtotal(): number {
    return this.cart.reduce((sum, line) => sum + line.sellingPrice * line.quantity, 0);
  }

  cartTotal(): number {
    const discount = Math.min(Math.max(0, this.discountAmount || 0), this.cartSubtotal());
    return Math.round((this.cartSubtotal() - discount) * 100) / 100;
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
    this.discountAmount = 0;
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

  async confirmCheckout(): Promise<void> {
    if (!this.canConfirmCheckout() || this.isCheckingOut) return;

    this.isCheckingOut = true;
    try {
      const response = await this.posService.checkout({
        items: this.cart.map((line) => ({ inventoryId: line.inventoryId, quantity: line.quantity })),
        discountAmount: Math.min(Math.max(0, this.discountAmount || 0), this.cartSubtotal()),
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
      this.discountAmount = 0;
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

  private syncCartStock(): void {
    this.cart = this.cart
      .map((line) => {
        const product = this.products.find((p) => p.id === line.inventoryId);
        if (!product) return null;
        const updated: CartLine = {
          ...line,
          stockQty: product.stockQty,
          sellingPrice: product.sellingPrice,
          quantity: Math.min(line.quantity, product.stockQty),
          unitType: product.unitType ?? line.unitType,
        };
        return updated;
      })
      .filter((line): line is CartLine => line !== null && line.quantity > 0);
  }
}
