import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import {
  PosCategorySalesRow,
  PosDailySalesReport,
  PosInventoryValuationRow,
  PosLowStockRow,
  PosService,
  PosTopProductRow,
} from '../../shared/services/pos.service';
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

type ReportType =
  | 'sales'
  | 'jobs'
  | 'inventory'
  | 'low-stock'
  | 'payables-receivables'
  | 'pos-daily-sales'
  | 'pos-top-products'
  | 'pos-sales-by-category'
  | 'pos-inventory-valuation'
  | 'pos-low-stock';

@Component({
  selector: 'app-reports',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent],
  templateUrl: './reports.component.html',
})
export class ReportsComponent implements OnInit {
  reportType: ReportType = 'sales';
  fromDate = this.today();
  toDate = this.today();
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

  posDailySales: PosDailySalesReport | null = null;
  posTopProducts: PosTopProductRow[] = [];
  posCategorySales: PosCategorySalesRow[] = [];
  posInventoryValuation: PosInventoryValuationRow[] = [];
  posLowStock: PosLowStockRow[] = [];

  readonly autoRepairReportTypes: Array<{ value: ReportType; label: string }> = [
    { value: 'sales', label: 'Sales Report' },
    { value: 'jobs', label: 'Jobs Done Report' },
    { value: 'payables-receivables', label: 'Sales Payables/Receivables Expense' },
    { value: 'inventory', label: 'Inventory Report' },
    { value: 'low-stock', label: 'Low Stocks Report' },
  ];

  readonly posReportTypes: Array<{ value: ReportType; label: string }> = [
    { value: 'pos-daily-sales', label: 'Daily Sales Summary' },
    { value: 'pos-top-products', label: 'Top Selling Products' },
    { value: 'pos-sales-by-category', label: 'Sales by Category' },
    { value: 'pos-inventory-valuation', label: 'Inventory Valuation' },
    { value: 'pos-low-stock', label: 'Low Stock Alert' },
  ];

  get reportTypes(): Array<{ value: ReportType; label: string }> {
    return this.isPosOrg ? this.posReportTypes : this.autoRepairReportTypes;
  }

  get needsDateRange(): boolean {
    return (
      this.reportType === 'sales' ||
      this.reportType === 'jobs' ||
      this.reportType === 'payables-receivables' ||
      this.reportType === 'pos-daily-sales' ||
      this.reportType === 'pos-top-products' ||
      this.reportType === 'pos-sales-by-category'
    );
  }

  constructor(
    private readonly svc: ReportsService,
    private readonly posSvc: PosService,
    private readonly orgSvc: OrgService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    this.isPosOrg = this.orgSvc.isPosOrg();
    if (this.isPosOrg) {
      this.reportType = 'pos-daily-sales';
    }
  }

  async generate(): Promise<void> {
    this.isLoading = true;
    try {
      if (this.reportType === 'sales') {
        const r = await this.svc.getSalesReport(this.fromDate, this.toDate);
        this.salesRows = r.data ?? [];
        this.salesSummary = r.summary ?? null;
      } else if (this.reportType === 'jobs') {
        const r = await this.svc.getJobsReport(this.fromDate, this.toDate);
        this.jobsRows = r.data ?? [];
        this.jobsSummary = r.summary ?? null;
      } else if (this.reportType === 'payables-receivables') {
        const r = await this.svc.getPayablesReceivablesReport(this.fromDate, this.toDate);
        this.payablesRows = r.data ?? [];
        this.payablesSummary = r.summary ?? null;
      } else if (this.reportType === 'inventory') {
        const r = await this.svc.getInventoryReport();
        this.inventoryRows = r.data ?? [];
        this.inventorySummary = r.summary ?? null;
      } else if (this.reportType === 'low-stock') {
        const r = await this.svc.getLowStockReport();
        this.lowStockRows = r.data ?? [];
      } else if (this.reportType === 'pos-daily-sales') {
        const r = await this.posSvc.getDailySalesReport(this.fromDate, this.toDate);
        if (!r.success) {
          this.notify.error('Error', r.message ?? 'Failed to generate report.');
          return;
        }
        this.posDailySales = r.data ?? null;
      } else if (this.reportType === 'pos-top-products') {
        const r = await this.posSvc.getTopProductsReport(this.fromDate, this.toDate);
        if (!r.success) {
          this.notify.error('Error', r.message ?? 'Failed to generate report.');
          return;
        }
        this.posTopProducts = r.data ?? [];
      } else if (this.reportType === 'pos-sales-by-category') {
        const r = await this.posSvc.getSalesByCategoryReport(this.fromDate, this.toDate);
        if (!r.success) {
          this.notify.error('Error', r.message ?? 'Failed to generate report.');
          return;
        }
        this.posCategorySales = r.data ?? [];
      } else if (this.reportType === 'pos-inventory-valuation') {
        const r = await this.posSvc.getInventoryValuationReport();
        if (!r.success) {
          this.notify.error('Error', r.message ?? 'Failed to generate report.');
          return;
        }
        this.posInventoryValuation = r.data ?? [];
      } else if (this.reportType === 'pos-low-stock') {
        const r = await this.posSvc.getLowStockReport();
        if (!r.success) {
          this.notify.error('Error', r.message ?? 'Failed to generate report.');
          return;
        }
        this.posLowStock = r.data ?? [];
      }
    } catch {
      this.notify.error('Error', 'Failed to generate report.');
    } finally {
      this.isLoading = false;
    }
  }

  formatPaymentMethod(mode: string): string {
    switch (mode) {
      case 'po_payment':
        return 'PO Payment';
      case 'cheque':
        return 'Cheque';
      default:
        return mode;
    }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
