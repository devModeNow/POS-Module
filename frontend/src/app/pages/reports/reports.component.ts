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
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
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

type ReportType =
  | 'sales' | 'jobs' | 'inventory' | 'low-stock' | 'payables-receivables'
  | 'pos-dashboard' | 'pos-completed-sales' | 'pos-top-products' | 'pos-sales-by-category' | 'pos-inventory-valuation' | 'pos-low-stock';

@Component({
  selector: 'app-reports',
  imports: [CommonModule, FormsModule, RouterModule, PageBreadcrumbComponent, ButtonComponent, NgApexchartsModule],
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
}
