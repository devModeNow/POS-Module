import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ConfirmDialogComponent } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import {
  CartLine,
  PosDiscount,
  PosPaymentMethod,
  PosProduct,
  PosService,
  PosSubVariant,
  PosVariant,
  PosQtyPrice,
  PosVariantUnit,
} from '../../../shared/services/pos.service';
import { PosCartService } from '../../../shared/services/pos-cart.service';
import { OrgService } from '../../../shared/services/org.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { RbacService } from '../../../shared/services/rbac.service';
import { ActionBusyService } from '../../../shared/services/action-busy.service';
import { GlobalActionLoaderComponent } from '../../../shared/components/common/global-action-loader/global-action-loader.component';
import { PosOfflineService } from '../../../shared/services/pos-offline.service';
import { PosReceiptPrintService } from '../../../shared/services/pos-receipt-print.service';
import { PosCommunicationsService } from '../../../shared/services/pos-communications.service';
import { PosPageHeaderComponent } from '../shared/pos-page-header.component';
import {
  formatWeightStock,
  isRetailSellUnit,
  stockQtyToSellUnits,
  tracksStockInGrams,
} from '../../../shared/utils/weight-stock.util';
import { PosBarcodeScannerService } from '../../../shared/services/pos-barcode-scanner.service';

@Component({
  selector: 'app-pos-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, GlobalActionLoaderComponent, PosPageHeaderComponent],
  templateUrl: './pos-dashboard.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosDashboardComponent implements OnInit, OnDestroy {
  state: 'loading' | 'loaded' | 'error' = 'loading';
  catalogLoading = false;
  errorMessage = '';
  orgName = 'POS';
  search = '';
  searchFocused = false;
  selectedCategory = '';
  categories: string[] = [];
  products: PosProduct[] = [];
  variantCatalog: PosVariant[] = [];
  catalogMode: 'types' | 'variants' = 'variants';
  productViewMode: 'grid' | 'list' = 'grid';
  catalogGroup: 'all' | 'beverages' | 'others' = 'all';
  readonly isCashierMode: boolean;
  discounts: PosDiscount[] = [];
  paymentMethods: PosPaymentMethod[] = [];
  cart: CartLine[] = [];
  cartOpen = false;
  isCheckingOut = false;
  isOpeningCheckout = false;

  showVariantModal = false;
  selectedProduct: PosProduct | null = null;
  variants: PosVariant[] = [];
  variantsLoading = false;
  variantQty: Record<number, number> = {};
  variantSelectedUnit: Record<number, string> = {};
  variantSelectedTemp: Record<number, string> = {};
  variantSelectedSubId: Record<number, number | null> = {};
  variantSelectedSugar: Record<number, string> = {};
  readonly sugarLevelOptions = ['0%', '25%', '50%', '75%', '100%'];
  variantSearch = '';
  /** product = multi-flavor picker; single = one variant (Variant Mode click) */
  variantModalMode: 'product' | 'single' = 'product';
  selectedModalVariantId: number | null = null;

  showCartUnitModal = false;
  editingCartLine: CartLine | null = null;
  editCartUnit = '';
  editCartQty = 1;
  cartEditUnits: PosVariantUnit[] = [];
  cartEditUnitsLoading = false;

  showCheckoutModal = false;
  selectedDiscountId: number | null | 'custom' = null;
  selectedPaymentMethodId: number | null = null;
  paymentReferenceNumber = '';
  bankTransferCustomerFullName = '';
  paymentProofImage: string | null = null;
  cameraAvailable = false;
  cameraOpen = false;
  private mediaStream: MediaStream | null = null;
  customDiscountDraft = 0;
  customDiscountApplied = 0;
  amountReceived = 0;
  readonly quickAmounts = [10, 20, 50, 100, 500, 1000];
  checkoutSuccess: {
    changeDue: number;
    totalAmount: number;
    amountPaid: number;
    itemCount: number;
    subtotal: number;
    discount: number;
  } | null = null;
  cashDrawerEnabled = false;
  useCashDrawerThisSale = true;
  checkoutPrinting = false;
  offlineSyncing = false;

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmVariant: 'primary' | 'danger' = 'primary';
  private confirmAction: (() => void) | null = null;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private scanSub?: Subscription;
  private barcodeBusy = false;
  private lastScanCode = '';
  private lastScanAt = 0;

  @ViewChild('amountReceivedInput') amountReceivedInput?: ElementRef<HTMLInputElement>;
  @ViewChild('paymentProofFileInput') paymentProofFileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('paymentCameraVideo') paymentCameraVideo?: ElementRef<HTMLVideoElement>;

  constructor(
    private readonly posService: PosService,
    private readonly cartService: PosCartService,
    private readonly orgService: OrgService,
    private readonly notify: NotificationService,
    private readonly rbac: RbacService,
    private readonly actionBusy: ActionBusyService,
    private readonly receiptPrint: PosReceiptPrintService,
    private readonly comms: PosCommunicationsService,
    private readonly offline: PosOfflineService,
    private readonly barcodeScanner: PosBarcodeScannerService,
  ) {
    this.isCashierMode = this.rbac.isCashier();
  }

  get useCategoryDropdown(): boolean {
    return this.categories.length > 5;
  }

  get isVariantCatalogView(): boolean {
    return this.catalogMode === 'variants' || this.search.trim().length > 0;
  }

  isBeveragesCategory(category?: string | null): boolean {
    const n = String(category ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    return n === 'beverages' || n === 'bevarages';
  }

  /** Quantity-price preset chips are for non-beverage (e.g. grams packs); beverages use the qty box. */
  showQuantityPricePresets(variant: PosVariant): boolean {
    return !this.isBeveragesCategory(variant.category);
  }

  private matchesCatalogGroup(category?: string | null): boolean {
    if (this.catalogGroup === 'all') return true;
    const isBev = this.isBeveragesCategory(category);
    return this.catalogGroup === 'beverages' ? isBev : !isBev;
  }

  get displayedVariants(): PosVariant[] {
    return this.variantCatalog.filter((v) => this.matchesCatalogGroup(v.category));
  }

  get displayedProducts(): PosProduct[] {
    return this.products.filter((p) => this.matchesCatalogGroup(p.category));
  }

  setCatalogGroup(group: 'all' | 'beverages' | 'others'): void {
    this.catalogGroup = group;
    sessionStorage.setItem('posCatalogGroup', group);
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
      return this.displayedVariants.slice(0, 8).map((v) => ({
        kind: 'variant' as const,
        id: v.id,
        label: v.variantName,
        sub: v.productName,
        imageUrl: v.imageUrl ?? v.productImageUrl,
        stock: v.stockQty,
        priceLabel: this.variantPriceLabelForCatalog(v),
      }));
    }
    return this.displayedProducts.slice(0, 8).map((p) => ({
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
    const savedGroup = sessionStorage.getItem('posCatalogGroup');
    if (savedGroup === 'all' || savedGroup === 'beverages' || savedGroup === 'others') {
      this.catalogGroup = savedGroup;
    }
    this.cart = this.cartService.load(this.orgId()).map((line) => ({
      ...line,
      cartKey: line.cartKey ?? this.cartService.cartKey(line.variantId, line.unitType ?? 'piece', {
        unitId: line.unitId ?? null,
      }),
      unitType: line.unitType ?? 'piece',
      unitId: line.unitId ?? null,
    }));
    // Desktop (xl+) shows cart column; tablet/portrait uses slide-out drawer.
    // Do not auto-open on init in portrait — drawer covers the catalog.
    this.cartOpen = false;
    if (
      this.cart.length > 0 &&
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1279px) and (orientation: landscape)').matches
    ) {
      this.cartOpen = true;
    }
    void this.loadCategories();
    void this.loadDiscounts();
    void this.loadPaymentMethods();
    void this.loadCatalog();
    void this.loadCashDrawerSettings();
    this.barcodeScanner.start();
    this.scanSub = this.barcodeScanner.scans$.subscribe((code) => void this.handleBarcodeScan(code));
  }

  ngOnDestroy(): void {
    this.scanSub?.unsubscribe();
    this.barcodeScanner.stop();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  async loadCashDrawerSettings(): Promise<void> {
    try {
      const r = await this.comms.getPrinterSettings();
      const item = r?.item ?? {};
      this.cashDrawerEnabled = String(item['posCashDrawerEnabled'] ?? 'false').toLowerCase() === 'true';
      this.useCashDrawerThisSale = this.cashDrawerEnabled;
    } catch {
      this.cashDrawerEnabled = false;
      this.useCashDrawerThisSale = false;
    }
  }

  get selectedDiscount(): PosDiscount | null {
    if (this.selectedDiscountId == null || this.selectedDiscountId === 'custom') return null;
    return this.discounts.find((d) => d.id === this.selectedDiscountId) ?? null;
  }

  get selectedPaymentMethod(): PosPaymentMethod | null {
    if (!this.selectedPaymentMethodId) return null;
    return this.paymentMethods.find((m) => m.id === this.selectedPaymentMethodId) ?? null;
  }

  /** Show reference field for non-cash payments (optional for Food Panda). */
  get showPaymentReference(): boolean {
    return !!this.selectedPaymentMethod && !this.isCashPayment;
  }

  get requiresPaymentReference(): boolean {
    return this.showPaymentReference && !this.isFoodPandaPayment;
  }

  get isFoodPandaPayment(): boolean {
    const code = String(this.selectedPaymentMethod?.code ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const name = String(this.selectedPaymentMethod?.name ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const haystack = `${code} ${name}`;
    return haystack.includes('foodpanda');
  }

  /** Cash tends cash; all other methods auto-pay exact total. */
  get isCashPayment(): boolean {
    const code = String(this.selectedPaymentMethod?.code ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const name = String(this.selectedPaymentMethod?.name ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const haystack = `${code} ${name}`;
    if (!haystack.trim()) return true;
    if (haystack.includes('gcash')) return false;
    return code === 'cash' || name === 'cash' || haystack.includes('cash payment');
  }

  get showAmountReceived(): boolean {
    return this.isCashPayment;
  }

  get isBankTransferPayment(): boolean {
    const code = String(this.selectedPaymentMethod?.code ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const name = String(this.selectedPaymentMethod?.name ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const haystack = `${code} ${name}`;
    return haystack.includes('banktransfer') || (haystack.includes('bank') && haystack.includes('transfer'));
  }

  get showPaymentProof(): boolean {
    return !!this.selectedPaymentMethod && !this.isCashPayment;
  }

  async detectCamera(): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
        this.cameraAvailable = false;
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameraAvailable = devices.some((d) => d.kind === 'videoinput');
    } catch {
      this.cameraAvailable = false;
    }
  }

  onPaymentProofFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.notify.warning('Invalid file', 'Please choose an image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.paymentProofImage = String(reader.result ?? '') || null;
    };
    reader.readAsDataURL(file);
  }

  clearPaymentProof(): void {
    this.paymentProofImage = null;
    if (this.paymentProofFileInput?.nativeElement) this.paymentProofFileInput.nativeElement.value = '';
  }

  async openPaymentCamera(): Promise<void> {
    if (!this.cameraAvailable) return;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      this.cameraOpen = true;
      setTimeout(() => {
        const video = this.paymentCameraVideo?.nativeElement;
        if (video && this.mediaStream) {
          video.srcObject = this.mediaStream;
          void video.play();
        }
      }, 50);
    } catch {
      this.notify.error('Camera', 'Could not open the device camera.');
      this.cameraAvailable = false;
      this.closePaymentCamera();
    }
  }

  capturePaymentPhoto(): void {
    const video = this.paymentCameraVideo?.nativeElement;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.paymentProofImage = canvas.toDataURL('image/jpeg', 0.82);
    this.closePaymentCamera();
  }

  closePaymentCamera(): void {
    this.cameraOpen = false;
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
  }

  private syncExactAmountForNonCash(): void {
    if (this.isCashPayment) return;
    this.amountReceived = this.cartTotal();
  }

  onSearchFieldFocus(): void {
    this.searchFocused = true;
  }

  onAmountReceivedChange(value: string | number): void {
    this.amountReceived = Number(value) || 0;
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

  get isOffline(): boolean {
    return !this.offline.isOnline();
  }

  get pendingOfflineSales(): number {
    return this.offline.pendingCount();
  }

  async syncOfflineSales(): Promise<void> {
    if (this.offlineSyncing || !this.offline.isOnline()) return;
    this.offlineSyncing = true;
    try {
      const result = await this.offline.syncQueue((payload) => this.posService.checkout(payload));
      if (result.synced > 0) {
        this.notify.success('Synced', `${result.synced} offline sale(s) uploaded.`);
        await this.loadCatalog();
      }
      if (result.failed > 0) {
        this.notify.warning('Sync incomplete', `${result.failed} sale(s) still waiting to sync.`);
      } else if (result.synced === 0 && this.pendingOfflineSales === 0) {
        this.notify.info('All synced', 'No pending offline sales.');
      }
    } finally {
      this.offlineSyncing = false;
    }
  }

  private applyCachedCatalog(preferredMode?: 'types' | 'variants'): boolean {
    const cached = this.offline.getCachedCatalog(this.orgId());
    if (!cached) return false;

    const cachedVariants = cached.variantCatalog?.length
      ? (cached.variantCatalog as PosVariant[]).map((v) => this.normalizeVariant(v))
      : [];
    const cachedProducts = cached.products?.length
      ? (cached.products as PosProduct[])
      : [];

    if (preferredMode === 'types') {
      if (cachedProducts.length) {
        this.products = cachedProducts;
        this.variantCatalog = [];
      } else if (cachedVariants.length) {
        this.products = this.productsFromVariantCatalog(cachedVariants);
        this.variantCatalog = [];
      } else {
        return false;
      }
    } else if (preferredMode === 'variants') {
      if (cachedVariants.length) {
        this.variantCatalog = cachedVariants;
        this.products = [];
      } else {
        return false;
      }
    } else if (cached.mode === 'variants' && cachedVariants.length) {
      this.variantCatalog = cachedVariants;
      this.products = [];
    } else if (cachedProducts.length) {
      this.products = cachedProducts;
      this.variantCatalog = [];
    } else if (cachedVariants.length) {
      this.products = this.productsFromVariantCatalog(cachedVariants);
      this.variantCatalog = [];
    } else {
      return false;
    }
    this.syncCartStock();
    this.state = 'loaded';
    this.errorMessage = '';
    return true;
  }

  async loadProducts(): Promise<void> {
    const isInitial = this.state !== 'loaded';
    if (isInitial) this.state = 'loading';
    else this.catalogLoading = true;
    this.errorMessage = '';
    try {
      const r = await this.posService.getProducts(this.search, this.selectedCategory || undefined);
      if (!r.success || !r.data) {
        if (this.applyCachedCatalog('types')) return;
        this.state = 'error';
        this.errorMessage = r.message ?? 'Failed to load products.';
        return;
      }
      this.products = this.hydrateProductCardPrices(r.data);
      this.variantCatalog = [];
      this.offline.cacheCatalog(this.orgId(), { mode: 'types', products: this.products });
      this.syncCartStock();
      this.state = 'loaded';
    } catch {
      if (this.applyCachedCatalog('types')) return;
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
        if (this.applyCachedCatalog('variants')) return;
        this.state = 'error';
        this.errorMessage = r.message ?? 'Failed to load variants.';
        return;
      }
      this.variantCatalog = (r.data ?? []).map((v) => this.normalizeVariant(v));
      this.products = [];
      this.offline.cacheCatalog(this.orgId(), { mode: 'variants', variantCatalog: this.variantCatalog });
      this.syncCartStock();
      this.state = 'loaded';
    } catch {
      if (this.applyCachedCatalog('variants')) return;
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

  onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    const q = this.search.trim();
    if (!this.looksLikeBarcode(q)) return;
    event.preventDefault();
    void this.handleBarcodeScan(q);
  }

  private looksLikeBarcode(value: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/.test(value);
  }

  private async handleBarcodeScan(code: string): Promise<void> {
    const barcode = String(code ?? '').trim();
    if (!barcode) return;
    if (this.showCheckoutModal || this.confirmOpen || this.isCheckingOut) return;

    const now = Date.now();
    if (this.barcodeBusy || (barcode === this.lastScanCode && now - this.lastScanAt < 600)) return;
    this.lastScanCode = barcode;
    this.lastScanAt = now;
    this.barcodeBusy = true;
    if (this.searchTimer) clearTimeout(this.searchTimer);

    try {
      const r = await this.posService.getVariantByBarcode(barcode);
      if (!r.success || !r.data) {
        this.notify.warning('Barcode not found', r.message ?? `No product matches "${barcode}".`);
        return;
      }

      const variant = this.normalizeVariant(r.data);
      this.search = '';
      this.searchFocused = false;
      if (this.showVariantModal) this.closeVariantModal();
      if (this.showCartUnitModal) {
        this.showCartUnitModal = false;
        this.editingCartLine = null;
      }

      this.prepareScanSelections(variant);
      const unit = this.selectedUnitFor(variant);
      if (unit.isManualEntry || unit.unitType === 'grams') {
        await this.openVariantFromCatalog(variant);
        this.notify.info('Scanned', 'Enter the weight, then add to cart.');
        return;
      }

      this.addVariantToCart(variant);
    } catch {
      this.notify.error('Scan failed', 'Could not look up that barcode.');
    } finally {
      this.barcodeBusy = false;
    }
  }

  private prepareScanSelections(variant: PosVariant): void {
    this.variantSelectedUnit[variant.id] = this.defaultUnitType(variant);
    this.variantQty[variant.id] = this.defaultVariantQty(variant);
    this.ensureBeverageSelections(variant);
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
    this.variantModalMode = 'product';
    this.selectedModalVariantId = null;
    this.showVariantModal = true;
    this.variantsLoading = true;
    this.variantQty = {};
    this.variantSelectedUnit = {};
    this.variantSelectedTemp = {};
    this.variantSelectedSubId = {};
    this.variantSelectedSugar = {};
    this.variantSearch = '';
    try {
      const r = await this.posService.getVariants(product.id);
      this.variants = (r.data ?? []).map((v) => this.normalizeVariant(v));
      this.initVariantModalState();
      this.autoSelectModalVariant();
    } catch {
      this.variants = [];
    } finally {
      this.variantsLoading = false;
    }
  }

  async openVariantFromCatalog(variant: PosVariant): Promise<void> {
    if (!this.variantHasStock(variant)) {
      this.notify.warning('Out of stock', `${variant.variantName} is unavailable.`);
      return;
    }
    let full = variant;
    try {
      const r = await this.posService.getVariants(variant.productId);
      full = (r.data ?? []).find((v) => v.id === variant.id) ?? variant;
    } catch {
      full = variant;
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
      inStock: this.variantHasStock(variant),
    };
    this.variants = [full];
    this.variantModalMode = 'single';
    this.selectedModalVariantId = full.id;
    this.showVariantModal = true;
    this.variantsLoading = false;
    this.variantSearch = '';
    this.initVariantModalState();
  }

  private normalizeVariant(v: PosVariant): PosVariant {
    return {
      ...v,
      hasSugarLevel: Boolean(v.hasSugarLevel),
      subVariants: (Array.isArray(v.subVariants) ? v.subVariants : []).slice().sort(
        (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
      ),
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
    this.variantSelectedTemp = {};
    this.variantSelectedSubId = {};
    this.variantSelectedSugar = {};
    for (const v of this.variants) {
      this.variantQty[v.id] = this.defaultVariantQty(v);
      this.variantSelectedUnit[v.id] = this.defaultUnitType(v);
      this.ensureBeverageSelections(v);
    }
  }

  private defaultUnitType(variant: PosVariant): string {
    const withStock = variant.units.find((u) => this.unitHasStock(variant, u));
    if (withStock) return this.unitSelectionKey(withStock);
    const def = variant.units.find((u) => u.isDefault) ?? variant.units[0];
    return this.unitSelectionKey(def ?? { unitType: 'piece' });
  }

  closeVariantModal(): void {
    this.showVariantModal = false;
    this.selectedProduct = null;
    this.variants = [];
    this.variantSearch = '';
    this.selectedModalVariantId = null;
    this.variantModalMode = 'product';
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

  get selectedModalVariant(): PosVariant | null {
    if (this.selectedModalVariantId == null) return null;
    return this.variants.find((v) => v.id === this.selectedModalVariantId) ?? null;
  }

  get showFlavorPicker(): boolean {
    return this.variantModalMode === 'product' && this.variants.length > 1;
  }

  private autoSelectModalVariant(): void {
    const firstInStock = this.variants.find((v) => this.variantHasStock(v)) ?? this.variants[0] ?? null;
    this.selectedModalVariantId = firstInStock?.id ?? null;
  }

  selectModalVariant(variant: PosVariant): void {
    if (!this.variantHasStock(variant)) {
      this.notify.warning('Out of stock', `${variant.variantName} is unavailable.`);
      return;
    }
    this.selectedModalVariantId = variant.id;
    if (this.variantSelectedUnit[variant.id] == null) {
      this.variantSelectedUnit[variant.id] = this.defaultUnitType(variant);
    }
    this.ensureBeverageSelections(variant);
    if (this.variantQty[variant.id] == null) {
      this.variantQty[variant.id] = this.defaultVariantQty(variant);
    }
  }

  private ensureBeverageSelections(variant: PosVariant): void {
    const subs = variant.subVariants ?? [];
    if (subs.length) {
      const temps = this.tempOptionsFor(variant);
      if (temps.length && !this.variantSelectedTemp[variant.id]) {
        this.variantSelectedTemp[variant.id] = temps[0];
      }
      const currentId = this.variantSelectedSubId[variant.id];
      const current = currentId != null ? subs.find((s) => s.id === currentId) : null;
      const stillValid = current != null && this.subHasStock(current);
      if (!stillValid) {
        const preferred =
          this.subVariantsForTemp(variant).find((s) => this.subHasStock(s))
          ?? this.subVariantsForTemp(variant)[0]
          ?? subs.find((s) => this.subHasStock(s))
          ?? subs[0];
        this.variantSelectedSubId[variant.id] = preferred?.id ?? null;
      }
    } else {
      this.variantSelectedSubId[variant.id] = null;
    }
    if (variant.hasSugarLevel && !this.variantSelectedSugar[variant.id]) {
      this.variantSelectedSugar[variant.id] = '50%';
    }
  }

  hasSubVariants(variant: PosVariant): boolean {
    return (variant.subVariants?.length ?? 0) > 0;
  }

  tempOptionsFor(variant: PosVariant): string[] {
    const set = new Set<string>();
    for (const s of variant.subVariants ?? []) {
      const t = String(s.tempType ?? '').trim().toLowerCase();
      if (t === 'hot' || t === 'iced') set.add(t);
    }
    return Array.from(set);
  }

  subVariantsForTemp(variant: PosVariant): PosSubVariant[] {
    const temp = this.variantSelectedTemp[variant.id];
    const all = [...(variant.subVariants ?? [])].sort(
      (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
    );
    if (!temp) return all;
    const filtered = all.filter((s) => {
      const t = String(s.tempType ?? '').trim().toLowerCase();
      return !t || t === temp;
    });
    return filtered.length ? filtered : all;
  }

  selectedSubVariant(variant: PosVariant): PosSubVariant | null {
    const id = this.variantSelectedSubId[variant.id];
    if (id == null) return null;
    return (variant.subVariants ?? []).find((s) => s.id === id) ?? null;
  }

  subHasStock(sub: PosSubVariant): boolean {
    return Number(sub.stockQty ?? 0) > 0;
  }

  stockForSelectedOption(variant: PosVariant): number {
    const sub = this.selectedSubVariant(variant);
    if (sub) return Number(sub.stockQty ?? 0);
    if (this.hasSubVariants(variant)) {
      return (variant.subVariants ?? []).reduce((sum, s) => sum + Number(s.stockQty ?? 0), 0);
    }
    const unit = this.selectedUnitFor(variant);
    return this.stockForUnit(variant, unit);
  }

  selectVariantTemp(variant: PosVariant, temp: string): void {
    this.variantSelectedTemp[variant.id] = temp;
    const next = this.subVariantsForTemp(variant).find((s) => this.subHasStock(s))
      ?? this.subVariantsForTemp(variant)[0];
    this.variantSelectedSubId[variant.id] = next?.id ?? null;
  }

  selectSubVariant(variant: PosVariant, sub: PosSubVariant): void {
    this.variantSelectedSubId[variant.id] = sub.id;
    const t = String(sub.tempType ?? '').trim().toLowerCase();
    if (t === 'hot' || t === 'iced') {
      this.variantSelectedTemp[variant.id] = t;
    }
  }

  selectSugarLevel(variant: PosVariant, sugar: string): void {
    this.variantSelectedSugar[variant.id] = sugar;
  }

  selectedPriceFor(variant: PosVariant): { sellingPrice: number; salePrice: number | null } {
    const sub = this.selectedSubVariant(variant);
    if (sub) {
      return {
        sellingPrice: Number(sub.sellingPrice ?? 0),
        salePrice: sub.salePrice != null ? Number(sub.salePrice) : null,
      };
    }
    const unit = this.selectedUnitFor(variant);
    const qty = Number(this.variantQty[variant.id] ?? this.defaultVariantQty(variant)) || 0;
    const tier = this.matchQtyPrice(unit.qtyPrices, qty);
    if (tier) {
      return {
        sellingPrice: this.unitRateFromQtyPrice(tier),
        salePrice: null,
      };
    }
    return {
      sellingPrice: unit.sellingPrice,
      salePrice: unit.salePrice ?? null,
    };
  }

  modalUnitPrice(variant: PosVariant): number {
    const price = this.selectedPriceFor(variant);
    return this.posService.effectiveUnitPrice(price.sellingPrice, price.salePrice);
  }

  modalLineTotal(variant: PosVariant): number {
    const unit = this.selectedUnitFor(variant);
    const qty = Number(this.variantQty[variant.id] ?? this.defaultVariantQty(variant)) || 0;
    const tier = this.matchQtyPrice(unit.qtyPrices, qty);
    if (tier && !this.selectedSubVariant(variant)) {
      return Math.round(tier.price * 100) / 100;
    }
    return Math.round(this.modalUnitPrice(variant) * qty * 100) / 100;
  }

  private matchQtyPrice(
    tiers: PosQtyPrice[] | null | undefined,
    qty: number,
  ): PosQtyPrice | null {
    if (!tiers?.length || !Number.isFinite(qty)) return null;
    return tiers.find((t) => Math.abs(Number(t.qty) - qty) < 0.0005) ?? null;
  }

  private unitRateFromQtyPrice(tier: PosQtyPrice): number {
    const qty = Number(tier.qty);
    const price = Number(tier.price);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    return Math.round((price / qty) * 1000000) / 1000000;
  }

  addSelectedVariantToCart(): void {
    const variant = this.selectedModalVariant;
    if (!variant) {
      this.notify.warning('Select a flavor', 'Choose a variant before adding to cart.');
      return;
    }
    this.addVariantToCart(variant);
  }

  selectedUnitFor(variant: PosVariant): PosVariantUnit {
    const units = variant.units ?? [];
    const key = this.variantSelectedUnit[variant.id] ?? this.unitSelectionKey(units[0]);
    return (
      this.findUnitByKey(units, key) ??
      units[0] ?? {
        unitType: 'piece',
        sellingPrice: variant.sellingPrice,
        salePrice: variant.salePrice,
        isManualEntry: false,
        stockQty: 0,
      }
    );
  }

  onVariantUnitChange(variant: PosVariant): void {
    this.variantQty[variant.id] = this.defaultQtyForUnit(this.selectedUnitFor(variant));
  }

  selectVariantUnit(variant: PosVariant, unit: PosVariantUnit | string): void {
    const key = typeof unit === 'string' ? unit : this.unitSelectionKey(unit);
    if (this.variantSelectedUnit[variant.id] === key) return;
    this.variantSelectedUnit[variant.id] = key;
    this.onVariantUnitChange(variant);
  }

  incrementVariantQty(variant: PosVariant): void {
    const unit = this.selectedUnitFor(variant);
    const isWeightQty = unit.isManualEntry || unit.unitType === 'grams';
    const step = isWeightQty ? 10 : 1;
    const current = Number(this.variantQty[variant.id]) || 0;
    const next = Math.round((current + step) * 1000) / 1000;
    const useSubStock = this.hasSubVariants(variant);
    const stockInGrams = useSubStock
      ? false
      : unit.isManualEntry || unit.unitType === 'grams' || isRetailSellUnit(unit.unitType);
    const poolStock = this.stockForSelectedOption(variant);
    const available = this.availableSellQty(poolStock, useSubStock ? 'piece' : unit.unitType, stockInGrams);
    if (next > available) {
      this.notify.warning('Stock limit', this.stockLimitLabel(poolStock, useSubStock ? 'piece' : unit.unitType, stockInGrams));
      return;
    }
    this.variantQty[variant.id] = next;
  }

  decrementVariantQty(variant: PosVariant): void {
    const unit = this.selectedUnitFor(variant);
    const isWeightQty = unit.isManualEntry || unit.unitType === 'grams';
    const step = isWeightQty ? 10 : 1;
    const minQty = isWeightQty ? 0.01 : 1;
    const current = Number(this.variantQty[variant.id]) || minQty;
    this.variantQty[variant.id] = Math.max(minQty, Math.round((current - step) * 1000) / 1000);
  }

  addVariantToCart(variant: PosVariant): void {
    const unit = this.selectedUnitFor(variant);
    const isManual = unit.isManualEntry || unit.unitType === 'grams';
    const rawQty = Number(this.variantQty[variant.id]) || 0;
    const qty = isManual
      ? Math.round(Math.max(0.01, rawQty) * 1000) / 1000
      : Math.max(1, Math.floor(rawQty));
    if (this.hasSubVariants(variant) && !this.selectedSubVariant(variant)) {
      this.notify.warning('Select size', 'Choose a size / sub-variant before adding to cart.');
      return;
    }
    if (variant.hasSugarLevel && !this.variantSelectedSugar[variant.id]) {
      this.notify.warning('Select sugar', 'Choose a sugar level before adding to cart.');
      return;
    }
    const sub = this.selectedSubVariant(variant);
    const useSubStock = Boolean(sub);
    const stockInGrams = useSubStock
      ? false
      : isManual || isRetailSellUnit(unit.unitType);
    const poolStock = useSubStock
      ? Number(sub!.stockQty ?? 0)
      : this.stockForUnit(variant, unit);
    const available = this.availableSellQty(
      poolStock,
      useSubStock ? 'piece' : unit.unitType,
      stockInGrams,
    );
    if (poolStock <= 0) {
      this.notify.warning('Out of stock', `${variant.variantName} is unavailable.`);
      return;
    }
    if (qty > available) {
      this.notify.warning(
        'Stock limit',
        this.stockLimitLabel(poolStock, useSubStock ? 'piece' : unit.unitType, stockInGrams),
      );
      return;
    }

    const price = this.selectedPriceFor(variant);
    const sugar = variant.hasSugarLevel ? (this.variantSelectedSugar[variant.id] ?? null) : null;
    const cartKey = this.cartService.cartKey(variant.id, unit.unitType, {
      unitId: unit.id ?? null,
      subVariantId: sub?.id ?? null,
      sugarLevel: sugar,
    });
    const existing = this.cart.find((l) => l.cartKey === cartKey);
    const imageUrl = variant.imageUrl ?? variant.productImageUrl ?? this.selectedProduct?.imageUrl ?? null;
    const displayName = this.beverageDisplayName(variant, sub, sugar);
    if (existing) {
      if (existing.quantity + qty > available) {
        this.notify.warning(
          'Stock limit',
          this.stockLimitLabel(poolStock, useSubStock ? 'piece' : unit.unitType, stockInGrams),
        );
        return;
      }
      existing.quantity = Math.round((existing.quantity + qty) * 1000) / 1000;
      existing.sellingPrice = price.sellingPrice;
      existing.salePrice = price.salePrice;
      existing.variantName = displayName;
    } else {
      this.cart = [
        ...this.cart,
        {
          cartKey,
          variantId: variant.id,
          productId: variant.productId,
          productName: variant.productName,
          variantName: displayName,
          sellingPrice: price.sellingPrice,
          salePrice: price.salePrice,
          quantity: qty,
          stockQty: poolStock,
          stockInGrams,
          imageUrl,
          unitType: unit.unitType,
          unitId: unit.id ?? null,
          isManualEntry: isManual,
          units: variant.units,
          subVariantId: sub?.id ?? null,
          tempType: sub?.tempType ?? null,
          sizeLabel: sub?.sizeLabel ?? null,
          sugarLevel: sugar,
          lineDiscount: 0,
        },
      ];
    }
    this.persistCart();
    this.openCartDrawerOnAdd();
  }

  private beverageDisplayName(
    variant: PosVariant,
    sub: PosSubVariant | null,
    sugar: string | null,
  ): string {
    const parts = [variant.variantName];
    if (sub) {
      const temp = String(sub.tempType ?? '').trim();
      if (temp) parts.push(temp.charAt(0).toUpperCase() + temp.slice(1));
      if (sub.sizeLabel) parts.push(sub.sizeLabel);
    }
    if (sugar) parts.push(sugar);
    return parts.join(' · ');
  }

  incrementLine(line: CartLine): void {
    const isWeightQty = Boolean(line.isManualEntry) || line.unitType === 'grams';
    const step = isWeightQty ? 10 : 1;
    const stockInGrams = Boolean(line.stockInGrams) || tracksStockInGrams(line.unitType, line.units);
    const available = this.availableSellQty(line.stockQty, line.unitType, stockInGrams);
    if (line.quantity + step > available) {
      this.notify.warning('Stock limit', this.stockLimitLabel(line.stockQty, line.unitType, stockInGrams));
      return;
    }
    line.quantity = Math.round((line.quantity + step) * 1000) / 1000;
    this.persistCart();
  }

  decrementLine(line: CartLine): void {
    const isWeightQty = Boolean(line.isManualEntry) || line.unitType === 'grams';
    const step = isWeightQty ? 10 : 1;
    const minQty = isWeightQty ? 0.01 : 1;
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
    const current = (line.units ?? []).find((u) =>
      line.unitId != null ? Number(u.id) === Number(line.unitId) : u.unitType === line.unitType,
    ) ?? { unitType: line.unitType, id: line.unitId ?? undefined } as PosVariantUnit;
    this.editCartUnit = this.unitSelectionKey(current);
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
    return this.findUnitByKey(this.cartEditUnits, this.editCartUnit);
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
    this.editCartQty = this.defaultQtyForUnit(unit);
    setTimeout(() => this.focusCartEditQty(), 0);
  }

  applyCartUnitEdit(): void {
    const line = this.editingCartLine;
    if (!line) return;
    const unit = this.selectedCartEditUnit();
    if (!unit) return;

    const isManual = unit.isManualEntry || unit.unitType === 'grams';
    const rawQty = Number(this.editCartQty) || 0;
    const qty = isManual
      ? Math.round(Math.max(0.01, rawQty) * 1000) / 1000
      : Math.max(1, Math.floor(rawQty));
    const stockInGrams = isManual || isRetailSellUnit(unit.unitType, unit.productSource, unit.isManualEntry);
    const poolStock = this.stockForUnit(
      {
        stockQty: line.stockQty,
        retailStockQty: undefined,
        units: line.units ?? [],
      },
      unit,
    );
    const available = this.availableSellQty(poolStock, unit.unitType, stockInGrams);

    if (rawQty <= 0) {
      this.notify.warning('Invalid quantity', 'Enter a valid quantity.');
      return;
    }
    if (qty > available) {
      this.notify.warning('Stock limit', this.stockLimitLabel(poolStock, unit.unitType, stockInGrams));
      return;
    }

    const newKey = this.cartService.cartKey(line.variantId, unit.unitType, {
      unitId: unit.id ?? null,
      subVariantId: line.subVariantId ?? null,
      sugarLevel: line.sugarLevel ?? null,
    });
    const unitChanged =
      unit.unitType !== line.unitType || Number(unit.id ?? 0) !== Number(line.unitId ?? 0);
    const qtyChanged = qty !== line.quantity;

    if (!unitChanged && !qtyChanged) {
      this.closeCartUnitEdit();
      return;
    }

    if (unitChanged && newKey !== line.cartKey) {
      const existing = this.cart.find((l) => l.cartKey === newKey);
      if (existing) {
        const combined = Math.round((existing.quantity + qty) * 1000) / 1000;
        if (combined > available) {
          this.notify.warning('Stock limit', this.stockLimitLabel(poolStock, unit.unitType, stockInGrams));
          return;
        }
        existing.quantity = combined;
        existing.sellingPrice = unit.sellingPrice;
        existing.salePrice = unit.salePrice;
        existing.unitId = unit.id ?? null;
        existing.unitType = unit.unitType;
        existing.isManualEntry = isManual;
        existing.stockInGrams = stockInGrams;
        existing.stockQty = poolStock;
        existing.units = line.units;
        this.cart = this.cart.filter((l) => l.cartKey !== line.cartKey);
      } else {
        line.cartKey = newKey;
        line.unitType = unit.unitType;
        line.unitId = unit.id ?? null;
        line.sellingPrice = unit.sellingPrice;
        line.salePrice = unit.salePrice;
        line.isManualEntry = isManual;
        line.stockInGrams = stockInGrams;
        line.stockQty = poolStock;
        line.quantity = qty;
      }
    } else {
      line.quantity = qty;
      if (unitChanged) {
        line.cartKey = newKey;
        line.unitType = unit.unitType;
        line.unitId = unit.id ?? null;
        line.sellingPrice = unit.sellingPrice;
        line.salePrice = unit.salePrice;
        line.isManualEntry = isManual;
        line.stockInGrams = stockInGrams;
        line.stockQty = poolStock;
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
    const raw = this.lineUnitPrice(line) * line.quantity;
    const discount = Math.min(Math.max(0, Number(line.lineDiscount ?? 0) || 0), raw);
    return Math.round((raw - discount) * 100) / 100;
  }

  setLineDiscount(line: CartLine, value: number | string): void {
    const raw = this.lineUnitPrice(line) * line.quantity;
    const discount = Math.min(Math.max(0, Number(value) || 0), raw);
    line.lineDiscount = Math.round(discount * 100) / 100;
    this.persistCart();
    this.syncExactAmountForNonCash();
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
    if (this.selectedDiscountId === 'custom') {
      return Math.min(Math.max(0, Number(this.customDiscountApplied) || 0), this.cartSubtotal());
    }
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
    const hasBuyerName = !this.isBankTransferPayment || !!this.bankTransferCustomerFullName.trim();
    const hasReference = !this.requiresPaymentReference || !!this.paymentReferenceNumber.trim();
    return (
      received >= this.cartTotal() &&
      this.cart.length > 0 &&
      !!this.selectedPaymentMethodId &&
      hasBuyerName &&
      hasReference
    );
  }

  toggleCart(): void {
    this.cartOpen = !this.cartOpen;
  }

  /** Open the slide-out cart after adding an item (tablet/portrait). */
  private openCartDrawerOnAdd(): void {
    this.cartOpen = true;
  }

  private isCartDrawerMode(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches;
  }

  async openCheckoutModal(): Promise<void> {
    if (this.cart.length === 0) {
      this.notify.warning('Empty cart', 'Add products before checking out.');
      return;
    }
    if (this.isOpeningCheckout || this.isCheckingOut) return;
    this.isOpeningCheckout = true;
    try {
      await this.loadCashDrawerSettings();
      this.selectedDiscountId = null;
      this.customDiscountDraft = 0;
      this.customDiscountApplied = 0;
      this.paymentReferenceNumber = '';
      this.bankTransferCustomerFullName = '';
      this.paymentProofImage = null;
      this.amountReceived = 0;
      this.checkoutSuccess = null;
      void this.detectCamera();
      this.checkoutPrinting = false;
      this.useCashDrawerThisSale = this.cashDrawerEnabled;
      this.showCheckoutModal = true;
    } finally {
      this.isOpeningCheckout = false;
    }
  }

  closeCheckoutModal(): void {
    if (this.isCheckingOut || this.checkoutPrinting) return;
    this.closePaymentCamera();
    this.showCheckoutModal = false;
    this.checkoutSuccess = null;
  }

  dismissCheckoutSuccess(): void {
    this.showCheckoutModal = false;
    this.checkoutSuccess = null;
    this.checkoutPrinting = false;
  }

  selectPaymentMethod(id: number): void {
    this.selectedPaymentMethodId = id;
    if (!this.isBankTransferPayment) {
      this.bankTransferCustomerFullName = '';
    }
    if (this.isCashPayment) {
      this.amountReceived = 0;
      this.clearPaymentProof();
    } else {
      this.syncExactAmountForNonCash();
    }
  }

  paymentMethodTone(m: PosPaymentMethod): string {
    const key = `${m.code} ${m.name}`.toLowerCase();
    if (key.includes('gcash') || key.includes('maya') || key.includes('wallet') || key.includes('e-wallet') || key.includes('ewallet')) {
      return 'wallet';
    }
    if (key.includes('card') || key.includes('credit') || key.includes('debit') || key.includes('visa') || key.includes('master')) {
      return 'card';
    }
    if (key.includes('bank') || key.includes('transfer')) {
      return 'bank';
    }
    return 'cash';
  }

  onDiscountChange(): void {
    if (this.selectedDiscountId !== 'custom') {
      this.customDiscountDraft = 0;
      this.customDiscountApplied = 0;
      this.syncExactAmountForNonCash();
      return;
    }
    this.customDiscountApplied = 0;
    this.customDiscountDraft = 0;
    this.syncExactAmountForNonCash();
  }

  applyQuickAmount(amount: number): void {
    this.amountReceived = Math.round((Number(amount) || 0) * 100) / 100;
  }

  clearAmountReceived(): void {
    this.amountReceived = 0;
  }

  requestApplyCustomDiscount(): void {
    const amount = Math.round((Number(this.customDiscountDraft) || 0) * 100) / 100;
    if (amount <= 0) {
      this.notify.warning('Invalid discount', 'Enter a custom discount greater than zero.');
      return;
    }
    if (amount > this.cartSubtotal()) {
      this.notify.warning('Invalid discount', 'Custom discount cannot exceed the subtotal.');
      return;
    }
    this.openConfirm(
      'Apply custom discount?',
      `Apply a ₱${this.formatCurrency(amount)} discount to this sale?`,
      () => {
        this.customDiscountApplied = amount;
        this.syncExactAmountForNonCash();
      },
    );
  }

  displayPrice(product: PosProduct): { price: number; original?: number } {
    if (product.hasSale && product.minSalePrice != null) {
      return { price: product.minSalePrice, original: product.minPrice };
    }
    return { price: product.minPrice };
  }

  private hydrateProductCardPrices(products: PosProduct[]): PosProduct[] {
    if (!this.variantCatalog.length) {
      return products;
    }

    const variantsByProduct = new Map<number, PosVariant[]>();
    for (const raw of this.variantCatalog) {
      const variant = this.normalizeVariant(raw);
      const list = variantsByProduct.get(variant.productId) ?? [];
      list.push(variant);
      variantsByProduct.set(variant.productId, list);
    }

    return products.map((product) => {
      if (product.minPrice > 0) {
        return product;
      }
      const variants = variantsByProduct.get(product.id) ?? [];
      const priceSummary = this.computeProductPriceSummary(variants);
      if (!priceSummary) {
        return product;
      }
      return {
        ...product,
        minPrice: priceSummary.minPrice,
        maxPrice: priceSummary.maxPrice,
        minSalePrice: priceSummary.minSalePrice,
        hasSale: priceSummary.hasSale,
      };
    });
  }

  private computeProductPriceSummary(
    variants: PosVariant[],
  ): { minPrice: number; maxPrice: number; minSalePrice: number | null; hasSale: boolean } | null {
    const effectivePrices: number[] = [];
    const effectiveSalePrices: number[] = [];

    for (const variant of variants) {
      const effective = this.effectiveVariantCardPrice(variant);
      if (!effective || effective.sellingPrice <= 0) {
        continue;
      }
      effectivePrices.push(effective.sellingPrice);
      if (effective.salePrice != null && effective.salePrice > 0 && effective.salePrice < effective.sellingPrice) {
        effectiveSalePrices.push(effective.salePrice);
      }
    }

    if (!effectivePrices.length) {
      return null;
    }

    return {
      minPrice: Math.min(...effectivePrices),
      maxPrice: Math.max(...effectivePrices),
      minSalePrice: effectiveSalePrices.length ? Math.min(...effectiveSalePrices) : null,
      hasSale: effectiveSalePrices.length > 0,
    };
  }

  private productsFromVariantCatalog(variants: PosVariant[]): PosProduct[] {
    const grouped = new Map<number, PosVariant[]>();
    for (const variant of variants) {
      const list = grouped.get(variant.productId) ?? [];
      list.push(variant);
      grouped.set(variant.productId, list);
    }

    return Array.from(grouped.entries()).map(([productId, productVariants]) => {
      const first = productVariants[0];
      const priceSummary = this.computeProductPriceSummary(productVariants);
      const totalStock = productVariants.reduce((sum, variant) => {
        const subSum = (variant.subVariants ?? []).reduce((s, sv) => s + Number(sv.stockQty ?? 0), 0);
        if (subSum > 0) return sum + subSum;
        const unitSum = (variant.units ?? []).reduce((s, u) => s + Number(u.stockQty ?? 0), 0);
        if (unitSum > 0) return sum + unitSum;
        return sum + (Number(variant.stockQty) || 0) + (Number(variant.retailStockQty) || 0);
      }, 0);
      return {
        id: productId,
        name: first?.productName ?? 'Unnamed product',
        category: first?.category ?? null,
        brand: null,
        imageUrl: first?.productImageUrl ?? first?.imageUrl ?? null,
        variantCount: productVariants.length,
        minPrice: priceSummary?.minPrice ?? 0,
        maxPrice: priceSummary?.maxPrice ?? 0,
        minSalePrice: priceSummary?.minSalePrice ?? null,
        totalStock,
        hasSale: priceSummary?.hasSale ?? false,
        inStock: totalStock > 0,
      };
    });
  }

  private effectiveVariantCardPrice(variant: PosVariant): { sellingPrice: number; salePrice: number | null } | null {
    const unitPrices = (variant.units ?? []).filter((unit) => Number(unit.sellingPrice) > 0);
    if (unitPrices.length) {
      const defaultUnit = unitPrices.find((unit) => unit.isDefault) ?? unitPrices[0];
      return {
        sellingPrice: Number(defaultUnit.sellingPrice) || 0,
        salePrice: defaultUnit.salePrice != null ? Number(defaultUnit.salePrice) : null,
      };
    }

    const firstSubVariant = (variant.subVariants ?? []).find((sub) => Number(sub.sellingPrice) > 0);
    if (firstSubVariant) {
      return {
        sellingPrice: Number(firstSubVariant.sellingPrice) || 0,
        salePrice: firstSubVariant.salePrice != null ? Number(firstSubVariant.salePrice) : null,
      };
    }

    if (Number(variant.sellingPrice) > 0) {
      return {
        sellingPrice: Number(variant.sellingPrice) || 0,
        salePrice: variant.salePrice != null ? Number(variant.salePrice) : null,
      };
    }

    return null;
  }

  hasSalePrice(line: CartLine): boolean {
    return line.salePrice != null && line.salePrice > 0 && line.salePrice < line.sellingPrice;
  }

  requestConfirmCheckout(): void {
    this.openConfirm(
      'Complete sale?',
      `Confirm sale for ₱${this.formatCurrency(this.cartTotal())}?`,
      () => {
        this.isCheckingOut = true;
        void this.confirmCheckout();
      },
    );
  }

  async confirmCheckout(): Promise<void> {
    if (!this.canConfirmCheckout()) {
      this.isCheckingOut = false;
      return;
    }
    this.isCheckingOut = true;
    const snapshot = {
      itemCount: this.cartCount(),
      subtotal: this.cartSubtotal(),
      discount: this.cartOrderDiscount(),
      totalAmount: this.cartTotal(),
      amountPaid: Number(this.amountReceived) || 0,
      changeDue: this.changeDue(),
    };
    try {
      await this.actionBusy.run('pos-checkout', async () => {
        const payload = {
          items: this.cart.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
            unitType: line.unitType,
            unitId: line.unitId ?? null,
            subVariantId: line.subVariantId ?? null,
            lineDiscount: Math.max(0, Number(line.lineDiscount ?? 0) || 0),
          })),
          discountId: this.selectedDiscountId === 'custom' ? null : this.selectedDiscountId,
          discountAmount: this.selectedDiscountId === 'custom' ? this.customDiscountApplied : undefined,
          amountPaid: snapshot.amountPaid,
          paymentMethodId: this.selectedPaymentMethodId,
          referenceNumber: this.paymentReferenceNumber.trim() || undefined,
          customerFullName: this.bankTransferCustomerFullName.trim() || undefined,
          paymentProofImage: !this.isCashPayment ? (this.paymentProofImage || undefined) : undefined,
        };

        if (!this.offline.isOnline()) {
          this.offline.queueCheckout(this.orgId(), payload, snapshot.totalAmount);
          this.checkoutSuccess = { ...snapshot, changeDue: Math.max(0, snapshot.changeDue) };
          this.notify.success('Saved offline', 'Sale queued. Tap Sync when internet is back.');
          this.cart = [];
          this.cartService.clear(this.orgId());
          this.cartOpen = false;
          this.selectedDiscountId = null;
          this.customDiscountDraft = 0;
          this.customDiscountApplied = 0;
          this.paymentReferenceNumber = '';
          this.bankTransferCustomerFullName = '';
          this.paymentProofImage = null;
          this.amountReceived = 0;
          return;
        }

        const r = await this.posService.checkout(payload);
        if (!r.success || !r.data) {
          this.notify.error('Checkout failed', r.message ?? 'Unable to complete sale.');
          return;
        }
        this.checkoutSuccess = {
          changeDue: Math.max(0, r.data.changeDue ?? snapshot.changeDue),
          totalAmount: r.data.totalAmount,
          amountPaid: r.data.amountPaid ?? snapshot.amountPaid,
          itemCount: r.data.itemCount ?? snapshot.itemCount,
          subtotal: r.data.subtotal ?? snapshot.subtotal,
          discount: r.data.discountAmount ?? snapshot.discount,
        };
        const saleId = r.data.saleIds?.[0];
        this.cart = [];
        this.cartService.clear(this.orgId());
        this.cartOpen = false;
        this.selectedDiscountId = null;
        this.customDiscountDraft = 0;
        this.customDiscountApplied = 0;
        this.paymentReferenceNumber = '';
        this.bankTransferCustomerFullName = '';
        this.paymentProofImage = null;
        this.amountReceived = 0;
        await this.loadCatalog();

        if (saleId) {
          this.checkoutPrinting = true;
          try {
            const printResult = await this.receiptPrint.printSaleReceipt(saleId, {
              openCashDrawer: this.cashDrawerEnabled,
            });
            if (!printResult.success) {
              this.notify.warning(
                'Receipt not printed',
                printResult.message ?? 'Connect PrintHub (Bluetooth icon), then try again.',
              );
            }
          } finally {
            this.checkoutPrinting = false;
          }
        }
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

  variantTracksWeightStock(variant: Pick<PosVariant, 'unitType' | 'units'>): boolean {
    return tracksStockInGrams(variant.unitType, variant.units);
  }

  poolStockForSellUnit(
    variant: Pick<PosVariant, 'stockQty' | 'retailStockQty' | 'units'>,
    sellUnitType: string,
    isManualEntry = false,
  ): number {
    const matched = variant.units?.find(
      (u) => String(u.unitType).toLowerCase() === String(sellUnitType).toLowerCase(),
    );
    if (matched && matched.stockQty != null) {
      return Number(matched.stockQty ?? 0);
    }
    const retail = isRetailSellUnit(
      sellUnitType,
      matched?.productSource,
      isManualEntry || matched?.isManualEntry,
    );
    return retail
      ? Number(variant.retailStockQty ?? 0)
      : Number(variant.stockQty ?? 0);
  }

  variantHasStock(variant: Pick<PosVariant, 'stockQty' | 'retailStockQty' | 'units' | 'inStock' | 'subVariants'>): boolean {
    if (variant.inStock === true) return true;
    const subStock = (variant.subVariants ?? []).reduce((sum, s) => sum + Number(s.stockQty ?? 0), 0);
    if (subStock > 0) return true;
    const unitStock = (variant.units ?? []).reduce((sum, u) => sum + Number(u.stockQty ?? 0), 0);
    if (unitStock > 0) return true;
    return Number(variant.stockQty ?? 0) > 0 || Number(variant.retailStockQty ?? 0) > 0;
  }

  unitHasStock(variant: PosVariant, unit: PosVariantUnit): boolean {
    return this.stockForUnit(variant, unit) > 0;
  }

  maxSellQtyForVariant(variant: PosVariant): number {
    const unit = this.selectedUnitFor(variant);
    const useSubStock = this.hasSubVariants(variant);
    const stockInGrams = useSubStock
      ? false
      : unit.isManualEntry || unit.unitType === 'grams' || isRetailSellUnit(unit.unitType);
    const poolStock = this.stockForSelectedOption(variant);
    return this.availableSellQty(poolStock, useSubStock ? 'piece' : unit.unitType, stockInGrams);
  }

  availableSellQty(
    stockQty: number,
    sellUnitType: string | null | undefined,
    stockInGrams: boolean,
  ): number {
    return stockQtyToSellUnits(stockQty, sellUnitType, stockInGrams);
  }

  formatStock(value: number, stockInGrams = false): string {
    return formatWeightStock(value, stockInGrams);
  }

  formatVariantStock(variant: PosVariant): string {
    const subs = variant.subVariants ?? [];
    if (subs.length) {
      return subs
        .map((s) => {
          const temp = String(s.tempType ?? '').trim();
          const label = [temp, s.sizeLabel].filter(Boolean).join(' ');
          return `${label || 'option'} ${formatWeightStock(Number(s.stockQty ?? 0), false)}`;
        })
        .join(' · ');
    }
    const units = variant.units ?? [];
    if (units.some((u) => u.stockQty != null)) {
      return units
        .map((u) => {
          const inGrams = isRetailSellUnit(u.unitType, u.productSource, u.isManualEntry);
          const label = this.unitChipLabel(u, units);
          return `${label} ${formatWeightStock(Number(u.stockQty ?? 0), inGrams)}`;
        })
        .join(' · ');
    }
    const hasRetail = this.variantTracksWeightStock(variant);
    const wholesale = formatWeightStock(variant.stockQty, false);
    if (!hasRetail) return wholesale;
    const retail = formatWeightStock(Number(variant.retailStockQty ?? 0), true);
    return `WS ${wholesale} · RT ${retail}`;
  }

  formatCartLineStock(line: CartLine): string {
    const stockInGrams = Boolean(line.stockInGrams) || tracksStockInGrams(line.unitType, line.units);
    return formatWeightStock(line.stockQty, stockInGrams);
  }

  stockLimitLabel(stockQty: number, unitType: string, stockInGrams: boolean): string {
    const available = this.availableSellQty(stockQty, unitType, stockInGrams);
    return `Only ${available} ${this.unitLabel(unitType)} available.`;
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

  defaultQtyForUnit(unit: Pick<PosVariantUnit, 'unitType' | 'isManualEntry' | 'defaultQty' | 'qtyPrices'>): number {
    const tiers = unit.qtyPrices ?? [];
    if (tiers.length) {
      const first = Number(tiers[0].qty);
      if (Number.isFinite(first) && first > 0) return Math.round(first * 1000) / 1000;
    }
    const fallback = unit.unitType === 'grams' || unit.isManualEntry ? 200 : 1;
    const qty = Number(unit.defaultQty);
    if (Number.isFinite(qty) && qty > 0) return Math.round(qty * 1000) / 1000;
    return fallback;
  }

  defaultVariantQty(variant: PosVariant): number {
    return this.defaultQtyForUnit(this.selectedUnitFor(variant));
  }

  quantityPresetsFor(variant: PosVariant): number[] {
    const unit = this.selectedUnitFor(variant);
    const tiers = (unit.qtyPrices ?? [])
      .map((t) => Number(t.qty))
      .filter((q) => Number.isFinite(q) && q > 0);
    if (tiers.length) return tiers;
    const preset = this.defaultQtyForUnit(unit);
    return preset > 0 ? [preset] : [];
  }

  quantityPricePresetsFor(variant: PosVariant): PosQtyPrice[] {
    const unit = this.selectedUnitFor(variant);
    const tiers = unit.qtyPrices ?? [];
    if (tiers.length) return tiers;
    const qty = this.defaultQtyForUnit(unit);
    if (!(qty > 0)) return [];
    const rate = this.posService.effectiveUnitPrice(unit.sellingPrice, unit.salePrice ?? null);
    return [{ qty, price: Math.round(rate * qty * 100) / 100 }];
  }

  selectPresetQty(variant: PosVariant, qty: number): void {
    const available = this.maxSellQtyForVariant(variant);
    const next = Math.min(Math.max(0.01, qty), available > 0 ? available : qty);
    this.variantQty[variant.id] = Math.round(next * 1000) / 1000;
  }

  isPresetQtySelected(variant: PosVariant, preset: number): boolean {
    const current = Number(this.variantQty[variant.id]);
    if (!Number.isFinite(current)) return false;
    return Math.abs(current - preset) < 0.0005;
  }

  formatPresetQty(qty: number): string {
    return Number(qty).toLocaleString('en-PH', { maximumFractionDigits: 3 });
  }

  formatPresetPrice(price: number): string {
    return `₱${Number(price).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
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

  cartLineDetails(line: CartLine): string[] {
    const details: string[] = [];
    const temp = String(line.tempType ?? '').trim();
    const size = String(line.sizeLabel ?? '').trim();
    const sugar = String(line.sugarLevel ?? '').trim();
    if (temp) {
      details.push(temp.charAt(0).toUpperCase() + temp.slice(1));
    }
    if (size) {
      details.push(size);
    }
    if (sugar) {
      details.push(sugar);
    }
    return details;
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


  unitSelectionKey(unit: Pick<PosVariantUnit, 'id' | 'unitType'> | null | undefined): string {
    if (!unit) return 'piece';
    const id = Number(unit.id);
    if (Number.isFinite(id) && id > 0) return `id:${id}`;
    return `type:${unit.unitType ?? 'piece'}`;
  }

  findUnitByKey(units: PosVariantUnit[] | null | undefined, key: string | null | undefined): PosVariantUnit | null {
    const list = units ?? [];
    if (!list.length) return null;
    if (!key) return list.find((u) => u.isDefault) ?? list[0] ?? null;
    if (key.startsWith('id:')) {
      const id = Number(key.slice(3));
      return list.find((u) => Number(u.id) === id) ?? list[0] ?? null;
    }
    const type = key.startsWith('type:') ? key.slice(5) : key;
    return list.find((u) => u.unitType === type) ?? list[0] ?? null;
  }

  stockForUnit(
    variant: Pick<PosVariant, 'stockQty' | 'retailStockQty' | 'units'>,
    unit: PosVariantUnit,
  ): number {
    if (unit.stockQty != null) return Number(unit.stockQty ?? 0);
    return this.poolStockForSellUnit(variant, unit.unitType, unit.isManualEntry);
  }

  unitOptionLabel(unit: PosVariantUnit | string, isManualEntry?: boolean): string {
    if (typeof unit === 'string') {
      if (isManualEntry) return `${unit} (enter qty)`;
      return unit;
    }
    return unit.isManualEntry ? `${unit.unitType} (enter qty)` : unit.unitType;
  }

  unitChipLabel(unit: PosVariantUnit, allUnits: PosVariantUnit[] = []): string {
    const base = this.unitOptionLabel(unit);
    const sameTypeCount = allUnits.filter(
      (u) => String(u.unitType).toLowerCase() === String(unit.unitType).toLowerCase(),
    ).length;
    if (sameTypeCount <= 1) return base;
    const dq = Number(unit.defaultQty);
    if (Number.isFinite(dq) && dq > 0) return `${base} · ${dq}`;
    return base;
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

  variantHasSale(variant: PosVariant): boolean {
    const price = this.catalogVariantPrice(variant);
    return price.salePrice != null && price.salePrice > 0 && price.salePrice < price.sellingPrice;
  }

  catalogVariantImage(variant: PosVariant): string | null {
    return variant.imageUrl ?? variant.productImageUrl ?? null;
  }

  catalogVariantPrice(variant: PosVariant): { sellingPrice: number; salePrice: number | null } {
    return this.effectiveVariantCardPrice(variant) ?? {
      sellingPrice: Number(variant.sellingPrice) || 0,
      salePrice: variant.salePrice != null ? Number(variant.salePrice) : null,
    };
  }

  variantPriceLabelForCatalog(variant: PosVariant): string {
    const price = this.catalogVariantPrice(variant);
    const amount = price.salePrice != null && price.salePrice > 0 && price.salePrice < price.sellingPrice
      ? price.salePrice
      : price.sellingPrice;
    return `₱${amount.toFixed(2)}`;
  }

  private syncCartStock(): void {
    for (const line of this.cart) {
      const variant = this.variantCatalog.find((v) => v.id === line.variantId);
      if (variant) {
        const matched = (variant.units ?? []).find((u) =>
          line.unitId != null ? Number(u.id) === Number(line.unitId) : u.unitType === line.unitType,
        );
        line.stockQty = matched
          ? this.stockForUnit(variant, matched)
          : this.poolStockForSellUnit(
              variant,
              line.unitType ?? 'piece',
              Boolean(line.isManualEntry),
            );
        continue;
      }
      const product = this.products.find((p) => p.name === line.productName);
      if (product) {
        line.stockQty = product.totalStock;
      }
    }
  }
}
