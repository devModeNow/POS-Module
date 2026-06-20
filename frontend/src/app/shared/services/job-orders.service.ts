import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface JobOrderService {
  id?: number;
  serviceName: string;
  description?: string;
  fee: number;
}

export interface JobOrderPart {
  id?: number;
  inventoryId?: number | null;
  description: string;
  quantity: number;
  costPrice?: number;
  billingPrice?: number;
  source?: string;
  suppliedBy?: string;
  recordAsExpense?: boolean;
  inventoryName?: string | null;
}

export interface JobOrderPayment {
  id?: number;
  mode: string;
  amount: number;
  paymentDate: string;
  referenceNo?: string | null;
  notes?: string | null;
  createdAt?: string | null;
}

export interface JobOrder {
  id: number;
  joNumber: string;
  status: string;
  description?: string | null;
  totalAmount?: number;
  laborFee?: number;
  discount?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  forPaymentAt?: string | null;
  completedAt?: string | null;
  plateNumber: string;
  make: string;
  model: string;
  yearModel?: number | null;
  engineType?: string | null;
  fuelType?: string | null;
  odometerReading?: number | null;
  color?: string | null;
  transmission?: string | null;
  customerId?: number | null;
  customerName: string;
  contact?: string | null;
  email?: string | null;
  address?: string | null;
  mechanicName?: string | null;
  technicianId?: number | null;
  supplies?: Array<JobOrderService | JobOrderPart>;
  payments?: JobOrderPayment[];
  customerSignatureData?: string | null;
  mechanicSignatureData?: string | null;
}

export interface Technician {
  id: number;
  name: string;
  contactInfo?: string | null;
}

interface ApiList<T> { success: boolean; message?: string; data?: T[]; }
interface ApiItem<T> { success: boolean; message?: string; data?: T; }
interface ApiCreate  { success: boolean; message?: string; id?: number; }
interface ApiOk      { success: boolean; message?: string; }

@Injectable({ providedIn: 'root' })
export class JobOrdersService {

  async getTechnicians(): Promise<ApiList<Technician>> {
    const r = await apiClient.get<ApiList<Technician>>('/job-orders/technicians');
    return r.data;
  }

  async searchTechnicians(q: string): Promise<ApiList<Technician>> {
    const r = await apiClient.get<ApiList<Technician>>('/job-orders/technicians/search', { params: { q } });
    return r.data;
  }

  async createTechnician(name: string): Promise<{ success: boolean; data?: { id: number; name: string }; message?: string }> {
    const r = await apiClient.post<{ success: boolean; data?: { id: number; name: string }; message?: string }>('/job-orders/technicians', { name });
    return r.data;
  }

  async searchServices(q: string): Promise<{ success: boolean; data?: Array<{ id: number; name: string; defaultFee?: number }> }> {
    const r = await apiClient.get<{ success: boolean; data?: any[] }>('/job-orders/services/search', { params: { q } });
    return r.data;
  }

  async createServiceLookup(name: string, defaultFee?: number): Promise<{ success: boolean; data?: { id: number; name: string } }> {
    const r = await apiClient.post<{ success: boolean; data?: any }>('/job-orders/services', { name, defaultFee });
    return r.data;
  }

  async searchVehicles(q: string): Promise<{ success: boolean; data?: any[] }> {
    const r = await apiClient.get<{ success: boolean; data?: any[] }>('/job-orders/vehicles/search', { params: { q } });
    return r.data;
  }

  async getVehicleHistory(vehicleId: number): Promise<{ success: boolean; data?: any[] }> {
    const r = await apiClient.get<{ success: boolean; data?: any[] }>(`/job-orders/vehicles/${vehicleId}/history`);
    return r.data;
  }

  async searchCustomers(q: string): Promise<{ success: boolean; data?: Array<{ id: number; name: string; contact?: string; email?: string; address?: string }> }> {
    const r = await apiClient.get<{ success: boolean; data?: any[] }>('/job-orders/customers/search', { params: { q } });
    return r.data;
  }

  async getAll(status?: string, search?: string): Promise<ApiList<JobOrder>> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    if (search) params['search'] = search;
    const r = await apiClient.get<ApiList<JobOrder>>('/job-orders', {
      params: Object.keys(params).length ? params : undefined,
    });
    return r.data;
  }

  async getOne(id: number): Promise<ApiItem<JobOrder>> {
    const r = await apiClient.get<ApiItem<JobOrder>>(`/job-orders/${id}`);
    return r.data;
  }

  async create(payload: Partial<JobOrder> & { services?: JobOrderService[]; parts?: JobOrderPart[] }): Promise<ApiCreate> {
    const r = await apiClient.post<ApiCreate>('/job-orders', payload);
    return r.data;
  }

  async updateStatus(id: number, status: string, extra?: Record<string, unknown>): Promise<ApiOk> {
    const r = await apiClient.patch<ApiOk>(`/job-orders/${id}/status`, { status, ...extra });
    return r.data;
  }

  async saveSignature(id: number, type: 'customer' | 'mechanic', signatureData: string, signatoryName?: string): Promise<ApiOk> {
    const r = await apiClient.post<ApiOk>(`/job-orders/${id}/signature`, { type, signatureData, signatoryName });
    return r.data;
  }

  async addPayment(id: number, payload: Omit<JobOrderPayment, 'id' | 'createdAt'>): Promise<ApiOk> {
    const r = await apiClient.post<ApiOk>(`/job-orders/${id}/payment`, payload);
    return r.data;
  }

  async getChangeLogs(id: number): Promise<{ success: boolean; data?: any[] }> {
    const r = await apiClient.get<{ success: boolean; data?: any[] }>(`/job-orders/${id}/change-logs`);
    return r.data;
  }

  async updateSupplies(id: number, payload: { services?: any[]; parts?: any[]; customerSignatureData?: string; laborFee?: number; discount?: number }): Promise<ApiOk> {
    const r = await apiClient.patch<ApiOk>(`/job-orders/${id}/supplies`, payload);
    return r.data;
  }

  async updateTransactionDate(id: number, transactionDate: string): Promise<ApiOk> {
    const r = await apiClient.patch<ApiOk>(`/job-orders/${id}/transaction-date`, { transactionDate });
    return r.data;
  }
}
