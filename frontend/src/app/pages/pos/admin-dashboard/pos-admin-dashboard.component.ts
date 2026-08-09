import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { CommonModule } from '@angular/common';

import { Component, HostListener, OnInit } from '@angular/core';

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

import { PosChatUiService } from '../../../shared/services/pos-chat-ui.service';

import { PosReceiptPrintService } from '../../../shared/services/pos-receipt-print.service';

import { PosOfflineService, type CustomChartConfig, type CustomChartGroupBy, type CustomChartMetric } from '../../../shared/services/pos-offline.service';

import { NotificationService } from '../../../shared/services/notification.service';



type KpiWidgetId =

  | 'kpi-total'

  | 'kpi-settled'

  | 'kpi-floating'

  | 'kpi-transactions'

  | 'kpi-discounts'

  | 'kpi-retail'

  | 'kpi-wholesale'

  | 'kpi-staff'

  | 'kpi-low-stock';



type ChartWidgetId = 'chart-daily' | 'chart-category' | 'chart-payment' | 'chart-custom';

type ChartVisualType = 'bar' | 'donut';



type WidgetId =

  | KpiWidgetId

  | ChartWidgetId

  | 'list-staff'

  | 'list-low-stock';



type WidgetSpan = 'kpi' | 'chart' | 'list';

type GridSpan = { col: number; row: number };



const DEFAULT_WIDGETS: WidgetId[] = [

  'kpi-total',

  'kpi-settled',

  'kpi-floating',

  'kpi-transactions',

  'kpi-discounts',

  'kpi-retail',

  'kpi-wholesale',

  'kpi-staff',

  'kpi-low-stock',

  'chart-daily',

  'chart-category',

  'chart-payment',

  'list-staff',

  'list-low-stock',

];



const LAYOUT_KEY = 'pos-admin-dashboard-layout-v1';

const SIZES_KEY = 'pos-admin-dashboard-sizes-v2';

const GRID_COLS = 12;

const GRID_ROW_PX = 72;

const GRID_GAP_PX = 12;



@Component({

  selector: 'app-pos-admin-dashboard',

  standalone: true,

  imports: [CommonModule, FormsModule, DragDropModule, NgApexchartsModule, PageBreadcrumbComponent],

  templateUrl: './pos-admin-dashboard.component.html',

  styles: `

    .widget-drag-handle { cursor: grab; }

    .widget-drag-handle:active { cursor: grabbing; }

    .dashboard-widget-grid {

      display: grid;

      grid-template-columns: repeat(12, minmax(0, 1fr));

      grid-auto-rows: ${GRID_ROW_PX}px;

      grid-auto-flow: dense;

      gap: ${GRID_GAP_PX}px;

      align-items: stretch;

    }

    .dashboard-kpi-grid {

      display: grid;

      grid-template-columns: repeat(2, minmax(0, 1fr));

      grid-auto-rows: minmax(132px, auto);

      gap: ${GRID_GAP_PX}px;

      align-items: stretch;

    }

    @media (min-width: 1024px) {

      .dashboard-kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }

    }

    @media (min-width: 1280px) {

      .dashboard-kpi-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }

    }

    .dashboard-kpi-grid .dashboard-widget {

      min-height: 132px;

    }

    .dashboard-widget {

      position: relative;

      display: flex;

      flex-direction: column;

      min-width: 0;

      min-height: 0;

      height: 100%;

      overflow: hidden;

    }

    .dashboard-widget-body {

      flex: 1 1 auto;

      min-height: 0;

      overflow: auto;

    }

    .dashboard-widget-resize {

      position: absolute;

      right: 0;

      bottom: 0;

      z-index: 2;

      width: 18px;

      height: 18px;

      cursor: nwse-resize;

      touch-action: none;

      opacity: 0.45;

    }

    .dashboard-widget-resize:hover { opacity: 0.85; }

    .dashboard-widget-resize::before {

      content: '';

      position: absolute;

      right: 4px;

      bottom: 4px;

      width: 10px;

      height: 10px;

      border-right: 2px solid currentColor;

      border-bottom: 2px solid currentColor;

      color: #94a3b8;

    }

    .cdk-drag-preview { box-sizing: border-box; opacity: 0.9; }

    .cdk-drag-placeholder { opacity: 0.35; }

    .cdk-drag-animating { transition: transform 200ms cubic-bezier(0, 0, 0.2, 1); }

  `,

})

export class PosAdminDashboardComponent implements OnInit {

  loading = false;

  period: 'daily' | 'weekly' | 'monthly' = 'daily';

  report: PosDashboardReport | null = null;

  onDutyStaff: Array<{ userId: number; fullname: string; roleName: string | null; lastSeen: string; profilePicture?: string | null }> = [];

  readonly defaultStaffAvatar = '/images/user/faceless-avatar.svg';

  lowStock: Array<{ partName: string; category: string | null; stockQty: number; stockWarning: number; sellingPrice: number }> = [];

  widgetOrder: WidgetId[] = [...DEFAULT_WIDGETS];

  widgetGridSpans: Partial<Record<WidgetId, GridSpan>> = {};



  detailModalOpen = false;

  detailKpiId: KpiWidgetId | null = null;

  detailLoading = false;

  detailTransactions: PosSaleTransaction[] = [];

  updatingTransactionId: number | null = null;

  reprintingSaleId: number | null = null;

  kpiSearch = '';

  kpiFilterPaymentStatus: 'all' | 'settled' | 'floating' = 'all';

  kpiPageSize = 25;

  kpiPage = 0;

  kpiTotal = 0;

  readonly kpiPageSizeOptions = [10, 25, 50];

  staffSearch = '';

  staffPage = 0;

  readonly staffPageSize = 10;

  lowStockModalSearch = '';

  lowStockModalPage = 0;

  readonly lowStockModalPageSize = 10;



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

  customChartConfig: CustomChartConfig | null = null;

  customChartBuilderOpen = false;

  customChartDraft: CustomChartConfig = {
    title: 'Custom Chart',
    groupBy: 'category',
    metric: 'total_amount',
    visualType: 'bar',
  };

  customChartLabels: string[] = [];

  customChartValues: number[] = [];

  customChartLoading = false;

  customBarSeries: ApexAxisChartSeries = [{ name: 'Value', data: [] }];

  customBarXaxis: ApexXAxis = { categories: [] };

  customDonutSeries: number[] = [];

  customDonutLabels: string[] = [];

  private customChartLoadSeq = 0;

  readonly customGroupByOptions: Array<{ value: CustomChartGroupBy; label: string }> = [
    { value: 'day', label: 'Sale date' },
    { value: 'cashier', label: 'Cashier' },
    { value: 'payment_method', label: 'Payment method' },
    { value: 'payment_status', label: 'Payment status' },
    { value: 'category', label: 'Product category' },
    { value: 'product', label: 'Product' },
    { value: 'brand', label: 'Brand' },
    { value: 'unit_type', label: 'Unit type' },
  ];

  readonly customMetricOptions: Array<{ value: CustomChartMetric; label: string }> = [
    { value: 'total_amount', label: 'Total sales amount' },
    { value: 'quantity_sold', label: 'Quantity sold' },
    { value: 'transaction_count', label: 'Transaction count' },
    { value: 'discount_amount', label: 'Discount amount' },
  ];



  chartTypes: Record<ChartWidgetId, ChartVisualType> = {

    'chart-daily': 'bar',

    'chart-category': 'bar',

    'chart-payment': 'bar',

    'chart-custom': 'bar',

  };



  readonly chartBase: ApexChart = { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'Outfit, sans-serif' };

  readonly donutChartBase: ApexChart = { type: 'donut', height: 260, toolbar: { show: false }, fontFamily: 'Outfit, sans-serif' };

  readonly chartColors = ['#10b981', '#f59e0b', '#465fff', '#ef4444', '#8b5cf6', '#ec4899'];

  readonly chartPlot: ApexPlotOptions = { bar: { borderRadius: 4, columnWidth: '55%' } };

  readonly donutPlot: ApexPlotOptions = {
    pie: {
      donut: {
        size: '62%',
        labels: {
          show: true,
          name: { show: true, color: '#ffffff', fontWeight: 500 },
          value: { show: true, color: '#ffffff', fontWeight: 700 },
          total: { show: true, label: 'Total', color: '#ffffff', fontWeight: 600 },
        },
      },
    },
  };

  readonly chartGrid: ApexGrid = { strokeDashArray: 4 };

  readonly chartDataLabels: ApexDataLabels = { enabled: false };

  readonly donutDataLabels: ApexDataLabels = {
    enabled: true,
    formatter: (val: number) => `${Math.round(val)}%`,
    style: {
      fontSize: '12px',
      fontWeight: 700,
      colors: ['#ffffff'],
    },
    dropShadow: {
      enabled: true,
      top: 1,
      left: 1,
      blur: 2,
      color: '#000000',
      opacity: 0.55,
    },
  };

  readonly donutLegend = {
    position: 'bottom' as const,
    labels: { colors: '#9ca3af' },
  };

  readonly chartStroke: ApexStroke = { show: true, width: 2, colors: ['transparent'] };



  readonly widgetMeta: Record<WidgetId, { label: string; span: WidgetSpan }> = {

    'kpi-total': { label: 'Total Sales', span: 'kpi' },

    'kpi-settled': { label: 'Settled', span: 'kpi' },

    'kpi-floating': { label: 'Floating', span: 'kpi' },

    'kpi-transactions': { label: 'Transactions', span: 'kpi' },

    'kpi-discounts': { label: 'Discounts', span: 'kpi' },

    'kpi-retail': { label: 'Retail Sales', span: 'kpi' },

    'kpi-wholesale': { label: 'Wholesale Sales', span: 'kpi' },

    'kpi-staff': { label: 'On-Duty Staff', span: 'kpi' },

    'kpi-low-stock': { label: 'Low Stock Items', span: 'kpi' },

    'chart-daily': { label: 'Daily Sales Trend', span: 'chart' },

    'chart-category': { label: 'Sales by Category', span: 'chart' },

    'chart-payment': { label: 'Payment Methods', span: 'chart' },

    'chart-custom': { label: 'Custom Chart', span: 'chart' },

    'list-staff': { label: 'Active Cashiers', span: 'list' },

    'list-low-stock': { label: 'Low Stock Alert', span: 'list' },

  };



  private resizing: {

    id: WidgetId;

    gridEl: HTMLElement;

    startX: number;

    startY: number;

    startCol: number;

    startRow: number;

    minCol: number;

    minRow: number;

    pointerId: number;

    handle: HTMLElement;

  } | null = null;



  constructor(

    private readonly pos: PosService,

    private readonly actionBusy: ActionBusyService,

    private readonly chatUi: PosChatUiService,

    private readonly receiptPrint: PosReceiptPrintService,

    private readonly notify: NotificationService,

    private readonly offline: PosOfflineService,

  ) {}



  ngOnInit(): void {

    this.loadLayout();

    this.loadWidgetSizes();

    this.loadCustomChartConfig();

    void this.refresh();

  }



  private loadCustomChartConfig(): void {

    this.customChartConfig = this.offline.loadCustomChartConfig();

    if (this.customChartConfig && !this.widgetOrder.includes('chart-custom')) {

      const paymentIdx = this.widgetOrder.indexOf('chart-payment');

      const insertAt = paymentIdx >= 0 ? paymentIdx + 1 : this.widgetOrder.length;

      this.widgetOrder.splice(insertAt, 0, 'chart-custom');

    }

    if (this.customChartConfig) {

      this.widgetMeta['chart-custom'].label = this.customChartConfig.title;

      this.chartTypes['chart-custom'] = this.customChartConfig.visualType;

    }

  }



  openCustomChartBuilder(): void {
    this.customChartDraft = this.customChartConfig
      ? { ...this.customChartConfig }
      : { title: 'Custom Chart', groupBy: 'category', metric: 'total_amount', visualType: 'bar' };
    this.customChartBuilderOpen = true;
  }



  closeCustomChartBuilder(): void {
    this.customChartBuilderOpen = false;
  }



  async saveCustomChart(): Promise<void> {
    const title = this.customChartDraft.title.trim() || 'Custom Chart';
    this.customChartConfig = { ...this.customChartDraft, title };
    this.offline.saveCustomChartConfig(this.customChartConfig);
    this.widgetMeta['chart-custom'].label = title;
    this.chartTypes['chart-custom'] = this.customChartConfig.visualType;
    if (!this.widgetOrder.includes('chart-custom')) {
      const paymentIdx = this.widgetOrder.indexOf('chart-payment');
      const insertAt = paymentIdx >= 0 ? paymentIdx + 1 : this.widgetOrder.length;
      this.widgetOrder.splice(insertAt, 0, 'chart-custom');
      this.saveLayout();
    }
    this.customChartBuilderOpen = false;
    await this.loadCustomChartData();
  }



  removeCustomChart(): void {
    this.customChartConfig = null;
    this.offline.saveCustomChartConfig(null);
    this.clearCustomChartSeries();
    this.widgetOrder = this.widgetOrder.filter((id) => id !== 'chart-custom');
    delete this.widgetGridSpans['chart-custom'];
    this.saveLayout();
    this.customChartBuilderOpen = false;
  }



  get hiddenWidgets(): WidgetId[] {
    const visible = new Set(this.widgetOrder);
    return DEFAULT_WIDGETS.filter((id) => !visible.has(id));
  }



  removeWidget(id: WidgetId): void {
    if (id === 'chart-custom') {
      this.removeCustomChart();
      return;
    }
    this.widgetOrder = this.widgetOrder.filter((w) => w !== id);
    delete this.widgetGridSpans[id];
    this.saveLayout();
  }



  addWidget(id: WidgetId): void {
    if (this.widgetOrder.includes(id)) return;
    const span = this.widgetMeta[id].span;
    const section = [...this.widgetOrder.filter((w) => this.widgetMeta[w].span === span), id];
    this.reorderSection(span, section);
  }



  onAddWidgetSelect(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = select.value as WidgetId;
    if (!id || !(id in this.widgetMeta)) return;
    this.addWidget(id);
    select.value = '';
  }



  private rebuildCustomChartSeries(): void {
    const metricLabel =
      this.customMetricOptions.find((o) => o.value === this.customChartConfig?.metric)?.label ?? 'Value';
    this.customBarSeries = [{ name: metricLabel, data: [...this.customChartValues] }];
    this.customBarXaxis = { categories: [...this.customChartLabels] };
    this.customDonutSeries = [...this.customChartValues];
    this.customDonutLabels = [...this.customChartLabels];
  }

  private clearCustomChartSeries(): void {
    this.customChartLabels = [];
    this.customChartValues = [];
    this.customBarSeries = [{ name: 'Value', data: [] }];
    this.customBarXaxis = { categories: [] };
    this.customDonutSeries = [];
    this.customDonutLabels = [];
  }

  private async loadCustomChartData(): Promise<void> {
    if (!this.customChartConfig) {
      this.clearCustomChartSeries();
      return;
    }
    const seq = ++this.customChartLoadSeq;
    const firstLoad = this.customChartValues.length === 0;
    if (firstLoad) this.customChartLoading = true;
    try {
      const { from, to } = this.periodRange();
      const r = await this.pos.getCustomChart(
        this.customChartConfig.groupBy,
        this.customChartConfig.metric,
        from,
        to,
      );
      if (seq !== this.customChartLoadSeq) return;
      if (r?.success && r.data) {
        this.customChartLabels = r.data.labels ?? [];
        this.customChartValues = r.data.values ?? [];
      } else {
        this.customChartLabels = [];
        this.customChartValues = [];
      }
      this.rebuildCustomChartSeries();
    } catch {
      if (seq !== this.customChartLoadSeq) return;
      this.clearCustomChartSeries();
    } finally {
      if (seq === this.customChartLoadSeq) this.customChartLoading = false;
    }
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



  defaultGridSpan(id: WidgetId): GridSpan {

    const kind = this.widgetMeta[id].span;

    if (kind === 'kpi') return { col: 2, row: 2 };

    if (kind === 'chart') return { col: 6, row: 5 };

    return { col: 6, row: 4 };

  }



  gridSpan(id: WidgetId): GridSpan {

    return this.widgetGridSpans[id] ?? this.defaultGridSpan(id);

  }



  widgetGridStyle(id: WidgetId): Record<string, string> {

    const { col, row } = this.gridSpan(id);

    return {

      gridColumn: `span ${col}`,

      gridRow: `span ${row}`,

    };

  }



  startWidgetResize(event: PointerEvent, id: WidgetId): void {

    event.preventDefault();

    event.stopPropagation();



    const widgetEl = (event.currentTarget as HTMLElement).closest('.dashboard-widget') as HTMLElement | null;

    const gridEl = widgetEl?.closest('.dashboard-widget-grid') as HTMLElement | null;

    if (!widgetEl || !gridEl) return;



    const min = this.contentMinSpan(widgetEl, gridEl, id);

    const current = this.gridSpan(id);



    this.resizing = {

      id,

      gridEl,

      startX: event.clientX,

      startY: event.clientY,

      startCol: current.col,

      startRow: current.row,

      minCol: min.col,

      minRow: min.row,

      pointerId: event.pointerId,

      handle: event.currentTarget as HTMLElement,

    };



    this.resizing.handle.setPointerCapture(event.pointerId);

  }



  @HostListener('document:pointermove', ['$event'])

  onDocumentPointerMove(event: PointerEvent): void {

    if (!this.resizing || event.pointerId !== this.resizing.pointerId) return;



    const colUnit = this.columnUnit(this.resizing.gridEl);

    const deltaCol = Math.round((event.clientX - this.resizing.startX) / (colUnit + GRID_GAP_PX));

    const deltaRow = Math.round((event.clientY - this.resizing.startY) / (GRID_ROW_PX + GRID_GAP_PX));



    const col = Math.max(this.resizing.minCol, Math.min(GRID_COLS, this.resizing.startCol + deltaCol));

    const row = Math.max(this.resizing.minRow, this.resizing.startRow + deltaRow);



    this.widgetGridSpans[this.resizing.id] = { col, row };

  }



  @HostListener('document:pointerup', ['$event'])

  @HostListener('document:pointercancel', ['$event'])

  onDocumentPointerUp(event: PointerEvent): void {

    if (!this.resizing || event.pointerId !== this.resizing.pointerId) return;



    try {

      this.resizing.handle.releasePointerCapture(event.pointerId);

    } catch { /* ignore */ }



    const widgetEl = this.resizing.gridEl.querySelector(`[data-widget-id="${this.resizing.id}"]`) as HTMLElement | null;

    if (widgetEl) {

      const min = this.contentMinSpan(widgetEl, this.resizing.gridEl, this.resizing.id);

      const current = this.gridSpan(this.resizing.id);

      this.widgetGridSpans[this.resizing.id] = {

        col: Math.max(current.col, min.col),

        row: Math.max(current.row, min.row),

      };

    }



    this.resizing = null;

    this.saveWidgetSizes();

  }



  async openKpiDetail(id: KpiWidgetId): Promise<void> {

    this.detailKpiId = id;

    this.detailModalOpen = true;

    this.detailTransactions = [];

    this.kpiTotal = 0;

    this.kpiSearch = '';

    this.kpiFilterPaymentStatus = 'all';

    this.kpiPage = 0;

    this.staffSearch = '';

    this.staffPage = 0;

    this.lowStockModalSearch = '';

    this.lowStockModalPage = 0;



    if (id === 'kpi-staff' || id === 'kpi-low-stock') {

      this.detailLoading = false;

      return;

    }



    await this.loadKpiTransactions();

  }



  closeKpiDetail(): void {

    this.detailModalOpen = false;

    this.detailKpiId = null;

    this.detailTransactions = [];

  }



  async loadKpiTransactions(): Promise<void> {

    if (!this.isTransactionKpi) return;

    this.detailLoading = true;

    try {

      const { from, to } = this.periodRange();

      const paymentStatus = this.effectiveKpiPaymentStatus();

      const offset = this.kpiPage * this.kpiPageSize;

      const r = await this.pos.getSaleTransactions(from, to, paymentStatus, this.kpiPageSize, offset);

      this.detailTransactions = r.success ? (r.data ?? []) : [];

      this.kpiTotal = r.success ? (r.total ?? this.detailTransactions.length) : 0;

    } finally {

      this.detailLoading = false;

    }

  }



  get filteredDetailTransactions(): PosSaleTransaction[] {

    const q = this.kpiSearch.trim().toLowerCase();

    if (!q) return this.detailTransactions;

    return this.detailTransactions.filter((row) =>
      (row.cashier || '').toLowerCase().includes(q) ||
      (row.paymentMethod || '').toLowerCase().includes(q) ||
      String(row.id).includes(q),
    );

  }



  get kpiTotalPages(): number {

    return Math.max(1, Math.ceil(this.kpiTotal / this.kpiPageSize));

  }



  get kpiPageInfo(): string {

    if (this.kpiTotal === 0) return 'No results';

    const start = this.kpiPage * this.kpiPageSize + 1;

    const end = Math.min(this.kpiTotal, this.kpiPage * this.kpiPageSize + this.detailTransactions.length);

    return `${start}–${end} of ${this.kpiTotal}`;

  }



  get kpiHasPrevPage(): boolean {

    return this.kpiPage > 0;

  }



  get kpiHasNextPage(): boolean {

    return (this.kpiPage + 1) * this.kpiPageSize < this.kpiTotal;

  }



  onKpiPageSizeChange(): void {

    this.kpiPage = 0;

    void this.loadKpiTransactions();

  }



  onKpiPaymentFilterChange(): void {

    this.kpiPage = 0;

    void this.loadKpiTransactions();

  }



  kpiPrevPage(): void {

    if (!this.kpiHasPrevPage) return;

    this.kpiPage--;

    void this.loadKpiTransactions();

  }



  kpiNextPage(): void {

    if (!this.kpiHasNextPage) return;

    this.kpiPage++;

    void this.loadKpiTransactions();

  }



  get showKpiPaymentFilter(): boolean {

    return this.detailKpiId === 'kpi-total' || this.detailKpiId === 'kpi-transactions' || this.detailKpiId === 'kpi-discounts';

  }



  get filteredOnDutyStaff(): typeof this.onDutyStaff {

    const q = this.staffSearch.trim().toLowerCase();

    if (!q) return this.onDutyStaff;

    return this.onDutyStaff.filter((row) =>
      row.fullname.toLowerCase().includes(q) || (row.roleName || '').toLowerCase().includes(q),
    );

  }



  get pagedOnDutyStaff(): typeof this.onDutyStaff {

    const start = this.staffPage * this.staffPageSize;

    return this.filteredOnDutyStaff.slice(start, start + this.staffPageSize);

  }



  get staffTotalPages(): number {

    return Math.max(1, Math.ceil(this.filteredOnDutyStaff.length / this.staffPageSize));

  }



  onStaffSearchChange(): void {

    this.staffPage = 0;

  }



  staffPrevPage(): void {

    if (this.staffPage > 0) this.staffPage--;

  }



  staffNextPage(): void {

    if (this.staffPage + 1 < this.staffTotalPages) this.staffPage++;

  }



  get filteredLowStockModal(): typeof this.lowStock {

    const q = this.lowStockModalSearch.trim().toLowerCase();

    if (!q) return this.lowStock;

    return this.lowStock.filter((row) =>
      row.partName.toLowerCase().includes(q) || (row.category || '').toLowerCase().includes(q),
    );

  }



  get pagedLowStockModal(): typeof this.lowStock {

    const start = this.lowStockModalPage * this.lowStockModalPageSize;

    return this.filteredLowStockModal.slice(start, start + this.lowStockModalPageSize);

  }



  get lowStockModalTotalPages(): number {

    return Math.max(1, Math.ceil(this.filteredLowStockModal.length / this.lowStockModalPageSize));

  }



  onLowStockModalSearchChange(): void {

    this.lowStockModalPage = 0;

  }



  lowStockModalPrevPage(): void {

    if (this.lowStockModalPage > 0) this.lowStockModalPage--;

  }



  lowStockModalNextPage(): void {

    if (this.lowStockModalPage + 1 < this.lowStockModalTotalPages) this.lowStockModalPage++;

  }



  private effectiveKpiPaymentStatus(): string | undefined {

    if (this.detailKpiId === 'kpi-settled') return 'settled';

    if (this.detailKpiId === 'kpi-floating') return 'floating';

    if (this.kpiFilterPaymentStatus === 'all') return undefined;

    return this.kpiFilterPaymentStatus;

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

          await this.loadKpiTransactions();

        }

      }

    } finally {

      this.updatingTransactionId = null;

    }

  }



  async reprintSale(row: PosSaleTransaction): Promise<void> {

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



  settledAmount(): number {

    return this.report?.summary?.settledSales ?? 0;

  }



  floatingAmount(): number {

    return this.report?.summary?.floatingSales ?? 0;

  }



  messageStaff(row: { userId: number; fullname: string }): void {

    this.chatUi.openPrivateChat(row.userId, row.fullname || 'Cashier');

  }



  avatarUrl(row: { profilePicture?: string | null }): string {

    return row.profilePicture?.trim() || this.defaultStaffAvatar;

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
        await this.loadCustomChartData();

      });

    } finally {

      this.loading = false;

    }

  }



  onPeriodChange(): void {

    void this.refresh();

  }



  isChartWidget(id: WidgetId): id is ChartWidgetId {

    return id === 'chart-daily' || id === 'chart-category' || id === 'chart-payment' || id === 'chart-custom';

  }



  chartVisualType(id: ChartWidgetId): ChartVisualType {

    if (id === 'chart-custom' && this.customChartConfig) return this.customChartConfig.visualType;

    return this.chartTypes[id];

  }



  setChartVisualType(id: ChartWidgetId, type: ChartVisualType): void {

    this.chartTypes[id] = type;

    if (id === 'chart-custom' && this.customChartConfig) {

      this.customChartConfig = { ...this.customChartConfig, visualType: type };

      this.offline.saveCustomChartConfig(this.customChartConfig);

    }

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

      case 'kpi-retail': return this.money(s?.retailSales ?? 0);

      case 'kpi-wholesale': return this.money(s?.wholesaleSales ?? 0);

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

      case 'kpi-retail': return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-500/10 dark:text-sky-300';

      case 'kpi-wholesale': return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-500/10 dark:text-violet-300';

      case 'kpi-low-stock': return 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-300';

      default: return 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';

    }

  }



  private columnUnit(gridEl: HTMLElement): number {

    const styles = getComputedStyle(gridEl);

    const gap = Number.parseFloat(styles.columnGap || styles.gap || `${GRID_GAP_PX}`) || GRID_GAP_PX;

    return (gridEl.clientWidth - gap * (GRID_COLS - 1)) / GRID_COLS;

  }



  private contentMinSpan(widgetEl: HTMLElement, gridEl: HTMLElement, id: WidgetId): GridSpan {

    const colUnit = this.columnUnit(gridEl);

    const gap = GRID_GAP_PX;

    const content = widgetEl.querySelector('.dashboard-widget-content') as HTMLElement | null;

    const measureEl = content ?? widgetEl;



    const contentWidth = Math.max(measureEl.scrollWidth, measureEl.clientWidth);

    const contentHeight = Math.max(measureEl.scrollHeight, measureEl.clientHeight);



    const minCol = Math.max(1, Math.min(GRID_COLS, Math.ceil((contentWidth + gap) / (colUnit + gap))));

    const minRow = Math.max(1, Math.ceil((contentHeight + gap) / (GRID_ROW_PX + gap)));



    const floor = this.defaultGridSpan(id);

    return {

      col: Math.min(GRID_COLS, Math.max(minCol, Math.min(floor.col, 3))),

      row: Math.max(minRow, 2),

    };

  }



  private reorderSection(span: 'kpi' | 'chart' | 'list', ordered: WidgetId[]): void {

    const kpis = span === 'kpi' ? ordered : this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'kpi');

    const charts = span === 'chart' ? ordered : this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'chart');

    const lists = span === 'list' ? ordered : this.widgetOrder.filter((id) => this.widgetMeta[id].span === 'list');

    this.widgetOrder = [...kpis, ...charts, ...lists];

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

      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed) || parsed.length === 0) return;

      if (!parsed.every((id) => typeof id === 'string' && id in this.widgetMeta)) return;

      if (new Set(parsed).size !== parsed.length) return;

      this.widgetOrder = parsed as WidgetId[];

    } catch { /* ignore */ }

  }



  private saveLayout(): void {

    localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.widgetOrder));

  }



  private loadWidgetSizes(): void {

    try {

      const raw = localStorage.getItem(SIZES_KEY);

      if (raw) {

        const parsed = JSON.parse(raw) as Partial<Record<WidgetId, GridSpan>>;

        for (const id of DEFAULT_WIDGETS) {

          if (this.widgetMeta[id].span === 'kpi') continue;

          const span = parsed[id];

          if (span?.col && span?.row) {

            this.widgetGridSpans[id] = {

              col: Math.max(1, Math.min(GRID_COLS, Math.round(span.col))),

              row: Math.max(1, Math.round(span.row)),

            };

          }

        }

        return;

      }



      const legacyRaw = localStorage.getItem('pos-admin-dashboard-sizes-v1');

      if (!legacyRaw) return;

      const legacy = JSON.parse(legacyRaw) as Partial<Record<WidgetId, { w: number; h: number }>>;

      for (const id of DEFAULT_WIDGETS) {

        if (this.widgetMeta[id].span === 'kpi') continue;

        const size = legacy[id];

        if (!size?.w || !size?.h) continue;

        this.widgetGridSpans[id] = {

          col: Math.max(1, Math.min(GRID_COLS, Math.round(size.w / 120))),

          row: Math.max(1, Math.round(size.h / GRID_ROW_PX)),

        };

      }

    } catch { /* ignore */ }

  }



  private saveWidgetSizes(): void {

    const sizes = Object.fromEntries(

      Object.entries(this.widgetGridSpans).filter(

        ([id]) => this.widgetMeta[id as WidgetId]?.span !== 'kpi',

      ),

    ) as Partial<Record<WidgetId, GridSpan>>;

    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));

  }

}


