import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface SalesReportRow {
  date: string;
  mode: string;
  transactionCount: number;
  totalAmount: number;
}

export interface SalesReportSummary {
  totalTransactions: number;
  totalAmount: number;
  totalJobOrders: number;
}

export interface JobsReportRow {
  id: number;
  joNumber: string;
  status: string;
  totalAmount: number;
  laborFee: number;
  discount: number;
  createdAt: string;
  completedAt: string;
  plateNumber: string;
  make: string;
  model: string;
  customerName: string;
  mechanicName?: string | null;
}

export interface JobsReportSummary {
  totalJobs: number;
  totalRevenue: number;
  totalLaborFee: number;
}

export interface InventoryReportRow {
  id: number;
  partName: string;
  category?: string | null;
  brand?: string | null;
  stockQty: number;
  stockWarning: number;
  costPrice: number;
  sellingPrice: number;
  stockValue: number;
}

export interface InventoryReportSummary {
  totalItems: number;
  totalUnits: number;
  totalValue: number;
  lowStockCount: number;
}

export interface PayablesReceivablesRow {
  date: string;
  joNumber: string;
  customerName: string;
  paymentMethod: string;
  dueDatePdc: string | null;
  amount: number;
}

export interface PayablesReceivablesSummary {
  totalTransactions: number;
  totalAmount: number;
  totalJobOrders: number;
  totalPoPayments: number;
  totalChequePayments: number;
}

interface ApiReport<TRow, TSummary> {
  success: boolean;
  message?: string;
  data?: TRow[];
  summary?: TSummary;
}

interface ApiList<T> { success: boolean; message?: string; data?: T[]; }

@Injectable({ providedIn: 'root' })
export class ReportsService {

  async getSalesReport(from: string, to: string): Promise<ApiReport<SalesReportRow, SalesReportSummary>> {
    const r = await apiClient.get<ApiReport<SalesReportRow, SalesReportSummary>>('/reports/sales', {
      params: { from, to },
    });
    return r.data;
  }

  async getJobsReport(from: string, to: string): Promise<ApiReport<JobsReportRow, JobsReportSummary>> {
    const r = await apiClient.get<ApiReport<JobsReportRow, JobsReportSummary>>('/reports/jobs', {
      params: { from, to },
    });
    return r.data;
  }

  async getInventoryReport(category?: string, brand?: string): Promise<ApiReport<InventoryReportRow, InventoryReportSummary>> {
    const params: Record<string, string> = {};
    if (category) params['category'] = category;
    if (brand)    params['brand']    = brand;
    const r = await apiClient.get<ApiReport<InventoryReportRow, InventoryReportSummary>>('/reports/inventory', {
      params: Object.keys(params).length ? params : undefined,
    });
    return r.data;
  }

  async getLowStockReport(): Promise<ApiList<InventoryReportRow>> {
    const r = await apiClient.get<ApiList<InventoryReportRow>>('/reports/low-stock');
    return r.data;
  }

  async getPayablesReceivablesReport(from: string, to: string): Promise<ApiReport<PayablesReceivablesRow, PayablesReceivablesSummary>> {
    const r = await apiClient.get<ApiReport<PayablesReceivablesRow, PayablesReceivablesSummary>>('/reports/payables-receivables', {
      params: { from, to },
    });
    return r.data;
  }
}
