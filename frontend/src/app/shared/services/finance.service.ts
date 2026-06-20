import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface Expense {
  id: number;
  description: string;
  amount: number;
  category?: string | null;
  expenseDate?: string | null;
  createdAt: string;
}

export interface ExpenseSummary {
  totalCount: number;
  totalAmount: number;
}

export interface Deposit {
  id: number;
  description: string;
  amount: number;
  source?: string | null;
  createdAt: string;
}

export interface DepositSummary {
  totalCount: number;
  totalAmount: number;
}

export interface Receivable {
  id: number;
  paymentDate: string;
  joNumber: string;
  jobOrderId: number;
  customerName: string;
  customerId: number;
  paymentMethod: string;
  referenceNo?: string | null;
  amount: number;
  notes?: string | null;
  status: 'pending' | 'settled';
  settlementMode?: string | null;
  settlementDate?: string | null;
  settlementReference?: string | null;
}

export interface ReceivableSummary {
  totalCount: number;
  totalAmount: number;
  totalJobOrders: number;
  totalPoPayments: number;
  totalChequePayments: number;
  pendingCount: number;
  settledCount: number;
}

export interface CalendarEvent {
  id: number;
  type: 'expense' | 'deposit' | 'receivable';
  title: string;
  amount: number;
  date: string;
  category?: string | null;
}

export interface SOACustomer {
  id: number;
  name: string;
  contact?: string | null;
  email?: string | null;
  transactionCount: number;
  totalReceivable: number;
  settledAmount: number;
  currentBalance: number;
}

export interface SOATransaction {
  id: number;
  paymentDate: string;
  joNumber: string;
  paymentMethod: string;
  referenceNo?: string | null;
  amount: number;
  notes?: string | null;
  status: 'pending' | 'settled';
  settlementMode?: string | null;
  settlementDate?: string | null;
}

export interface SOAData {
  customer: { id: number; name: string; contact?: string; email?: string; address?: string };
  transactions: SOATransaction[];
  totalAmount: number;
  settledAmount: number;
  currentBalance: number;
  generatedAt: string;
}

interface ApiResponse<T, S = undefined> {
  success: boolean;
  message?: string;
  data?: T;
  summary?: S;
}

@Injectable({ providedIn: 'root' })
export class FinanceService {

  // ─── Expenses ──────────────────────────────────────────────────────────────

  async getExpenses(from?: string, to?: string): Promise<ApiResponse<Expense[], ExpenseSummary>> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<ApiResponse<Expense[], ExpenseSummary>>('/finance/expenses', { params });
    return r.data;
  }

  async createExpense(payload: { description: string; amount: number; category?: string; expenseDate?: string }): Promise<ApiResponse<undefined>> {
    const r = await apiClient.post<ApiResponse<undefined>>('/finance/expenses', payload);
    return r.data;
  }

  async softDeleteExpense(id: number, payload: { reason: string; password: string }): Promise<ApiResponse<undefined>> {
    const r = await apiClient.post<ApiResponse<undefined>>(`/finance/expenses/${id}/delete`, payload);
    return r.data;
  }

  // ─── Deposits ──────────────────────────────────────────────────────────────

  async getDeposits(from?: string, to?: string): Promise<ApiResponse<Deposit[], DepositSummary>> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<ApiResponse<Deposit[], DepositSummary>>('/finance/deposits', { params });
    return r.data;
  }

  async createDeposit(payload: { description: string; amount: number; source?: string }): Promise<ApiResponse<undefined>> {
    const r = await apiClient.post<ApiResponse<undefined>>('/finance/deposits', payload);
    return r.data;
  }

  async deleteDeposit(id: number): Promise<ApiResponse<undefined>> {
    const r = await apiClient.delete<ApiResponse<undefined>>(`/finance/deposits/${id}`);
    return r.data;
  }

  // ─── Receivables ───────────────────────────────────────────────────────────

  async getReceivables(from?: string, to?: string): Promise<ApiResponse<Receivable[], ReceivableSummary>> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<ApiResponse<Receivable[], ReceivableSummary>>('/finance/receivables', { params });
    return r.data;
  }

  async settleReceivable(id: number, payload: { settlementMode: string; settlementDate: string; settlementReference?: string }): Promise<ApiResponse<undefined>> {
    const r = await apiClient.patch<ApiResponse<undefined>>(`/finance/receivables/${id}/settle`, payload);
    return r.data;
  }

  // ─── Calendar ──────────────────────────────────────────────────────────────

  async getCalendarEvents(from: string, to: string): Promise<ApiResponse<CalendarEvent[]>> {
    const r = await apiClient.get<ApiResponse<CalendarEvent[]>>('/finance/calendar', { params: { from, to } });
    return r.data;
  }

  // ─── SOA ───────────────────────────────────────────────────────────────────

  async getCustomersWithReceivables(): Promise<ApiResponse<SOACustomer[]>> {
    const r = await apiClient.get<ApiResponse<SOACustomer[]>>('/finance/soa/customers');
    return r.data;
  }

  async getCustomerSOA(customerId: number): Promise<ApiResponse<SOAData>> {
    const r = await apiClient.get<ApiResponse<SOAData>>(`/finance/soa/${customerId}`);
    return r.data;
  }
}
