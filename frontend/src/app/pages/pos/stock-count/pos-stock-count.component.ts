import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogComponent } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import { NotificationService } from '../../../shared/services/notification.service';
import { PosService } from '../../../shared/services/pos.service';
import { formatWeightStock } from '../../../shared/utils/weight-stock.util';
import { PosPageHeaderComponent } from '../shared/pos-page-header.component';

type StockRow = {
  id: number;
  variantId: number;
  productName: string;
  variantName: string;
  category?: string | null;
  unitType: string | null;
  productSource: string;
  stockInGrams?: boolean;
  openingQty: number;
  closingQty: number | null;
  currentStock: number;
  soldQty: number;
  openingQtyKg?: number | null;
  closingQtyKg?: number | null;
  currentStockKg?: number | null;
  soldQtyKg?: number | null;
  /** Closing count in display units (kg for weight products). */
  closingInput: number | null;
};

type CountStatusFilter = '' | 'counted' | 'uncounted';

@Component({
  selector: 'app-pos-stock-count',
  standalone: true,
  imports: [CommonModule, FormsModule, PosPageHeaderComponent, ConfirmDialogComponent],
  templateUrl: './pos-stock-count.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosStockCountComponent implements OnInit {
  businessDate = '';
  loading = false;
  saving = false;
  error = '';
  search = '';
  productFilter = '';
  sourceFilter = '';
  statusFilter: CountStatusFilter = '';
  rows: StockRow[] = [];

  currentPage = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  private confirmAction: (() => void) | null = null;

  constructor(
    private readonly pos: PosService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    this.businessDate = this.todayManila();
    void this.load();
  }

  get productOptions(): string[] {
    return Array.from(
      new Set(
        this.rows
          .map((r) => String(r.productName ?? '').trim())
          .filter((name) => name.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  get sourceOptions(): string[] {
    return Array.from(
      new Set(
        this.rows
          .map((r) => String(r.productSource ?? '').trim())
          .filter((s) => s.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  get filteredRows(): StockRow[] {
    const q = this.search.trim().toLowerCase();
    const product = this.productFilter.trim().toLowerCase();
    const source = this.sourceFilter.trim().toLowerCase();
    const status = this.statusFilter;

    return this.rows.filter((r) => {
      if (q) {
        const haystack = `${r.productName} ${r.variantName} ${r.category ?? ''} ${r.unitType ?? ''} ${r.productSource}`
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (product && String(r.productName ?? '').trim().toLowerCase() !== product) return false;
      if (source && String(r.productSource ?? '').trim().toLowerCase() !== source) return false;
      if (status === 'counted' && !this.isCounted(r)) return false;
      if (status === 'uncounted' && this.isCounted(r)) return false;
      return true;
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  get paginatedRows(): StockRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get pageStart(): number {
    if (!this.filteredRows.length) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredRows.length);
  }

  get dirtyCount(): number {
    return this.rows.filter((r) => {
      const current = r.closingQty == null
        ? null
        : (r.stockInGrams ? Number(r.closingQtyKg) : Number(r.closingQty));
      const next = r.closingInput == null || String(r.closingInput) === '' ? null : Number(r.closingInput);
      return current !== next;
    }).length;
  }

  isCounted(row: StockRow): boolean {
    return row.closingInput != null && String(row.closingInput) !== '';
  }

  formatQty(row: StockRow, gramsValue: number, kgValue?: number | null): string {
    if (row.stockInGrams) {
      return formatWeightStock(gramsValue, true);
    }
    return Number(gramsValue).toLocaleString('en-PH', { maximumFractionDigits: 3 });
  }

  unitHint(row: StockRow): string {
    return row.stockInGrams ? 'Count in kilos (kg)' : (row.unitType || 'unit');
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
  }

  clearFilters(): void {
    this.search = '';
    this.productFilter = '';
    this.sourceFilter = '';
    this.statusFilter = '';
    this.currentPage = 1;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) this.currentPage = page;
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  prevPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const r = await this.pos.getDailyStock(this.businessDate || undefined);
      if (!r.success || !r.data) {
        this.error = r.message ?? 'Failed to load stock count.';
        this.rows = [];
        return;
      }
      this.businessDate = r.data.businessDate || this.businessDate;
      this.rows = (r.data.items ?? []).map((item) => {
        const stockInGrams = Boolean(item.stockInGrams);
        const closingDisplay = stockInGrams
          ? (item.closingQtyKg ?? null)
          : item.closingQty;
        return {
          ...item,
          category: item.category ?? null,
          stockInGrams,
          closingInput: closingDisplay,
        } as StockRow;
      });
      this.currentPage = Math.min(this.currentPage, this.totalPages);
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load stock count.';
      this.rows = [];
    } finally {
      this.loading = false;
    }
  }

  requestSave(): void {
    if (!this.dirtyCount) {
      this.notify.info('Nothing to save', 'No closing quantities were changed.');
      return;
    }
    this.openConfirm(
      'Save closing stock?',
      `Save ending counts for ${this.dirtyCount} product(s) on ${this.businessDate}?`,
      () => void this.save(),
    );
  }

  async save(): Promise<void> {
    this.saving = true;
    try {
      const items = this.rows.map((r) => ({
        variantId: r.variantId,
        closingQty:
          r.closingInput == null || String(r.closingInput) === ''
            ? null
            : Math.max(0, Number(r.closingInput)),
        closingInKilos: Boolean(r.stockInGrams),
      }));
      const r = await this.pos.saveDailyStock({
        businessDate: this.businessDate,
        items,
      });
      if (!r.success) {
        this.notify.error('Save failed', r.message ?? 'Unable to save stock counts.');
        return;
      }
      this.notify.success('Saved', `Updated ${r.data?.saved ?? 0} stock count(s).`);
      await this.load();
    } catch (e) {
      this.notify.error('Save failed', e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      this.saving = false;
    }
  }

  fillFromCurrent(row: StockRow): void {
    row.closingInput = row.stockInGrams
      ? (row.currentStockKg ?? 0)
      : row.currentStock;
  }

  private todayManila(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private openConfirm(title: string, message: string, action: () => void): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.confirmAction = action;
    this.confirmOpen = true;
  }

  onConfirm(): void {
    this.confirmOpen = false;
    const action = this.confirmAction;
    this.confirmAction = null;
    action?.();
  }

  onCancelConfirm(): void {
    this.confirmOpen = false;
    this.confirmAction = null;
  }
}
