import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import {
  FinanceService,
  Expense, ExpenseSummary,
  Deposit, DepositSummary,
  Receivable, ReceivableSummary,
  CalendarEvent,
  SOACustomer, SOAData,
} from '../../shared/services/finance.service';
import { NotificationService } from '../../shared/services/notification.service';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

type FinanceTab = 'expenses' | 'receivables' | 'deposits' | 'calendar' | 'soa';

@Component({
  selector: 'app-finance',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent],
  templateUrl: './finance.component.html',
})
export class FinanceComponent implements OnInit {
  activeTab: FinanceTab = 'expenses';
  fromDate = this.firstOfMonth();
  toDate = this.today();
  isLoading = false;

  // Expenses
  expenses: Expense[] = [];
  expenseSummary: ExpenseSummary | null = null;
  showExpenseForm = false;
  expenseForm = { description: '', amount: 0, category: '', expenseDate: this.today() };
  // Expense delete modal
  showDeleteExpenseModal = false;
  deleteExpenseId: number | null = null;
  deleteExpenseForm = { reason: '', password: '' };

  // Deposits
  deposits: Deposit[] = [];
  depositSummary: DepositSummary | null = null;
  showDepositForm = false;
  depositForm = { description: '', amount: 0, source: '' };

  // Receivables
  receivables: Receivable[] = [];
  receivableSummary: ReceivableSummary | null = null;
  // Settlement modal
  showSettleModal = false;
  settleReceivableId: number | null = null;
  settleForm = { settlementMode: 'cash', settlementDate: this.today(), settlementReference: '' };

  // Calendar
  calendarEvents: CalendarEvent[] = [];
  calendarMonth = new Date().getMonth();
  calendarYear = new Date().getFullYear();
  calendarDays: Array<{ date: string; day: number; isCurrentMonth: boolean; events: CalendarEvent[] }> = [];
  // Calendar day modal
  showDayModal = false;
  selectedDayDate = '';
  selectedDayEvents: CalendarEvent[] = [];

  // SOA
  soaCustomers: SOACustomer[] = [];
  selectedSOA: SOAData | null = null;
  showSOAModal = false;
  isGeneratingPdf = false;

  readonly tabs: Array<{ key: FinanceTab; label: string; icon: string }> = [
    { key: 'expenses',     label: 'Expenses',     icon: '📊' },
    { key: 'deposits',     label: 'Deposits',     icon: '💰' },
    { key: 'receivables',  label: 'Receivables',  icon: '📋' },
    { key: 'calendar',     label: 'Calendar',     icon: '📅' },
    { key: 'soa',          label: 'Customer SOA', icon: '📄' },
  ];

  constructor(
    private readonly financeSvc: FinanceService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    void this.loadTabData();
  }

  setTab(tab: FinanceTab): void {
    this.activeTab = tab;
    void this.loadTabData();
  }

  getTabClass(tab: FinanceTab): string {
    return this.activeTab === tab
      ? 'border-brand-500 text-brand-700 bg-white dark:border-brand-400 dark:text-brand-300 dark:bg-brand-500/10 shadow-sm'
      : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800';
  }

  async loadTabData(): Promise<void> {
    this.isLoading = true;
    try {
      switch (this.activeTab) {
        case 'expenses': {
          const r = await this.financeSvc.getExpenses(this.fromDate, this.toDate);
          this.expenses = r.data ?? [];
          this.expenseSummary = r.summary ?? null;
          break;
        }
        case 'deposits': {
          const r = await this.financeSvc.getDeposits(this.fromDate, this.toDate);
          this.deposits = r.data ?? [];
          this.depositSummary = r.summary ?? null;
          break;
        }
        case 'receivables': {
          const r = await this.financeSvc.getReceivables(this.fromDate, this.toDate);
          this.receivables = r.data ?? [];
          this.receivableSummary = r.summary ?? null;
          break;
        }
        case 'calendar': {
          this.buildCalendar();
          const r = await this.financeSvc.getCalendarEvents(this.calendarFrom(), this.calendarTo());
          this.calendarEvents = r.data ?? [];
          this.mapEventsToCalendar();
          break;
        }
        case 'soa': {
          const r = await this.financeSvc.getCustomersWithReceivables();
          this.soaCustomers = r.data ?? [];
          break;
        }
      }
    } catch {
      this.notify.error('Error', 'Failed to load data.');
    } finally {
      this.isLoading = false;
    }
  }

  // ─── Expense Actions ─────────────────────────────────────────────────────────

  async submitExpense(): Promise<void> {
    const r = await this.financeSvc.createExpense(this.expenseForm);
    if (r.success) {
      this.notify.success('Success', 'Expense added.');
      this.showExpenseForm = false;
      this.expenseForm = { description: '', amount: 0, category: '', expenseDate: this.today() };
      void this.loadTabData();
    } else {
      this.notify.error('Error', r.message ?? 'Failed to add expense.');
    }
  }

  openDeleteExpense(id: number): void {
    this.deleteExpenseId = id;
    this.deleteExpenseForm = { reason: '', password: '' };
    this.showDeleteExpenseModal = true;
  }

  async confirmDeleteExpense(): Promise<void> {
    if (!this.deleteExpenseId) return;
    const r = await this.financeSvc.softDeleteExpense(this.deleteExpenseId, this.deleteExpenseForm);
    if (r.success) {
      this.notify.success('Success', 'Expense deleted.');
      this.showDeleteExpenseModal = false;
      void this.loadTabData();
    } else {
      this.notify.error('Error', r.message ?? 'Failed to delete.');
    }
  }

  // ─── Deposit Actions ─────────────────────────────────────────────────────────

  async submitDeposit(): Promise<void> {
    const r = await this.financeSvc.createDeposit(this.depositForm);
    if (r.success) {
      this.notify.success('Success', 'Deposit added.');
      this.showDepositForm = false;
      this.depositForm = { description: '', amount: 0, source: '' };
      void this.loadTabData();
    } else {
      this.notify.error('Error', r.message ?? 'Failed to add deposit.');
    }
  }

  async removeDeposit(id: number): Promise<void> {
    if (!confirm('Delete this deposit?')) return;
    const r = await this.financeSvc.deleteDeposit(id);
    if (r.success) { void this.loadTabData(); }
    else { this.notify.error('Error', r.message ?? 'Failed to delete.'); }
  }

  // ─── Receivable Actions ──────────────────────────────────────────────────────

  openSettleModal(id: number): void {
    this.settleReceivableId = id;
    this.settleForm = { settlementMode: 'cash', settlementDate: this.today(), settlementReference: '' };
    this.showSettleModal = true;
  }

  async confirmSettle(): Promise<void> {
    if (!this.settleReceivableId) return;
    const r = await this.financeSvc.settleReceivable(this.settleReceivableId, this.settleForm);
    if (r.success) {
      this.notify.success('Success', 'Payment settled.');
      this.showSettleModal = false;
      void this.loadTabData();
    } else {
      this.notify.error('Error', r.message ?? 'Failed to settle.');
    }
  }

  // ─── Calendar ────────────────────────────────────────────────────────────────

  get monthLabel(): string {
    return new Date(this.calendarYear, this.calendarMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  prevMonth(): void {
    if (this.calendarMonth === 0) { this.calendarMonth = 11; this.calendarYear--; }
    else { this.calendarMonth--; }
    void this.loadTabData();
  }

  nextMonth(): void {
    if (this.calendarMonth === 11) { this.calendarMonth = 0; this.calendarYear++; }
    else { this.calendarMonth++; }
    void this.loadTabData();
  }

  openDayModal(date: string, events: CalendarEvent[]): void {
    if (events.length === 0) return;
    this.selectedDayDate = date;
    this.selectedDayEvents = events;
    this.showDayModal = true;
  }

  private buildCalendar(): void {
    const first = new Date(this.calendarYear, this.calendarMonth, 1);
    const last = new Date(this.calendarYear, this.calendarMonth + 1, 0);
    const startDay = first.getDay();
    const days: typeof this.calendarDays = [];
    for (let i = startDay - 1; i >= 0; i--) {
      const d = new Date(this.calendarYear, this.calendarMonth, -i);
      days.push({ date: this.formatDate(d), day: d.getDate(), isCurrentMonth: false, events: [] });
    }
    for (let i = 1; i <= last.getDate(); i++) {
      const d = new Date(this.calendarYear, this.calendarMonth, i);
      days.push({ date: this.formatDate(d), day: i, isCurrentMonth: true, events: [] });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(this.calendarYear, this.calendarMonth + 1, i);
      days.push({ date: this.formatDate(d), day: i, isCurrentMonth: false, events: [] });
    }
    this.calendarDays = days;
  }

  private mapEventsToCalendar(): void {
    for (const day of this.calendarDays) {
      day.events = this.calendarEvents.filter(e => e.date === day.date);
    }
  }

  private calendarFrom(): string {
    return this.calendarDays[0]?.date ?? this.formatDate(new Date(this.calendarYear, this.calendarMonth, 1));
  }

  private calendarTo(): string {
    return this.calendarDays[this.calendarDays.length - 1]?.date ?? this.formatDate(new Date(this.calendarYear, this.calendarMonth + 1, 0));
  }

  eventColor(type: string): string {
    switch (type) {
      case 'expense': return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300';
      case 'deposit': return 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300';
      case 'receivable': return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300';
      default: return 'bg-gray-100 text-gray-700';
    }
  }

  eventTypeLabel(type: string): string {
    switch (type) {
      case 'expense': return 'Expense';
      case 'deposit': return 'Deposit';
      case 'receivable': return 'Receivable';
      default: return type;
    }
  }

  // ─── SOA ─────────────────────────────────────────────────────────────────────

  async viewSOA(customerId: number): Promise<void> {
    this.isLoading = true;
    try {
      const r = await this.financeSvc.getCustomerSOA(customerId);
      if (r.success && r.data) {
        this.selectedSOA = r.data;
        this.showSOAModal = true;
      } else {
        this.notify.error('Error', r.message ?? 'Failed to load SOA.');
      }
    } catch {
      this.notify.error('Error', 'Failed to load SOA.');
    } finally {
      this.isLoading = false;
    }
  }

  async generateSOAPdf(): Promise<void> {
    if (!this.selectedSOA) return;
    this.isGeneratingPdf = true;
    try {
      const soa = this.selectedSOA;
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const { height } = page.getSize();
      let y = height - 50;

      page.drawText('STATEMENT OF ACCOUNT', { x: 180, y, font: boldFont, size: 18, color: rgb(0, 0, 0) });
      y -= 30;
      page.drawText('Car Expert Auto Repair', { x: 220, y, font, size: 11, color: rgb(0.3, 0.3, 0.3) });
      y -= 40;

      page.drawText('Customer:', { x: 50, y, font: boldFont, size: 10 });
      page.drawText(soa.customer.name, { x: 120, y, font, size: 10 });
      y -= 18;
      if (soa.customer.address) {
        page.drawText('Address:', { x: 50, y, font: boldFont, size: 10 });
        page.drawText(soa.customer.address, { x: 120, y, font, size: 10 });
        y -= 18;
      }
      if (soa.customer.contact) {
        page.drawText('Contact:', { x: 50, y, font: boldFont, size: 10 });
        page.drawText(soa.customer.contact, { x: 120, y, font, size: 10 });
        y -= 18;
      }
      page.drawText('Date:', { x: 50, y, font: boldFont, size: 10 });
      page.drawText(new Date(soa.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), { x: 120, y, font, size: 10 });
      y -= 30;

      const colX = [50, 130, 230, 340, 440];
      const headers = ['Date', 'JO No.', 'Method', 'Status', 'Amount'];
      page.drawRectangle({ x: 45, y: y - 5, width: 505, height: 20, color: rgb(0.93, 0.93, 0.93) });
      headers.forEach((h, i) => page.drawText(h, { x: colX[i], y, font: boldFont, size: 9 }));
      y -= 25;

      for (const tx of soa.transactions) {
        if (y < 100) break;
        const dateStr = new Date(tx.paymentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        page.drawText(dateStr, { x: colX[0], y, font, size: 9 });
        page.drawText(tx.joNumber || '', { x: colX[1], y, font, size: 9 });
        page.drawText(tx.paymentMethod === 'po_payment' ? 'PO Payment' : 'Cheque', { x: colX[2], y, font, size: 9 });
        page.drawText(tx.status === 'settled' ? 'Settled' : 'Pending', { x: colX[3], y, font, size: 9 });
        page.drawText(`P${Number(tx.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, { x: colX[4], y, font, size: 9 });
        y -= 18;
      }

      y -= 10;
      page.drawLine({ start: { x: 45, y: y + 8 }, end: { x: 550, y: y + 8 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
      page.drawText('Total Charges:', { x: 50, y, font: boldFont, size: 10 });
      page.drawText(`P${soa.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, { x: 440, y, font, size: 10 });
      y -= 18;
      page.drawText('Settled Payments:', { x: 50, y, font: boldFont, size: 10 });
      page.drawText(`P${soa.settledAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, { x: 440, y, font, size: 10 });
      y -= 18;
      page.drawText('CURRENT BALANCE:', { x: 50, y, font: boldFont, size: 12 });
      page.drawText(`P${soa.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, { x: 440, y, font: boldFont, size: 12 });

      y -= 50;
      page.drawText('This is a computer-generated document. No signature required.', { x: 150, y, font, size: 8, color: rgb(0.5, 0.5, 0.5) });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      // Open in new tab for preview — user can print/download from there
      window.open(url, '_blank');
      this.notify.success('Success', 'SOA PDF opened in new tab.');
    } catch {
      this.notify.error('Error', 'Failed to generate PDF.');
    } finally {
      this.isGeneratingPdf = false;
    }
  }

  formatPaymentMethod(mode: string): string {
    switch (mode) {
      case 'po_payment': return 'PO Payment';
      case 'cheque': return 'Cheque';
      case 'cash': return 'Cash';
      case 'bank_transfer': return 'Bank Transfer';
      default: return mode;
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  private today(): string { return new Date().toISOString().slice(0, 10); }
  private firstOfMonth(): string {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }
  private formatDate(d: Date): string { return d.toISOString().slice(0, 10); }
}
