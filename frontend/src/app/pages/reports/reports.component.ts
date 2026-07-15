import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexGrid,
  ApexPlotOptions,
  ApexStroke,
  NgApexchartsModule,
} from 'ng-apexcharts';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { PosCompletedSale, PosDashboardReport, PosSaleTransaction, PosService } from '../../shared/services/pos.service';
import {
  ReportsService,
  SalesReportRow,
  SalesReportSummary,
  JobsReportRow,
  JobsReportSummary,
  InventoryReportRow,
  InventoryReportSummary,
  PayablesReceivablesRow,
  PayablesReceivablesSummary,
} from '../../shared/services/reports.service';
import { OrgService } from '../../shared/services/org.service';
import { RbacService } from '../../shared/services/rbac.service';
import { NotificationService } from '../../shared/services/notification.service';
import { ActionBusyService } from '../../shared/services/action-busy.service';
import ExcelJS from 'exceljs/dist/exceljs.min.js';

type ReportType =
  | 'sales' | 'jobs' | 'inventory' | 'low-stock' | 'payables-receivables'
  | 'pos-dashboard' | 'pos-completed-sales' | 'pos-top-products' | 'pos-sales-by-category' | 'pos-inventory-valuation' | 'pos-low-stock';

@Component({
  selector: 'app-reports',
  imports: [CommonModule, FormsModule, RouterModule, PageBreadcrumbComponent, NgApexchartsModule],
  templateUrl: './reports.component.html',
})
export class ReportsComponent implements OnInit {
  reportType: ReportType = 'sales';
  fromDate = this.today();
  toDate = this.today();
  paymentStatusFilter = '';
  isLoading = false;
  isPosOrg = false;

  page = 1;
  pageSize = 20;
  totalItems = 0;
  readonly pageSizeOptions = [10, 20, 50, 100];

  salesRows: SalesReportRow[] = [];
  salesSummary: SalesReportSummary | null = null;
  jobsRows: JobsReportRow[] = [];
  jobsSummary: JobsReportSummary | null = null;
  inventoryRows: InventoryReportRow[] = [];
  inventorySummary: InventoryReportSummary | null = null;
  lowStockRows: InventoryReportRow[] = [];
  payablesRows: PayablesReceivablesRow[] = [];
  payablesSummary: PayablesReceivablesSummary | null = null;

  posDashboard: PosDashboardReport | null = null;
  posTransactions: PosSaleTransaction[] = [];
  updatingTransactionId: number | null = null;
  posTopProducts: Array<{ partName: string; category: string | null; quantitySold: number; totalAmount: number }> = [];
  posCategorySales: Array<{ category: string; quantitySold: number; totalAmount: number }> = [];
  posInventoryValuation: Array<{ category: string; itemCount: number; totalStock: number; retailValue: number }> = [];
  posLowStock: Array<{ partName: string; category: string | null; stockQty: number; stockWarning: number; sellingPrice: number }> = [];
  posCompletedSales: PosCompletedSale[] = [];

  salesChartSeries: ApexAxisChartSeries = [{ name: 'Sales', data: [] }];
  salesChartCategories: string[] = [];
  categoryChartSeries: ApexAxisChartSeries = [{ name: 'Revenue', data: [] }];
  categoryChartCategories: string[] = [];
  paymentChartSeries: ApexAxisChartSeries = [{ name: 'Amount', data: [] }];
  paymentChartCategories: string[] = [];

  readonly chartBase: ApexChart = { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'Outfit, sans-serif' };
  readonly chartColors = ['#10b981', '#465fff', '#f59e0b', '#ef4444'];
  readonly chartPlot: ApexPlotOptions = { bar: { borderRadius: 6, columnWidth: '55%' } };
  readonly chartGrid: ApexGrid = { strokeDashArray: 4 };
  readonly chartDataLabels: ApexDataLabels = { enabled: false };
  readonly chartStroke: ApexStroke = { show: true, width: 2, colors: ['transparent'] };

  readonly autoRepairReportTypes: Array<{ value: ReportType; label: string }> = [
    { value: 'sales', label: 'Sales Report' },
    { value: 'jobs', label: 'Jobs Done Report' },
    { value: 'payables-receivables', label: 'Sales Payables/Receivables Expense' },
    { value: 'inventory', label: 'Inventory Report' },
    { value: 'low-stock', label: 'Low Stocks Report' },
  ];

  readonly posReportTypes: Array<{ value: ReportType; label: string }> = [
    { value: 'pos-dashboard', label: 'Store Dashboard' },
    { value: 'pos-completed-sales', label: 'Completed Sales' },
    { value: 'pos-top-products', label: 'Top Selling Products' },
    { value: 'pos-sales-by-category', label: 'Sales by Category' },
    { value: 'pos-inventory-valuation', label: 'Inventory Valuation' },
    { value: 'pos-low-stock', label: 'Low Stock Alert' },
  ];

  get reportTypes() { return this.isPosOrg ? this.posReportTypes : this.autoRepairReportTypes; }

  get needsDateRange(): boolean {
    return ['sales', 'jobs', 'payables-receivables', 'pos-dashboard', 'pos-completed-sales', 'pos-top-products', 'pos-sales-by-category'].includes(this.reportType);
  }

  get usesServerPagination(): boolean {
    return this.reportType === 'pos-dashboard' || this.reportType === 'pos-completed-sales';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  get showPagination(): boolean {
    return this.totalItems > this.pageSize;
  }

  get pageRangeStart(): number {
    return this.totalItems === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get pageRangeEnd(): number {
    return Math.min(this.page * this.pageSize, this.totalItems);
  }

  constructor(
    private readonly svc: ReportsService,
    private readonly posSvc: PosService,
    private readonly orgSvc: OrgService,
    private readonly rbac: RbacService,
    private readonly notify: NotificationService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  ngOnInit(): void {
    this.isPosOrg = this.orgSvc.isPosOrg() || this.rbac.isPosOrg();
    if (this.isPosOrg) {
      this.reportType = 'pos-dashboard';
    }
    this.setDefaultDateRange();
    void this.generate();
  }

  onReportTypeChange(): void {
    this.page = 1;
    void this.generate();
  }

  onFiltersChange(): void {
    if (this.needsDateRange) {
      this.page = 1;
      void this.generate();
    }
  }

  onPageSizeChange(): void {
    this.page = 1;
    if (this.usesServerPagination) {
      void this.generate();
    }
  }

  goToPage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages || nextPage === this.page) return;
    this.page = nextPage;
    if (this.usesServerPagination) {
      void this.generate();
    }
  }

  prevPage(): void { this.goToPage(this.page - 1); }
  nextPage(): void { this.goToPage(this.page + 1); }

  pageSlice<T>(rows: T[]): T[] {
    if (this.usesServerPagination) return rows;
    const start = (this.page - 1) * this.pageSize;
    return rows.slice(start, start + this.pageSize);
  }

  hasReportData(): boolean {
    switch (this.reportType) {
      case 'pos-dashboard': return !!this.posDashboard?.summary;
      case 'pos-completed-sales': return this.totalItems > 0 || this.posCompletedSales.length > 0;
      case 'pos-top-products': return this.posTopProducts.length > 0;
      case 'pos-sales-by-category': return this.posCategorySales.length > 0;
      case 'pos-inventory-valuation': return this.posInventoryValuation.length > 0;
      case 'pos-low-stock': return this.posLowStock.length > 0;
      case 'sales': return this.salesRows.length > 0 || !!this.salesSummary;
      case 'jobs': return this.jobsRows.length > 0 || !!this.jobsSummary;
      case 'payables-receivables': return this.payablesRows.length > 0 || !!this.payablesSummary;
      case 'inventory': return this.inventoryRows.length > 0 || !!this.inventorySummary;
      case 'low-stock': return this.lowStockRows.length > 0;
      default: return false;
    }
  }

  async generate(): Promise<void> {
    this.isLoading = true;
    try {
      await this.actionBusy.run('reports-generate', async () => {
        const offset = (this.page - 1) * this.pageSize;

        if (this.reportType === 'pos-dashboard') {
          const r = await this.posSvc.getDashboardReport(
            this.fromDate, this.toDate, this.paymentStatusFilter || undefined,
          );
          if (!r.success) { this.notify.error('Error', r.message ?? 'Failed.'); return; }
          this.posDashboard = r.data ?? null;
          this.buildCharts();
          const tx = await this.posSvc.getSaleTransactions(
            this.fromDate, this.toDate, this.paymentStatusFilter || undefined, this.pageSize, offset,
          );
          this.posTransactions = tx.success ? (tx.data ?? []) : [];
          this.totalItems = tx.success ? (tx.total ?? this.posTransactions.length) : 0;
        } else if (this.reportType === 'pos-completed-sales') {
          const r = await this.posSvc.getCompletedSalesReport(this.fromDate, this.toDate, this.pageSize, offset);
          if (!r?.success) {
            this.notify.error('Error', r?.message ?? 'Failed to load completed sales.');
            this.posCompletedSales = [];
            this.totalItems = 0;
            return;
          }
          this.posCompletedSales = r.data ?? [];
          this.totalItems = r.total ?? this.posCompletedSales.length;
        } else if (this.reportType === 'pos-top-products') {
          const r = await this.posSvc.getTopProductsReport(this.fromDate, this.toDate);
          this.posTopProducts = r.data ?? [];
          this.totalItems = this.posTopProducts.length;
        } else if (this.reportType === 'pos-sales-by-category') {
          const r = await this.posSvc.getSalesByCategoryReport(this.fromDate, this.toDate);
          this.posCategorySales = r.data ?? [];
          this.totalItems = this.posCategorySales.length;
        } else if (this.reportType === 'pos-inventory-valuation') {
          const r = await this.posSvc.getInventoryValuationReport();
          this.posInventoryValuation = r.data ?? [];
          this.totalItems = this.posInventoryValuation.length;
        } else if (this.reportType === 'pos-low-stock') {
          const r = await this.posSvc.getLowStockReport();
          this.posLowStock = r.data ?? [];
          this.totalItems = this.posLowStock.length;
        } else if (this.reportType === 'sales') {
          const r = await this.svc.getSalesReport(this.fromDate, this.toDate);
          this.salesRows = r.data ?? []; this.salesSummary = r.summary ?? null;
          this.totalItems = this.salesRows.length;
        } else if (this.reportType === 'jobs') {
          const r = await this.svc.getJobsReport(this.fromDate, this.toDate);
          this.jobsRows = r.data ?? []; this.jobsSummary = r.summary ?? null;
          this.totalItems = this.jobsRows.length;
        } else if (this.reportType === 'payables-receivables') {
          const r = await this.svc.getPayablesReceivablesReport(this.fromDate, this.toDate);
          this.payablesRows = r.data ?? []; this.payablesSummary = r.summary ?? null;
          this.totalItems = this.payablesRows.length;
        } else if (this.reportType === 'inventory') {
          const r = await this.svc.getInventoryReport();
          this.inventoryRows = r.data ?? []; this.inventorySummary = r.summary ?? null;
          this.totalItems = this.inventoryRows.length;
        } else {
          const r = await this.svc.getLowStockReport();
          this.lowStockRows = r.data ?? [];
          this.totalItems = this.lowStockRows.length;
        }
      });
    } catch { this.notify.error('Error', 'Failed to generate report.'); }
    finally { this.isLoading = false; }
  }

  private buildCharts(): void {
    if (!this.posDashboard) return;
    this.salesChartCategories = this.posDashboard.byDay.map((d) => d.saleDate);
    this.salesChartSeries = [{
      name: 'Settled',
      data: this.posDashboard.byDay.map((d) => d.settledSales),
    }, {
      name: 'Floating',
      data: this.posDashboard.byDay.map((d) => d.floatingSales),
    }];
    this.categoryChartCategories = this.posDashboard.byCategory.map((c) => c.category);
    this.categoryChartSeries = [{ name: 'Revenue', data: this.posDashboard.byCategory.map((c) => c.totalAmount) }];
    this.paymentChartCategories = this.posDashboard.byPayment.map((p) => `${p.methodName} (${p.paymentStatus})`);
    this.paymentChartSeries = [{ name: 'Amount', data: this.posDashboard.byPayment.map((p) => p.totalAmount) }];
  }

  formatPaymentMethod(mode: string): string {
    switch (mode) {
      case 'po_payment': return 'PO Payment';
      case 'cheque': return 'Cheque';
      default: return mode;
    }
  }

  async updatePaymentStatus(row: PosSaleTransaction, status: 'settled' | 'floating'): Promise<void> {
    if (row.paymentStatus === status) return;
    this.updatingTransactionId = row.id;
    try {
      const r = await this.posSvc.updateTransactionPaymentStatus(row.id, status);
      if (!r.success) {
        this.notify.error('Error', r.message ?? 'Failed to update payment status.');
        return;
      }
      this.notify.success('Updated', r.message ?? 'Payment status updated.');
      await this.generate();
    } catch {
      this.notify.error('Error', 'Failed to update payment status.');
    } finally {
      this.updatingTransactionId = null;
    }
  }

  paymentStatusLabel(status: string): string {
    return status === 'floating' ? 'Floating' : 'Settled';
  }

  formatDateTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private today(): string { return new Date().toISOString().slice(0, 10); }

  private setDefaultDateRange(): void {
    const now = new Date();
    this.toDate = this.today();
    this.fromDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }

  // ── Export ────────────────────────────────────────────────────────────

  get reportTypeLabel(): string {
    return this.reportTypes.find((rt) => rt.value === this.reportType)?.label ?? this.reportType;
  }

  canExport(): boolean {
    return !this.isLoading && this.hasReportData();
  }

  private exportMoney(value: number | null | undefined): string {
    return `₱${Number(value ?? 0).toFixed(2)}`;
  }

  private exportDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  }

  getExportRows(): { headers: string[]; rows: (string | number)[][] } {
    switch (this.reportType) {
      case 'sales':
        return {
          headers: ['Date', 'Mode', 'Transactions', 'Total'],
          rows: this.salesRows.map((r) => [this.exportDate(r.date), r.mode, r.transactionCount, this.exportMoney(r.totalAmount)]),
        };
      case 'payables-receivables':
        return {
          headers: ['Date', 'JO No.', 'Customer', 'Payment Method', 'Due Date/PDC', 'Amount'],
          rows: this.payablesRows.map((r) => [
            this.exportDate(r.date), r.joNumber, r.customerName, this.formatPaymentMethod(r.paymentMethod),
            r.dueDatePdc ? this.exportDate(r.dueDatePdc) : '—', this.exportMoney(r.amount),
          ]),
        };
      case 'jobs':
        return {
          headers: ['JO #', 'Vehicle', 'Customer', 'Mechanic', 'Total', 'Completed'],
          rows: this.jobsRows.map((r) => [
            r.joNumber, `${r.plateNumber} — ${r.make} ${r.model}`, r.customerName, r.mechanicName || '—',
            this.exportMoney(r.totalAmount), this.exportDate(r.completedAt),
          ]),
        };
      case 'inventory':
        return {
          headers: ['Part Name', 'Category / Brand', 'Stock', 'Cost', 'Selling', 'Stock Value'],
          rows: this.inventoryRows.map((r) => [
            r.partName, `${r.category || '—'} / ${r.brand || '—'}`, r.stockQty,
            this.exportMoney(r.costPrice), this.exportMoney(r.sellingPrice), this.exportMoney(r.stockValue),
          ]),
        };
      case 'low-stock':
        return {
          headers: ['Part Name', 'Category / Brand', 'Stock', 'Warning Level', 'Selling Price'],
          rows: this.lowStockRows.map((r) => [
            r.partName, `${r.category || '—'} / ${r.brand || '—'}`, r.stockQty, r.stockWarning, this.exportMoney(r.sellingPrice),
          ]),
        };
      case 'pos-dashboard':
        return {
          headers: ['Date', 'Cashier', 'Payment', 'Items', 'Total', 'Status'],
          rows: this.posTransactions.map((r) => [
            r.saleDate, r.cashier, r.paymentMethod, r.itemCount, this.exportMoney(r.totalAmount), this.paymentStatusLabel(r.paymentStatus),
          ]),
        };
      case 'pos-completed-sales':
        return {
          headers: ['Completed', 'Cashier', 'Notification', 'Payment', 'Items', 'Total', 'Status'],
          rows: this.posCompletedSales.map((r) => [
            this.formatDateTime(r.completedAt), r.cashier, `${r.title} — ${r.body}`, r.paymentMethod,
            r.itemCount, this.exportMoney(r.totalAmount), this.paymentStatusLabel(r.paymentStatus),
          ]),
        };
      case 'pos-top-products':
        return {
          headers: ['Product', 'Category', 'Qty Sold', 'Revenue'],
          rows: this.posTopProducts.map((r) => [r.partName, r.category || '—', r.quantitySold, this.exportMoney(r.totalAmount)]),
        };
      case 'pos-sales-by-category':
        return {
          headers: ['Category', 'Qty Sold', 'Revenue'],
          rows: this.posCategorySales.map((r) => [r.category, r.quantitySold, this.exportMoney(r.totalAmount)]),
        };
      case 'pos-inventory-valuation':
        return {
          headers: ['Category', 'Items', 'Total Stock', 'Retail Value'],
          rows: this.posInventoryValuation.map((r) => [r.category, r.itemCount, r.totalStock, this.exportMoney(r.retailValue)]),
        };
      case 'pos-low-stock':
        return {
          headers: ['Product', 'Category', 'Stock', 'Warning', 'Price'],
          rows: this.posLowStock.map((r) => [r.partName, r.category || '—', r.stockQty, r.stockWarning, this.exportMoney(r.sellingPrice)]),
        };
      default:
        return { headers: [], rows: [] };
    }
  }

  private exportFileSlug(): string {
    return `${this.reportType}-${this.today()}`;
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportCsv(): void {
    const { headers, rows } = this.getExportRows();
    if (!rows.length) return;
    const escape = (val: string | number): string => {
      const s = String(val ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, `${this.exportFileSlug()}.csv`);
  }

  async exportExcel(): Promise<void> {
    const { headers, rows } = this.getExportRows();
    if (!rows.length) return;
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(this.reportTypeLabel.slice(0, 31));
      sheet.columns = headers.map((h: string) => ({ width: Math.max(14, h.length + 4) }));
      const headerRow = sheet.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell: { fill: unknown }) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      });
      rows.forEach((row) => sheet.addRow(row));
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      this.downloadBlob(blob, `${this.exportFileSlug()}.xlsx`);
    } catch {
      this.notify.error('Error', 'Failed to export Excel file.');
    }
  }

  exportPdf(): void {
    const { headers, rows } = this.getExportRows();
    if (!rows.length) return;
    const escapeHtml = (val: string | number): string =>
      String(val ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const title = this.reportTypeLabel;
    const rangeText = this.needsDateRange
      ? `${this.exportDate(this.fromDate)} – ${this.exportDate(this.toDate)}`
      : new Date().toLocaleDateString('en-PH');
    const theadHtml = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
    const tbodyHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.meta { margin: 0 0 16px; font-size: 12px; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #f3f4f6; }
  tr:nth-child(even) td { background: #fafafa; }
  @media print { body { padding: 0; } }
</style></head><body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated ${new Date().toLocaleString('en-PH')} · ${escapeHtml(rangeText)}</p>
  <table><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>
  <script>window.onload = function(){ window.focus(); window.print(); }<\/script>
</body></html>`;
    const win = window.open('', '_blank', 'width=960,height=720');
    if (!win) {
      this.notify.error('Error', 'Please allow pop-ups to export as PDF.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}

