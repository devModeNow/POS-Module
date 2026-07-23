import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PosService } from '../../../shared/services/pos.service';
import { PosReceiptPrintService } from '../../../shared/services/pos-receipt-print.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { PosPageHeaderComponent } from '../shared/pos-page-header.component';

type SaleRow = {
  id: number;
  saleDate: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod?: string;
  referenceNumber?: string | null;
};

type PaymentMethodTotal = {
  methodName: string;
  methodCode: string;
  totalAmount: number;
  transactionCount: number;
};

type SaleDetail = {
  id: number;
  saleDate: string;
  createdAt: string;
  cashier: string;
  paymentMethod: string;
  paymentStatus: string;
  referenceNumber?: string | null;
  amountPaid: number | null;
  changeAmount: number | null;
  discountAmount: number;
  totalAmount: number;
  itemCount: number;
  items: Array<{
    id: number;
    variantId: number;
    productName: string;
    variantName: string;
    quantitySold: number;
    unitType: string;
    unitPrice: number;
    totalAmount: number;
  }>;
};

@Component({
  selector: 'app-pos-my-sales',
  standalone: true,
  imports: [CommonModule, FormsModule, PosPageHeaderComponent],
  templateUrl: './pos-my-sales.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosMySalesComponent implements OnInit {
  from = '';
  to = '';
  loading = false;
  error = '';
  summary: { totalSales: number; transactionCount: number; totalDiscount: number } | null = null;
  byPayment: PaymentMethodTotal[] = [];
  recent: SaleRow[] = [];
  recentTotal = 0;
  lastUpdatedAt: Date | null = null;

  private readonly hiddenPaymentCardsKey = 'pos.mySales.hiddenPaymentCards';
  hiddenPaymentCardCodes = new Set<string>();
  showAddPaymentCardMenu = false;

  tableSearch = '';
  tableStatus = '';
  currentPage = 1;
  pageSize = 10;
  readonly pageSizeOptions = [10, 20, 50];
  sortBy: 'id' | 'date' | 'amount' | 'status' | 'payment' | 'reference' = 'date';
  sortDir: 'asc' | 'desc' = 'desc';

  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  reprintingSaleId: number | null = null;
  showReprintAuthModal = false;
  reprintTarget: SaleRow | null = null;
  reprintAdminCode = '';
  reprintAuthBusy = false;
  showDetailModal = false;
  detailLoading = false;
  detailError = '';
  saleDetail: SaleDetail | null = null;
  detailSaleRow: SaleRow | null = null;

  showVoidModal = false;
  voidingItem: SaleDetail['items'][number] | null = null;
  voidAdminCode = '';
  voidReason = '';
  isVoiding = false;

  get periodLabel(): string {
    if (!this.from && !this.to) return 'All recorded sales';
    if (this.from && this.to) {
      return `Showing sales from ${this.formatDisplayDate(this.from)} to ${this.formatDisplayDate(this.to)}`;
    }
    return this.from
      ? `From ${this.formatDisplayDate(this.from)}`
      : `Through ${this.formatDisplayDate(this.to)}`;
  }

  get lastUpdatedLabel(): string {
    if (!this.lastUpdatedAt) return '';
    return this.lastUpdatedAt.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.recentTotal / this.pageSize));
  }

  get pageRangeStart(): number {
    if (this.recentTotal === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageRangeEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.recentTotal);
  }

  get hasTableFilters(): boolean {
    return !!this.tableSearch.trim() || !!this.tableStatus;
  }

  get visiblePaymentCards(): PaymentMethodTotal[] {
    return this.byPayment.filter((p) => !this.hiddenPaymentCardCodes.has(p.methodCode));
  }

  get hiddenPaymentCards(): PaymentMethodTotal[] {
    return this.byPayment.filter((p) => this.hiddenPaymentCardCodes.has(p.methodCode));
  }

  constructor(
    private readonly pos: PosService,
    private readonly receiptPrint: PosReceiptPrintService,
    private readonly notify: NotificationService,
  ) {
    this.loadHiddenPaymentCards();
  }

  ngOnInit(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.from = today;
    this.to = today;
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const r = await this.pos.getMySales({
        from: this.from || undefined,
        to: this.to || undefined,
        status: this.tableStatus || undefined,
        search: this.tableSearch.trim() || undefined,
        page: this.currentPage,
        pageSize: this.pageSize,
        sortBy: this.sortBy,
        sortDir: this.sortDir,
      }) as {
        success: boolean;
        data?: {
          summary: { totalSales: number; transactionCount: number; totalDiscount: number };
          byPayment?: PaymentMethodTotal[];
          recent: SaleRow[];
          recentTotal?: number;
          page?: number;
          pageSize?: number;
        };
        message?: string;
      };
      if (!r.success || !r.data) {
        this.error = r.message ?? 'Failed to load sales.';
        this.summary = null;
        this.byPayment = [];
        this.recent = [];
        this.recentTotal = 0;
        return;
      }
      this.summary = r.data.summary;
      this.byPayment = r.data.byPayment ?? [];
      this.recent = r.data.recent ?? [];
      this.recentTotal = r.data.recentTotal ?? this.recent.length;
      if (r.data.page) this.currentPage = r.data.page;
      if (r.data.pageSize) this.pageSize = r.data.pageSize;
      if (this.recent.length === 0 && this.recentTotal > 0 && this.currentPage > 1) {
        this.currentPage = 1;
        void this.load();
        return;
      }
      this.lastUpdatedAt = new Date();
    } finally {
      this.loading = false;
    }
  }

  onPeriodChange(): void {
    this.currentPage = 1;
    void this.load();
  }

  onTableStatusChange(): void {
    this.currentPage = 1;
    void this.load();
  }

  onTableSearchInput(): void {
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.currentPage = 1;
      void this.load();
    }, 350);
  }

  clearTableFilters(): void {
    this.tableSearch = '';
    this.tableStatus = '';
    this.currentPage = 1;
    void this.load();
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
    void this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.currentPage = page;
    void this.load();
  }

  prevPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  toggleSort(column: 'id' | 'date' | 'amount' | 'status' | 'payment' | 'reference'): void {
    if (this.sortBy === column) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = column;
      this.sortDir = column === 'id' || column === 'date' ? 'desc' : 'asc';
    }
    this.currentPage = 1;
    void this.load();
  }

  sortIndicator(column: 'id' | 'date' | 'amount' | 'status' | 'payment' | 'reference'): string {
    if (this.sortBy !== column) return '';
    return this.sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  async openSaleDetail(row: SaleRow): Promise<void> {
    this.showDetailModal = true;
    this.detailSaleRow = row;
    this.detailLoading = true;
    this.detailError = '';
    this.saleDetail = null;
    try {
      const r = await this.pos.getTransactionDetail(row.id);
      if (!r.success || !r.data) {
        this.detailError = r.message ?? 'Unable to load sale details.';
        return;
      }
      this.saleDetail = r.data;
    } finally {
      this.detailLoading = false;
    }
  }

  closeSaleDetail(): void {
    this.showDetailModal = false;
    this.saleDetail = null;
    this.detailSaleRow = null;
    this.detailError = '';
  }

  openVoidItem(item: SaleDetail['items'][number], event?: Event): void {
    event?.stopPropagation();
    this.voidingItem = item;
    this.voidAdminCode = '';
    this.voidReason = '';
    this.showVoidModal = true;
  }

  closeVoidModal(): void {
    if (this.isVoiding) return;
    this.showVoidModal = false;
    this.voidingItem = null;
    this.voidAdminCode = '';
    this.voidReason = '';
  }

  async confirmVoidItem(): Promise<void> {
    if (!this.voidingItem) return;
    if (!this.voidAdminCode.trim()) {
      this.notify.warning('Required', 'Enter the admin void code to void this item.');
      return;
    }

    this.isVoiding = true;
    try {
      const r = await this.pos.voidCartLine({
        saleId: this.voidingItem.id,
        adminCode: this.voidAdminCode.trim(),
        reason: this.voidReason.trim() || undefined,
      });
      if (!r.success) {
        this.notify.error('Void failed', r.message ?? 'Invalid admin code.');
        return;
      }

      this.notify.success('Item voided', 'Stock has been restored for this product.');
      this.showVoidModal = false;
      this.voidingItem = null;
      this.voidAdminCode = '';
      this.voidReason = '';

      if (this.detailSaleRow) {
        const row = this.detailSaleRow;
        this.detailLoading = true;
        this.detailError = '';
        try {
          const detail = await this.pos.getTransactionDetail(row.id);
          if (!detail.success || !detail.data) {
            this.closeSaleDetail();
          } else if (!detail.data.items?.length) {
            this.closeSaleDetail();
          } else {
            this.saleDetail = detail.data;
          }
        } finally {
          this.detailLoading = false;
        }
      }
      await this.load();
    } catch {
      this.notify.error('Void failed', 'Could not void this item.');
    } finally {
      this.isVoiding = false;
    }
  }

  promptReprintSale(row: SaleRow, event?: Event): void {
    event?.stopPropagation();
    if (this.reprintingSaleId != null || this.reprintAuthBusy) return;
    this.reprintTarget = row;
    this.reprintAdminCode = '';
    this.showReprintAuthModal = true;
  }

  closeReprintAuthModal(): void {
    if (this.reprintAuthBusy) return;
    this.showReprintAuthModal = false;
    this.reprintTarget = null;
    this.reprintAdminCode = '';
  }

  async confirmReprintSale(): Promise<void> {
    if (!this.reprintTarget) return;
    if (!this.reprintAdminCode.trim()) {
      this.notify.warning('Required', 'Enter the admin void code to re-print this receipt.');
      return;
    }

    this.reprintAuthBusy = true;
    try {
      const auth = await this.pos.authorizeAdminCode({
        adminCode: this.reprintAdminCode.trim(),
        action: 'pos.sale.reprint.authorize',
        saleId: this.reprintTarget.id,
      });
      if (!auth.success) {
        this.notify.error('Authorization failed', auth.message ?? 'Invalid admin code.');
        return;
      }

      const row = this.reprintTarget;
      this.showReprintAuthModal = false;
      this.reprintTarget = null;
      this.reprintAdminCode = '';

      if (this.reprintingSaleId != null) return;
      this.reprintingSaleId = row.id;
      const result = await this.receiptPrint.printSaleReceipt(row.id, { reprint: true });
      if (!result.success) {
        this.notify.warning('Re-print failed', result.message ?? 'Connect PrintHub (Bluetooth icon), then try again.');
      } else {
        this.notify.success('Re-print sent', 'Receipt printed with Re-print Only watermark.');
      }
    } catch {
      this.notify.error('Re-print failed', 'Could not authorize or print receipt.');
    } finally {
      this.reprintAuthBusy = false;
      this.reprintingSaleId = null;
    }
  }

  async reprintSale(row: SaleRow, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (this.reprintingSaleId != null) return;
    this.reprintingSaleId = row.id;
    try {
      const result = await this.receiptPrint.printSaleReceipt(row.id, { reprint: true });
      if (!result.success) {
        this.notify.warning('Re-print failed', result.message ?? 'Connect PrintHub (Bluetooth icon), then try again.');
      } else {
        this.notify.success('Re-print sent', 'Receipt printed with Re-print Only watermark.');
      }
    } catch {
      this.notify.error('Re-print failed', 'Could not print receipt.');
    } finally {
      this.reprintingSaleId = null;
    }
  }

  itemLabel(item: SaleDetail['items'][number]): string {
    const name = (item.variantName || item.productName || 'Item').trim();
    const qty = Number(item.quantitySold);
    const qtyLabel = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
    const unit = String(item.unitType || 'pc').trim() || 'pc';
    return `${qtyLabel} - ${name} - ${unit}`;
  }

  formatMoney(value: number | null | undefined): string {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return `₱${Number(value).toFixed(2)}`;
  }

  statusLabel(status: string): string {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (normalized === 'settled') return 'Settled';
    if (normalized === 'floating') return 'Floating';
    return status || '—';
  }

  statusClass(status: string): string {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (normalized === 'settled') {
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300';
    }
    if (normalized === 'floating') {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
    }
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  }

  private formatDisplayDate(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  hidePaymentCard(code: string): void {
    this.hiddenPaymentCardCodes.add(code);
    this.persistHiddenPaymentCards();
  }

  showPaymentCard(code: string): void {
    this.hiddenPaymentCardCodes.delete(code);
    this.persistHiddenPaymentCards();
    this.showAddPaymentCardMenu = false;
  }

  toggleAddPaymentCardMenu(): void {
    this.showAddPaymentCardMenu = !this.showAddPaymentCardMenu;
  }

  private loadHiddenPaymentCards(): void {
    try {
      const raw = localStorage.getItem(this.hiddenPaymentCardsKey);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      this.hiddenPaymentCardCodes = new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      this.hiddenPaymentCardCodes = new Set();
    }
  }

  private persistHiddenPaymentCards(): void {
    localStorage.setItem(this.hiddenPaymentCardsKey, JSON.stringify([...this.hiddenPaymentCardCodes]));
  }
}
