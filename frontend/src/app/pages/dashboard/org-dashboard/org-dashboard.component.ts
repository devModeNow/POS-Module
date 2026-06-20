import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePickerComponent } from '../../../shared/components/form/date-picker/date-picker.component';
import { DashboardService } from '../../../shared/services/dashboard.service';
import { NotificationService } from '../../../shared/services/notification.service';

@Component({
  selector: 'app-org-dashboard',
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './org-dashboard.component.html',
})
export class OrgDashboardComponent implements OnInit {
  period: 'daily' | 'weekly' | 'monthly' = 'daily';
  isLoading = false;

  // Cards
  sales = { total: 0, count: 0 };
  floatingSales = { total: 0, count: 0 };
  jobsDone = { count: 0 };
  pettyCash = { total: 0, count: 0 };
  deposits = { total: 0, count: 0 };

  // Inventory ops
  receivingPO = 0;
  stockAlerts = 0;

  // Payment breakdown
  paymentBreakdown: { mode: string; total: number; count: number }[] = [];

  // Expense breakdown
  expenseBreakdown: { category: string; total: number; count: number }[] = [];

  // Recent lists
  recentExpenses: any[] = [];
  recentDeposits: any[] = [];

  // Forms
  showExpenseForm = false;
  showDepositForm = false;
  expenseForm = { description: '', amount: 0, category: '', expenseDate: new Date().toISOString().split('T')[0] };
  depositForm = { description: '', amount: 0, source: '' };
  isSavingExpense = false;
  isSavingDeposit = false;

  constructor(
    private readonly dashboardSvc: DashboardService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    void this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    this.isLoading = true;
    try {
      const r = await this.dashboardSvc.getOrgDashboard(this.period);
      if (r.success && r.data) {
        this.sales = r.data.sales;
        this.floatingSales = r.data.floatingSales ?? { total: 0, count: 0 };
        this.jobsDone = r.data.jobsDone;
        this.pettyCash = r.data.pettyCash;
        this.deposits = r.data.deposits;
        this.receivingPO = r.data.inventory?.receivingPO ?? 0;
        this.stockAlerts = r.data.inventory?.stockAlerts ?? 0;
        this.recentExpenses = r.data.recentExpenses ?? [];
        this.recentDeposits = r.data.recentDeposits ?? [];
        this.paymentBreakdown = r.data.paymentBreakdown ?? [];
        this.expenseBreakdown = r.data.expenseBreakdown ?? [];
      }
    } catch { /* ignore */ }
    finally { this.isLoading = false; }
  }

  changePeriod(p: 'daily' | 'weekly' | 'monthly'): void {
    this.period = p;
    void this.loadDashboard();
  }

  onExpenseDateChange(event: { dateStr: string }): void {
    this.expenseForm.expenseDate = event.dateStr;
  }

  async saveExpense(): Promise<void> {
    if (!this.expenseForm.description.trim()) { this.notify.warning('Required', 'Description is required.'); return; }
    if (!this.expenseForm.amount || this.expenseForm.amount <= 0) { this.notify.warning('Required', 'Amount must be greater than 0.'); return; }
    this.isSavingExpense = true;
    try {
      const r = await this.dashboardSvc.addExpense(this.expenseForm);
      if (r.success) {
        this.notify.success('Added', 'Expense recorded.');
        this.expenseForm = { description: '', amount: 0, category: '', expenseDate: new Date().toISOString().split('T')[0] };
        this.showExpenseForm = false;
        void this.loadDashboard();
      } else { this.notify.error('Failed', r.message ?? 'Failed to add expense.'); }
    } catch { this.notify.error('Error', 'Unexpected error.'); }
    finally { this.isSavingExpense = false; }
  }

  async saveDeposit(): Promise<void> {
    if (!this.depositForm.description.trim()) { this.notify.warning('Required', 'Description is required.'); return; }
    if (!this.depositForm.amount || this.depositForm.amount <= 0) { this.notify.warning('Required', 'Amount must be greater than 0.'); return; }
    this.isSavingDeposit = true;
    try {
      const r = await this.dashboardSvc.addDeposit(this.depositForm);
      if (r.success) {
        this.notify.success('Added', 'Deposit recorded.');
        this.depositForm = { description: '', amount: 0, source: '' };
        this.showDepositForm = false;
        void this.loadDashboard();
      } else { this.notify.error('Failed', r.message ?? 'Failed to add deposit.'); }
    } catch { this.notify.error('Error', 'Unexpected error.'); }
    finally { this.isSavingDeposit = false; }
  }
}
