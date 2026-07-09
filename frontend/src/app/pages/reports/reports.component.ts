import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexGrid,
  ApexLegend,
  ApexPlotOptions,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
  NgApexchartsModule,
} from 'ng-apexcharts';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { PosDashboardReport, PosService } from '../../shared/services/pos.service';
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
import { NotificationService } from '../../shared/services/notification.service';
import { ActionBusyService } from '../../shared/services/action-busy.service';

type ReportType =
  | 'sales' | 'jobs' | 'inventory' | 'low-stock' | 'payables-receivables'
  | 'pos-dashboard' | 'pos-top-products' | 'pos-sales-by-category' | 'pos-inventory-valuation' | 'pos-low-stock';

@Component({
  selector: 'app-reports',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, NgApexchartsModule],
  templateUrl: './reports.component.html',
})
export class ReportsComponent implements OnInit {
  reportType: ReportType = 'sales';
  fromDate = this.today();
  toDate = this.today();
  paymentStatusFilter = '';
  isLoading = false;
  isPosOrg = false;

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
  posTopProducts: Array<{ partName: string; category: string | null; quantitySold: number; totalAmount: number }> = [];
  posCategorySales: Array<{ category: string; quantitySold: number; totalAmount: number }> = [];
  posInventoryValuation: Array<{ category: string; itemCount: number; totalStock: number; retailValue: number }> = [];
  posLowStock: Array<{ partName: string; category: string | null; stockQty: number; stockWarning: number; sellingPrice: number }> = [];

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
    { value: 'pos-top-products', label: 'Top Selling Products' },
    { value: 'pos-sales-by-category', label: 'Sales by Category' },
    { value: 'pos-inventory-valuation', label: 'Inventory Valuation' },
    { value: 'pos-low-stock', label: 'Low Stock Alert' },
  ];

  get reportTypes() { return this.isPosOrg ? this.posReportTypes : this.autoRepairReportTypes; }

  get needsDateRange(): boolean {
    return ['sales', 'jobs', 'payables-receivables', 'pos-dashboard', 'pos-top-products', 'pos-sales-by-category'].includes(this.reportType);
  }

  constructor(
    private readonly svc: ReportsService,
    private readonly posSvc: PosService,
    private readonly orgSvc: OrgService,
    private readonly notify: NotificationService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  ngOnInit(): void {
    this.isPosOrg = this.orgSvc.isPosOrg();
    if (this.isPosOrg) {
      this.reportType = 'pos-dashboard';
    }
    this.setDefaultDateRange();
    void this.generate();
  }

  onReportTypeChange(): void {
    void this.generate();
  }

  onFiltersChange(): void {
    if (this.needsDateRange || (this.isPosOrg && this.reportType === 'pos-dashboard')) {
      void this.generate();
    }
  }

  hasReportData(): boolean {
    switch (this.reportType) {
      case 'pos-dashboard': return !!this.posDashboard?.summary;
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
        if (this.reportType === 'pos-dashboard') {
        const r = await this.posSvc.getDashboardReport(
          this.fromDate, this.toDate, this.paymentStatusFilter || undefined,
        );
        if (!r.success) { this.notify.error('Error', r.message ?? 'Failed.'); return; }
        this.posDashboard = r.data ?? null;
        this.buildCharts();
      } else if (this.reportType === 'pos-top-products') {
        const r = await this.posSvc.getTopProductsReport(this.fromDate, this.toDate);
        this.posTopProducts = r.data ?? [];
      } else if (this.reportType === 'pos-sales-by-category') {
        const r = await this.posSvc.getSalesByCategoryReport(this.fromDate, this.toDate);
        this.posCategorySales = r.data ?? [];
      } else if (this.reportType === 'pos-inventory-valuation') {
        const r = await this.posSvc.getInventoryValuationReport();
        this.posInventoryValuation = r.data ?? [];
      } else if (this.reportType === 'pos-low-stock') {
        const r = await this.posSvc.getLowStockReport();
        this.posLowStock = r.data ?? [];
      } else if (this.reportType === 'sales') {
        const r = await this.svc.getSalesReport(this.fromDate, this.toDate);
        this.salesRows = r.data ?? []; this.salesSummary = r.summary ?? null;
      } else if (this.reportType === 'jobs') {
        const r = await this.svc.getJobsReport(this.fromDate, this.toDate);
        this.jobsRows = r.data ?? []; this.jobsSummary = r.summary ?? null;
      } else if (this.reportType === 'payables-receivables') {
        const r = await this.svc.getPayablesReceivablesReport(this.fromDate, this.toDate);
        this.payablesRows = r.data ?? []; this.payablesSummary = r.summary ?? null;
      } else if (this.reportType === 'inventory') {
        const r = await this.svc.getInventoryReport();
        this.inventoryRows = r.data ?? []; this.inventorySummary = r.summary ?? null;
      } else {
        const r = await this.svc.getLowStockReport();
        this.lowStockRows = r.data ?? [];
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

  private today(): string { return new Date().toISOString().slice(0, 10); }

  private setDefaultDateRange(): void {
    const now = new Date();
    this.toDate = this.today();
    this.fromDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
}
