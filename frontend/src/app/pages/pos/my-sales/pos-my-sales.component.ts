import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PosService } from '../../../shared/services/pos.service';
import { PosReceiptPrintService } from '../../../shared/services/pos-receipt-print.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { PosPageHeaderComponent } from '../shared/pos-page-header.component';

type SaleRow = { id: number; saleDate: string; totalAmount: number; paymentStatus: string };

type SaleDetail = {
  id: number;
  saleDate: string;
  createdAt: string;
  cashier: string;
  paymentMethod: string;
  paymentStatus: string;
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
  recent: SaleRow[] = [];
  lastUpdatedAt: Date | null = null;

  reprintingSaleId: number | null = null;
  showReprintAuthModal = false;
  reprintTarget: SaleRow | null = null;
  reprintAdminCode = '';
  reprintAuthBusy = false;
  showDetailModal = false;
  detailLoading = false;
  detailError = '';
  saleDetail: SaleDetail | null = null;

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

  constructor(
    private readonly pos: PosService,
    private readonly receiptPrint: PosReceiptPrintService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    this.from = start.toISOString().slice(0, 10);
    this.to = today.toISOString().slice(0, 10);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const r = await this.pos.getMySales(this.from || undefined, this.to || undefined) as {
        success: boolean;
        data?: {
          summary: { totalSales: number; transactionCount: number; totalDiscount: number };
          recent: SaleRow[];
        };
        message?: string;
      };
      if (!r.success || !r.data) {
        this.error = r.message ?? 'Failed to load sales.';
        this.summary = null;
        this.recent = [];
        return;
      }
      this.summary = r.data.summary;
      this.recent = r.data.recent ?? [];
      this.lastUpdatedAt = new Date();
    } finally {
      this.loading = false;
    }
  }

  async openSaleDetail(row: SaleRow): Promise<void> {
    this.showDetailModal = true;
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
    this.detailError = '';
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
}
