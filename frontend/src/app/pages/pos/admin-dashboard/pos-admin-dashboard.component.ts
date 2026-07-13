import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexGrid,
  ApexPlotOptions,
  ApexStroke,
  ApexXAxis,
  NgApexchartsModule,
} from 'ng-apexcharts';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ActionBusyService } from '../../../shared/services/action-busy.service';
import { PosDashboardReport, PosSaleTransaction, PosService } from '../../../shared/services/pos.service';

type KpiWidgetId =
  | 'kpi-total'
  | 'kpi-settled'
  | 'kpi-floating'
  | 'kpi-transactions'
  | 'kpi-discounts'
  | 'kpi-staff'
  | 'kpi-low-stock';

type ChartWidgetId = 'chart-daily' | 'chart-category' | 'chart-payment';
type ChartVisualType = 'bar' | 'donut';

type WidgetId =
  | KpiWidgetId
  | ChartWidgetId
  | 'list-staff'
  | 'list-low-stock';

const DEFAULT_WIDGETS: WidgetId[] = [
  'kpi-total',
  'kpi-settled',
  'kpi-floating',
  'kpi-transactions',
  'kpi-discounts',
  'kpi-staff',
  'kpi-low-stock',
  'chart-daily',
  'chart-category',
  'chart-payment',
  'list-staff',
  'list-low-stock',
];

const LAYOUT_KEY = 'pos-admin-dashboard-layout-v1';
const SIZES_KEY = 'pos-admin-dashboard-sizes-v1';

@Component({
  selector: 'app-pos-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, NgApexchartsModule, PageBreadcrumbComponent],
  templateUrl: './pos-admin-dashboard.component.html',
  styles: `
    .widget-drag-handle { cursor: grab; }
    .widget-drag-handle:active { cursor: grabbing; }
    .widget-resizable { resize: both; overflow: auto; min-width: 140px; min-height: 96px; }
    .widget-resizable-chart { resize: both; overflow: hidden; min-width: 280px; min-height: 280px; }
    .widget-resizable-list { resize: both; overflow: auto; min-width: 280px; min-height: 220px; }
    .cdk-drag-preview { box-sizing: border-box; opacity: 0.9; }
    .cdk-drag-placeholder { opacity: 0.35; }
    .cdk-drag-animating { transition: transform 200ms cubic-bezier(0, 0, 0.2, 1); }
  `,
})
export class PosAdminDashboardComponent implements OnInit {
  loading = false;
  period: 'daily' | 'weekly' | 'monthly' = 'monthly';
  report: PosDashboardReport | null = null;
  onDutyStaff: Array<{ userId: number; fullname: string; roleName: string | null; lastSeen: string }> = [];
  lowStock: Array<{ partName: string; category: string | null; stockQty: number; stockWarning: number; sellingPrice: number }> = [];
  widgetOrder: WidgetId[] = [...DEFAULT_WIDGETS];
  widgetSizes: Partial<Record<WidgetId, { w: number; h: number }>> = {};

  detailModalOpen = false;
  detailKpiId: KpiWidgetId | null = null;
  detailLoading = false;
  detailTransactions: PosSaleTransaction[] = [];
  updatingTransactionId: number | null = null;

  salesChartSeries: ApexAxisChartSeries = [];
  salesChartCategories: string[] = [];
  categoryChartSeries: ApexAxisChartSeries = [{ name: 'Revenue', data: [] }];
  categoryChartCategories: string[] = [];
  paymentChartSeries: ApexAxisChartSeries = [{ name: 'Amount', data: [] }];
  paymentChartCategories: string[] = [];

  salesDonutSeries: number[] = [];
  salesDonutLabels: string[] = [];
  categoryDonutSeries: number[] = [];
  categoryDonutLabels: string[] = [];
  paymentDonutSeries: number[] = [];
  paymentDonutLabels: string[] = [];

  chartTypes: Record<ChartWidgetId, ChartVisualType> = {
    'chart-daily': 'bar',
    'chart-category': 'bar',
    'chart-payment': 'bar',
  };

  readonly chartBase: ApexChart = { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'Outfit, sans-serif' };
  readonly donutChartBase: ApexChart = { type: 'donut', height: 260, toolbar: { show: false }, fontFamily: 'Outfit, sans-serif' };
  readonly chartColors = ['#10b981', '#f59e0b', '#465fff', '#ef4444', '#8b5cf6', '#ec4899'];
  readonly chartPlot: ApexPlotOptions = { bar: { borderRadius: 4, columnWidth: '55%' } };
  readonly donutPlot: ApexPlotOptions = { pie: { donut: { size: '62%', labels: { show: true, name: { show: true }, value: { show: true }, total: { show: true, label: 'Total' } } } } };
  readonly chartGrid: ApexGrid = { strokeDashArray: 4 };
  readonly chartDataLabels: ApexDataLabels = { enabled: false };
  readonly donutDataLabels: ApexDataLabels = { enabled: true, formatter: (val: number) => `${Math.round(val)}%` };
  readonly chartStroke: ApexStroke = { show: true, width: 2, colors: ['transparent'] };

  readonly widgetMeta: Record<WidgetId, { label: string; span: 'kpi' | 'chart' | 'list' }> = {
    'kpi-total': { label: 'Total Sales', span: 'kpi' },
    'kpi-settled': { label: 'Settled', span: 'kpi' },
    'kpi-floating': { label: 'Floating', span: 'kpi' },
    'kpi-transactions': { label: 'Transactions', span: 'kpi' },
    'kpi-discounts': { label: 'Discounts', span: 'kpi' },
    'kpi-staff': { label: 'On-Duty Staff', span: 'kpi' },
    'kpi-low-stock': { label: 'Low Stock Items', span: 'kpi' },
    'chart-daily': { label: 'Daily Sales Trend', span: 'chart' },
    'chart-category': { label: 'Sales by Category', span: 'chart' },
    'chart-payment': { label: 'Payment Methods', span: 'chart' },
    'list-staff': { label: 'Active Cashiers', span: 'list' },
    'list-low-stock': { label: 'Low Stock Alert', span: 'list' },
  };

  constructor(
    private readonly pos: PosService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  ngOnInit(): void {
    this.loadLayout();
    this.loadWidgetSizes();
    void this.refresh();
  }

  get kpiWidgets(): KpiWidgetId[] {
    return this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'kpi') as KpiWidgetId[];
  }

  get chartWidgets(): WidgetId[] {
    return this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'chart');
  }

  get listWidgets(): WidgetId[] {
    return this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'list');
  }

  get detailModalTitle(): string {
    if (!this.detailKpiId) return 'Details';
    return this.widgetMeta[this.detailKpiId].label;
  }

  get isTransactionKpi(): boolean {
    return !!this.detailKpiId && ['kpi-total', 'kpi-settled', 'kpi-floating', 'kpi-transactions', 'kpi-discounts'].includes(this.detailKpiId);
  }

  async openKpiDetail(id: KpiWidgetId): Promise<void> {
    this.detailKpiId = id;
    this.detailModalOpen = true;
    this.detailTransactions = [];

    if (id === 'kpi-staff' || id === 'kpi-low-stock') {
      this.detailLoading = false;
      return;
    }

    this.detailLoading = true;
    try {
      const { from, to } = this.periodRange();
      let paymentStatus: string | undefined;
      if (id === 'kpi-settled') paymentStatus = 'settled';
      if (id === 'kpi-floating') paymentStatus = 'floating';

      const r = await this.pos.getSaleTransactions(from, to, paymentStatus, 100, 0);
      this.detailTransactions = r.success ? (r.data ?? []) : [];
    } finally {
      this.detailLoading = false;
    }
  }

  closeKpiDetail(): void {
    this.detailModalOpen = false;
    this.detailKpiId = null;
    this.detailTransactions = [];
  }

  formatMoney(value: number): string {
    return this.money(value);
  }

  formatDateTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  paymentStatusLabel(status: string): string {
    return status === 'floating' ? 'Floating' : 'Settled';
  }

  async updatePaymentStatus(row: PosSaleTransaction, status: 'settled' | 'floating'): Promise<void> {
    if (row.paymentStatus === status) return;
    this.updatingTransactionId = row.id;
    try {
      const r = await this.pos.updateTransactionPaymentStatus(row.id, status);
      if (r?.success) {
        row.paymentStatus = status;
        await this.refresh();
        if (this.detailModalOpen && this.isTransactionKpi) {
          const { from, to } = this.periodRange();
          let paymentStatus: string | undefined;
          if (this.detailKpiId === 'kpi-settled') paymentStatus = 'settled';
          if (this.detailKpiId === 'kpi-floating') paymentStatus = 'floating';
          const tx = await this.pos.getSaleTransactions(from, to, paymentStatus, 100, 0);
          this.detailTransactions = tx.success ? (tx.data ?? []) : [];
        }
      }
    } finally {
      this.updatingTransactionId = null;
    }
  }

  widgetStyle(id: WidgetId): Record<string, string> {
    const size = this.widgetSizes[id];
    if (!size) return {};
    return { width: `${size.w}px`, height: `${size.h}px` };
  }

  onWidgetSized(id: WidgetId, event: Event): void {
    const el = event.currentTarget as HTMLElement;
    if (!el?.offsetWidth) return;
    this.widgetSizes[id] = { w: el.offsetWidth, h: el.offsetHeight };
    this.saveWidgetSizes();
  }

  settledAmount(): number {
    return this.report?.summary?.settledSales ?? 0;
  }

  floatingAmount(): number {
    return this.report?.summary?.floatingSales ?? 0;
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      await this.actionBusy.run('pos-admin-dashboard', async () => {
        const { from, to } = this.periodRange();
        const [reportRes, staffRes, lowStockRes] = await Promise.all([
          this.pos.getDashboardReport(from, to),
          this.pos.getOnDutyStaff(30),
          this.pos.getLowStockReport(),
        ]);
        this.report = reportRes.success ? (reportRes.data ?? null) : null;
        this.onDutyStaff = (staffRes.success ? (staffRes.data ?? []) : []) as typeof this.onDutyStaff;
        this.lowStock = (lowStockRes.success ? (lowStockRes.data ?? []) : []) as typeof this.lowStock;
        this.buildCharts();
      });
    } finally {
      this.loading = false;
    }
  }

  onPeriodChange(): void {
    void this.refresh();
  }

  isChartWidget(id: WidgetId): id is ChartWidgetId {
    return id === 'chart-daily' || id === 'chart-category' || id === 'chart-payment';
  }

  chartVisualType(id: ChartWidgetId): ChartVisualType {
    return this.chartTypes[id];
  }

  setChartVisualType(id: ChartWidgetId, type: ChartVisualType): void {
    this.chartTypes[id] = type;
  }

  onWidgetDrop(event: CdkDragDrop<WidgetId[]>): void {
    moveItemInArray(this.widgetOrder, event.previousIndex, event.currentIndex);
    this.saveLayout();
  }

  onKpiDrop(event: CdkDragDrop<WidgetId[]>): void {
    const ids = [...this.kpiWidgets];
    moveItemInArray(ids, event.previousIndex, event.currentIndex);
    this.reorderSection('kpi', ids);
  }

  onChartDrop(event: CdkDragDrop<WidgetId[]>): void {
    const ids = [...this.chartWidgets];
    moveItemInArray(ids, event.previousIndex, event.currentIndex);
    this.reorderSection('chart', ids);
  }

  onListDrop(event: CdkDragDrop<WidgetId[]>): void {
    const ids = [...this.listWidgets];
    moveItemInArray(ids, event.previousIndex, event.currentIndex);
    this.reorderSection('list', ids);
  }

  kpiValue(id: WidgetId): string {
    const s = this.report?.summary;
    switch (id) {
      case 'kpi-total': return this.money(s?.totalSales ?? 0);
      case 'kpi-settled': return this.money(s?.settledSales ?? 0);
      case 'kpi-floating': return this.money(s?.floatingSales ?? 0);
      case 'kpi-transactions': return String(s?.transactionCount ?? 0);
      case 'kpi-discounts': return this.money(s?.totalDiscount ?? 0);
      case 'kpi-staff': return String(this.onDutyStaff.length);
      case 'kpi-low-stock': return String(this.lowStock.length);
      default: return '—';
    }
  }

  kpiColor(id: WidgetId): string {
    switch (id) {
      case 'kpi-settled': return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300';
      case 'kpi-floating': return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300';
      case 'kpi-staff': return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-500/10 dark:text-blue-300';
      case 'kpi-low-stock': return 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-300';
      default: return 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
    }
  }

  private reorderSection(span: 'kpi' | 'chart' | 'list', ordered: WidgetId[]): void {
    const others = this.widgetOrder.filter((id) => this.widgetMeta[id].span !== span);
    const firstOtherIdx = this.widgetOrder.findIndex((id) => this.widgetMeta[id].span !== span);
    if (firstOtherIdx === -1) {
      this.widgetOrder = ordered;
    } else {
      const before = this.widgetOrder.slice(0, firstOtherIdx).filter((id) => this.widgetMeta[id].span === span);
      if (before.length) {
        const afterFirst = this.widgetOrder.slice(firstOtherIdx);
        this.widgetOrder = [...before, ...ordered, ...afterFirst.filter((id) => this.widgetMeta[id].span !== span && !before.includes(id))];
      } else {
        this.widgetOrder = [...ordered, ...others];
      }
    }
    // Rebuild maintaining section order: kpi, chart, list
    const kpis = ordered.length && span === 'kpi' ? ordered : this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'kpi');
    const charts = span === 'chart' ? ordered : this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'chart');
    const lists = span === 'list' ? ordered : this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'list');
    if (span === 'kpi') this.widgetOrder = [...ordered, ...charts, ...lists];
    else if (span === 'chart') this.widgetOrder = [...kpis, ...ordered, ...lists];
    else this.widgetOrder = [...kpis, ...charts, ...ordered];
    this.saveLayout();
  }

  private buildCharts(): void {
    if (!this.report) return;
    this.salesChartCategories = this.report.byDay.map((d) => d.saleDate);
    this.salesChartSeries = [
      { name: 'Settled', data: this.report.byDay.map((d) => d.settledSales) },
      { name: 'Floating', data: this.report.byDay.map((d) => d.floatingSales) },
    ];
    this.salesDonutLabels = this.report.byDay.map((d) => d.saleDate);
    this.salesDonutSeries = this.report.byDay.map((d) => d.settledSales + d.floatingSales);

    this.categoryChartCategories = this.report.byCategory.map((c) => c.category);
    this.categoryChartSeries = [{ name: 'Revenue', data: this.report.byCategory.map((c) => c.totalAmount) }];
    this.categoryDonutLabels = this.report.byCategory.map((c) => c.category);
    this.categoryDonutSeries = this.report.byCategory.map((c) => c.totalAmount);

    this.paymentChartCategories = this.report.byPayment.map((p) => `${p.methodName} (${p.paymentStatus})`);
    this.paymentChartSeries = [{ name: 'Amount', data: this.report.byPayment.map((p) => p.totalAmount) }];
    this.paymentDonutLabels = this.report.byPayment.map((p) => `${p.methodName} (${p.paymentStatus})`);
    this.paymentDonutSeries = this.report.byPayment.map((p) => p.totalAmount);
  }

  private periodRange(): { from: string; to: string } {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    if (this.period === 'daily') return { from: to, to };
    if (this.period === 'weekly') {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { from: start.toISOString().slice(0, 10), to };
    }
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start.toISOString().slice(0, 10), to };
  }

  private money(value: number): string {
    return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private loadLayout(): void {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as WidgetId[];
      if (Array.isArray(parsed) && parsed.every((id) => DEFAULT_WIDGETS.includes(id)) && parsed.length === DEFAULT_WIDGETS.length) {
        this.widgetOrder = parsed;
      }
    } catch { /* ignore */ }
  }

  private saveLayout(): void {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.widgetOrder));
  }

  private loadWidgetSizes(): void {
    try {
      const raw = localStorage.getItem(SIZES_KEY);
      if (!raw) return;
      this.widgetSizes = JSON.parse(raw) as Partial<Record<WidgetId, { w: number; h: number }>>;
    } catch { /* ignore */ }
  }

  private saveWidgetSizes(): void {
    localStorage.setItem(SIZES_KEY, JSON.stringify(this.widgetSizes));
  }
}
