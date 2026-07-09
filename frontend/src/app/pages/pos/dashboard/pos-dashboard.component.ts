import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
import { RbacService } from '../../../shared/services/rbac.service';
import { AuthService } from '../../../shared/services/auth.service';
import { BusinessSettingsService } from '../../../shared/services/business-settings.service';
import { ActionBusyService } from '../../../shared/services/action-busy.service';
import { GlobalActionLoaderComponent } from '../../../shared/components/common/global-action-loader/global-action-loader.component';

@Component({
  selector: 'app-pos-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, RouterLink, GlobalActionLoaderComponent],
  templateUrl: './pos-dashboard.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosDashboardComponent implements OnInit {
  state: 'loading' | 'loaded' | 'error' = 'loading';
  catalogLoading = false;
  errorMessage = '';
  orgName = 'POS';
  companyName = '';
  cashierName = '';
  search = '';
  searchFocused = false;
  selectedCategory = '';
  categories: string[] = [];
  products: PosProduct[] = [];
  variantCatalog: PosVariant[] = [];
  catalogMode: 'types' | 'variants' = 'types';
  productViewMode: 'grid' | 'list' = 'grid';
  readonly isCashierMode: boolean;
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

  showCartUnitModal = false;
  editingCartLine: CartLine | null = null;
  editCartUnit = '';
  editCartQty = 1;
  cartEditUnits: PosVariantUnit[] = [];
  cartEditUnitsLoading = false;

  showCheckoutModal = false;
  showVoidModal = false;
  voidingLine: CartLine | null = null;
  voidAdminCode = '';
  voidReason = '';
  isVoiding = false;
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

  @ViewChild('amountReceivedInput') amountReceivedInput?: ElementRef<HTMLInputElement>;

  constructor(
    private readonly posService: PosService,
    private readonly cartService: PosCartService,
    private readonly orgService: OrgService,
    private readonly notify: NotificationService,
    private readonly rbac: RbacService,
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly businessSettings: BusinessSettingsService,
    private readonly actionBusy: ActionBusyService,
  ) {
    this.isCashierMode = this.rbac.isCashier();
  }

  get useCategoryDropdown(): boolean {
    return this.categories.length > 5;
  }

  get isVariantCatalogView(): boolean {
    return this.catalogMode === 'variants' || this.search.trim().length > 0;
  }

  get searchSuggestions(): Array<{
    kind: 'product' | 'variant';
    id: number;
    label: string;
    sub?: string;
    imageUrl?: string | null;
    stock?: number;
    priceLabel?: string;
  }> {
    const q = this.search.trim();
    if (!q || this.catalogLoading) return [];
    if (this.isVariantCatalogView) {
      return this.variantCatalog.slice(0, 8).map((v) => ({
        kind: 'variant' as const,
        id: v.id,
        label: v.variantName,
        sub: v.productName,
        imageUrl: v.imageUrl ?? v.productImageUrl,
        stock: v.stockQty,
        priceLabel: v.salePrice && v.salePrice < v.sellingPrice
          ? `₱${v.salePrice.toFixed(2)}`
          : `₱${v.sellingPrice.toFixed(2)}`,
      }));
    }
    return this.products.slice(0, 8).map((p) => ({
      kind: 'product' as const,
      id: p.id,
      label: p.name,
      sub: p.category ?? undefined,
      imageUrl: p.imageUrl,
      stock: p.totalStock,
      priceLabel: p.hasSale && p.minSalePrice
        ? `₱${p.minSalePrice.toFixed(2)}`
        : `₱${p.minPrice.toFixed(2)}`,
    }));
  }

  pickSearchSuggestion(item: { kind: 'product' | 'variant'; id: number }): void {
    if (item.kind === 'product') {
      const product = this.products.find((p) => p.id === item.id);
      if (product) void this.openProduct(product);
    } else {
      const variant = this.variantCatalog.find((v) => v.id === item.id);
      if (variant) void this.openVariantFromCatalog(variant);
    }
    this.search = '';
    this.searchFocused = false;
    void this.loadCatalog();
  }

  private orgId(): number {
    return this.orgService.getContext().id ?? 0;
  }

  private persistCart(): void {
    this.cartService.save(this.orgId(), this.cart);
    if (!this.cart.length) this.cartOpen = false;
  }

  ngOnInit(): void {
    this.orgName = this.orgService.getContext().name ?? 'POS';
    this.cashierName = this.rbac.getDisplayName();
    void this.loadCompanyName();
    void this.posService.staffHeartbeat();
    setInterval(() => void this.posService.staffHeartbeat(), 5 * 60 * 1000);
    const savedView = sessionStorage.getItem('posProductViewMode');
    if (savedView === 'grid' || savedView === 'list') {
      this.productViewMode = savedView;
    }
    const savedCatalog = sessionStorage.getItem('posCatalogMode');
    if (savedCatalog === 'types' || savedCatalog === 'variants') {
      this.catalogMode = savedCatalog;
    }
    this.cart = this.cartService.load(this.orgId()).map((line) => ({
      ...line,
      cartKey: line.cartKey ?? this.cartService.cartKey(line.variantId, line.unitType ?? 'piece'),
      unitType: line.unitType ?? 'piece',
    }));
    this.cartOpen = this.cart.length > 0;
    void this.loadCategories();
    void this.loadDiscounts();
    void this.loadPaymentMethods();
    void this.loadCatalog();
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

  async loadCatalog(): Promise<void> {
    if (this.isVariantCatalogView) {
      await this.loadVariantCatalog();
    } else {
      await this.loadProducts();
    }
  }

  async loadCompanyName(): Promise<void> {
    try {
      const profile = await this.businessSettings.getBusinessProfile();
      this.companyName = String(profile?.businessName ?? this.orgName).trim() || this.orgName;
    } catch {
      this.companyName = this.orgName;
    }
  }

  async loadProducts(): Promise<void> {
    const isInitial = this.state !== 'loaded';
    if (isInitial) this.state = 'loading';
    else this.catalogLoading = true;
    this.errorMessage = '';
    try {
      const r = await this.posService.getProducts(this.search, this.selectedCategory || undefined);
      if (!r.success || !r.data) {
        this.state = 'error';
        this.errorMessage = r.message ?? 'Failed to load products.';
        return;
      }
      this.products = r.data;
      this.variantCatalog = [];
      this.syncCartStock();
      this.state = 'loaded';
    } catch {
      this.state = 'error';
      this.errorMessage = 'Failed to load products. Please try again.';
    } finally {
      this.catalogLoading = false;
    }
  }

  async loadVariantCatalog(): Promise<void> {
    const isInitial = this.state !== 'loaded';
    if (isInitial) this.state = 'loading';
    else this.catalogLoading = true;
    this.errorMessage = '';
    try {
      const r = await this.posService.getVariantsCatalog(this.search, this.selectedCategory || undefined);
      if (!r.success || !r.data) {
        this.state = 'error';
        this.errorMessage = r.message ?? 'Failed to load variants.';
        return;
      }
      this.variantCatalog = (r.data ?? []).map((v) => this.normalizeVariant(v));
      this.products = [];
      this.syncCartStock();
      this.state = 'loaded';
    } catch {
      this.state = 'error';
      this.errorMessage = 'Failed to load variants. Please try again.';
    } finally {
      this.catalogLoading = false;
    }
  }

  onSearchInput(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadCatalog(), 300);
  }

  onSearchBlur(): void {
    setTimeout(() => { this.searchFocused = false; }, 150);
  }

  onCategoryChange(): void {
    void this.loadCatalog();
  }

  clearSearch(): void {
    this.search = '';
    void this.loadCatalog();
  }

  clearCategory(): void {
    this.selectedCategory = '';
    void this.loadCatalog();
  }

  setCatalogMode(mode: 'types' | 'variants'): void {
    this.catalogMode = mode;
    sessionStorage.setItem('posCatalogMode', mode);
    void this.loadCatalog();
  }

  setProductViewMode(mode: 'grid' | 'list'): void {
    this.productViewMode = mode;
    sessionStorage.setItem('posProductViewMode', mode);
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
      this.variants = (r.data ?? []).map((v) => this.normalizeVariant(v));
      this.initVariantModalState();
    } catch {
      this.variants = [];
    } finally {
      this.variantsLoading = false;
    }
  }

  async openVariantFromCatalog(variant: PosVariant): Promise<void> {
    if (variant.stockQty <= 0) {
      this.notify.warning('Out of stock', `${variant.variantName} is unavailable.`);
      return;
    }
    let full = variant;
    if (!variant.units?.length) {
      try {
        const r = await this.posService.getVariants(variant.productId);
        full = (r.data ?? []).find((v) => v.id === variant.id) ?? variant;
      } catch {
        full = variant;
      }
    }
    full = this.normalizeVariant(full);
    this.selectedProduct = {
      id: variant.productId,
      name: variant.productName,
      category: variant.category,
      imageUrl: variant.productImageUrl ?? null,
      variantCount: 1,
      minPrice: full.sellingPrice,
      maxPrice: full.sellingPrice,
      minSalePrice: full.salePrice ?? null,
      totalStock: variant.stockQty,
      hasSale: full.salePrice != null && full.salePrice > 0 && full.salePrice < full.sellingPrice,
      inStock: variant.stockQty > 0,
    };
    this.variants = [full];
    this.showVariantModal = true;
    this.variantsLoading = false;
    this.variantSearch = '';
    this.initVariantModalState();
  }

  private normalizeVariant(v: PosVariant): PosVariant {
    return {
      ...v,
      units: v.units?.length ? v.units : [{
        unitType: v.unitType === 'manual' ? 'grams' : (v.unitType ?? 'piece'),
        sellingPrice: v.sellingPrice,
        salePrice: v.salePrice,
        isManualEntry: v.unitType === 'manual' || v.unitType === 'grams',
      }],
    };
  }

  private initVariantModalState(): void {
    this.variantQty = {};
    this.variantSelectedUnit = {};
    for (const v of this.variants) {
      this.variantQty[v.id] = this.defaultVariantQty(v);
      this.variantSelectedUnit[v.id] = this.defaultUnitType(v);
    }
  }

  private defaultUnitType(variant: PosVariant): string {
    return variant.units.find((u) => u.isDefault)?.unitType ?? variant.units[0]?.unitType ?? 'piece';
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

  incrementVariantQty(variant: PosVariant): void {
    const unit = this.selectedUnitFor(variant);
    const step = unit.isManualEntry ? 10 : 1;
    const current = Number(this.variantQty[variant.id]) || 0;
    const next = Math.round((current + step) * 1000) / 1000;
    if (next > variant.stockQty) {
      this.notify.warning('Stock limit', `Only ${variant.stockQty} ${this.unitLabel(unit.unitType)} available.`);
      return;
    }
    this.variantQty[variant.id] = next;
  }

  decrementVariantQty(variant: PosVariant): void {
    const unit = this.selectedUnitFor(variant);
    const step = unit.isManualEntry ? 10 : 1;
    const minQty = unit.isManualEntry ? 0.01 : 1;
    const current = Number(this.variantQty[variant.id]) || minQty;
    this.variantQty[variant.id] = Math.max(minQty, Math.round((current - step) * 1000) / 1000);
  }

  async logout(): Promise<void> {
    this.auth.logout();
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }

  requestLogout(): void {
    this.openConfirm(
      'Sign out?',
      'Are you sure you want to log out of the POS?',
      () => void this.logout(),
      'danger',
    );
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
          productId: variant.productId,
          productName: variant.productName,
          variantName: variant.variantName,
          sellingPrice: unit.sellingPrice,
          salePrice: unit.salePrice,
          quantity: qty,
          stockQty: variant.stockQty,
          imageUrl,
          unitType: unit.unitType,
          isManualEntry: unit.isManualEntry,
          units: variant.units,
        },
      ];
    }
    this.persistCart();
    this.cartOpen = true;
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

  async openCartUnitEdit(line: CartLine): Promise<void> {
    this.editingCartLine = line;
    this.editCartUnit = line.unitType;
    this.editCartQty = line.quantity;
    this.showCartUnitModal = true;
    if (line.units?.length) {
      this.cartEditUnits = line.units;
      setTimeout(() => this.focusCartEditQty(), 0);
      return;
    }
    this.cartEditUnitsLoading = true;
    try {
      const productId = line.productId;
      if (!productId) {
        this.notify.warning('Unable to edit', 'Unit options are not available for this item.');
        this.closeCartUnitEdit();
        return;
      }
      const r = await this.posService.getVariants(productId);
      const variant = (r.data ?? []).find((v) => v.id === line.variantId);
      if (!variant?.units?.length) {
        this.notify.warning('Unable to edit', 'No unit options found.');
        this.closeCartUnitEdit();
        return;
      }
      line.units = variant.units;
      line.productId = variant.productId;
      this.cartEditUnits = variant.units;
      setTimeout(() => this.focusCartEditQty(), 0);
    } catch {
      this.notify.error('Error', 'Could not load unit options.');
      this.closeCartUnitEdit();
    } finally {
      this.cartEditUnitsLoading = false;
    }
  }

  closeCartUnitEdit(): void {
    this.showCartUnitModal = false;
    this.editingCartLine = null;
    this.editCartUnit = '';
    this.editCartQty = 1;
    this.cartEditUnits = [];
    this.cartEditUnitsLoading = false;
  }

  selectedCartEditUnit(): PosVariantUnit | null {
    return this.cartEditUnits.find((u) => u.unitType === this.editCartUnit) ?? null;
  }

  cartEditQtyLabel(): string {
    const unit = this.selectedCartEditUnit();
    if (!unit) return 'Quantity';
    if (unit.isManualEntry) return this.manualQtyLabel(unit.unitType);
    return this.unitLabel(unit.unitType);
  }

  onCartEditUnitChange(): void {
    const unit = this.selectedCartEditUnit();
    if (!unit) return;
    this.editCartQty = unit.isManualEntry ? 100 : 1;
    setTimeout(() => this.focusCartEditQty(), 0);
  }

  applyCartUnitEdit(): void {
    const line = this.editingCartLine;
    if (!line) return;
    const unit = this.selectedCartEditUnit();
    if (!unit) return;

    const isManual = unit.isManualEntry;
    const rawQty = Number(this.editCartQty) || 0;
    const qty = isManual
      ? Math.round(Math.max(0.01, rawQty) * 1000) / 1000
      : Math.max(1, Math.floor(rawQty));

    if (rawQty <= 0) {
      this.notify.warning('Invalid quantity', 'Enter a valid quantity.');
      return;
    }
    if (qty > line.stockQty) {
      this.notify.warning('Stock limit', `Only ${line.stockQty} ${this.unitLabel(unit.unitType)} available.`);
      return;
    }

    const newKey = this.cartService.cartKey(line.variantId, unit.unitType);
    const unitChanged = unit.unitType !== line.unitType;
    const qtyChanged = qty !== line.quantity;

    if (!unitChanged && !qtyChanged) {
      this.closeCartUnitEdit();
      return;
    }

    if (unitChanged && newKey !== line.cartKey) {
      const existing = this.cart.find((l) => l.cartKey === newKey);
      if (existing) {
        const combined = Math.round((existing.quantity + qty) * 1000) / 1000;
        if (combined > line.stockQty) {
          this.notify.warning('Stock limit', `Only ${line.stockQty} ${this.unitLabel(unit.unitType)} available.`);
          return;
        }
        existing.quantity = combined;
        existing.sellingPrice = unit.sellingPrice;
        existing.salePrice = unit.salePrice;
        existing.isManualEntry = unit.isManualEntry;
        existing.units = line.units;
        this.cart = this.cart.filter((l) => l.cartKey !== line.cartKey);
      } else {
        line.cartKey = newKey;
        line.unitType = unit.unitType;
        line.sellingPrice = unit.sellingPrice;
        line.salePrice = unit.salePrice;
        line.isManualEntry = unit.isManualEntry;
        line.quantity = qty;
      }
    } else {
      line.quantity = qty;
      if (unitChanged) {
        line.cartKey = newKey;
        line.unitType = unit.unitType;
        line.sellingPrice = unit.sellingPrice;
        line.salePrice = unit.salePrice;
        line.isManualEntry = unit.isManualEntry;
      }
    }

    this.persistCart();
    this.closeCartUnitEdit();
  }

  private focusCartEditQty(): void {
    const el = document.getElementById('cart-edit-qty') as HTMLInputElement | null;
    el?.focus();
    el?.select();
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
      await this.actionBusy.run('pos-checkout', async () => {
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
        await this.loadCatalog();
        setTimeout(() => {
          this.showCheckoutModal = false;
          this.checkoutSuccess = null;
        }, 2500);
      });
    } catch {
      this.notify.error('Error', 'Checkout failed. Please try again.');
    } finally {
      this.isCheckingOut = false;
    }
  }

  formatCurrency(value: number): string {
    return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatStock(value: number): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('en-PH', { maximumFractionDigits: 3 });
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

  openVoidLine(line: CartLine): void {
    this.voidingLine = line;
    this.voidAdminCode = '';
    this.voidReason = '';
    this.showVoidModal = true;
  }

  closeVoidModal(): void {
    this.showVoidModal = false;
    this.voidingLine = null;
  }

  async confirmVoidLine(): Promise<void> {
    if (!this.voidingLine || !this.voidAdminCode.trim()) {
      this.notify.warning('Required', 'Enter the admin void code.');
      return;
    }
    this.isVoiding = true;
    try {
      await this.actionBusy.run('pos-void', async () => {
        const r = await this.posService.voidCartLine({
          cartKey: this.voidingLine!.cartKey,
          adminCode: this.voidAdminCode.trim(),
          reason: this.voidReason.trim() || undefined,
        });
        if (!r.success) {
          this.notify.error('Void failed', r.message ?? 'Invalid admin code');
          return;
        }
        const key = this.voidingLine!.cartKey;
        this.cart = this.cart.filter((l) => l.cartKey !== key);
        this.persistCart();
        this.notify.success('Voided', 'Item removed from cart.');
        this.closeVoidModal();
      });
    } finally {
      this.isVoiding = false;
    }
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

  variantHasSale(variant: PosVariant): boolean {
    return variant.salePrice != null && variant.salePrice > 0 && variant.salePrice < variant.sellingPrice;
  }

  catalogVariantImage(variant: PosVariant): string | null {
    return variant.imageUrl ?? variant.productImageUrl ?? null;
  }

  private syncCartStock(): void {
    for (const line of this.cart) {
      const variant = this.variantCatalog.find((v) => v.id === line.variantId);
      if (variant) {
        line.stockQty = variant.stockQty;
        continue;
      }
      const product = this.products.find((p) => p.name === line.productName);
      if (product) {
        line.stockQty = product.totalStock;
      }
    }
  }
}
