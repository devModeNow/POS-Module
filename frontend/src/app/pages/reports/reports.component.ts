import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { ReportsService, SalesReportRow, SalesReportSummary, JobsReportRow, JobsReportSummary, InventoryReportRow, InventoryReportSummary, PayablesReceivablesRow, PayablesReceivablesSummary } from '../../shared/services/reports.service';
import { NotificationService } from '../../shared/services/notification.service';

type ReportType = 'sales' | 'jobs' | 'inventory' | 'low-stock' | 'payables-receivables';

@Component({
  selector: 'app-reports',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent],
  templateUrl: './reports.component.html',
})
export class ReportsComponent {
  reportType: ReportType = 'sales';
  fromDate = this.today();
  toDate = this.today();
  isLoading = false;

  salesRows: SalesReportRow[] = [];
  salesSummary: SalesReportSummary | null = null;
  jobsRows: JobsReportRow[] = [];
  jobsSummary: JobsReportSummary | null = null;
  inventoryRows: InventoryReportRow[] = [];
  inventorySummary: InventoryReportSummary | null = null;
  lowStockRows: InventoryReportRow[] = [];
  payablesRows: PayablesReceivablesRow[] = [];
  payablesSummary: PayablesReceivablesSummary | null = null;

  readonly reportTypes: Array<{ value: ReportType; label: string }> = [
    { value: 'sales',     label: 'Sales Report' },
    { value: 'jobs',      label: 'Jobs Done Report' },
    { value: 'payables-receivables', label: 'Sales Payables/Receivables Expense' },
    { value: 'inventory', label: 'Inventory Report' },
    { value: 'low-stock', label: 'Low Stocks Report' },
  ];

  get needsDateRange(): boolean { return this.reportType === 'sales' || this.reportType === 'jobs' || this.reportType === 'payables-receivables'; }

  constructor(
    private readonly svc: ReportsService,
    private readonly notify: NotificationService,
  ) {}

  async generate(): Promise<void> {
    this.isLoading = true;
    try {
      if (this.reportType === 'sales') {
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
    } catch { this.notify.error('Error', 'Failed to generate report.'); }
    finally { this.isLoading = false; }
  }

  formatPaymentMethod(mode: string): string {
    switch (mode) {
      case 'po_payment': return 'PO Payment';
      case 'cheque': return 'Cheque';
      default: return mode;
    }
  }

  private today(): string { return new Date().toISOString().slice(0, 10); }
}
