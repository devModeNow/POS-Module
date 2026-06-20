import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface Quotation {
  id: number;
  customerName: string;
  contact?: string | null;
  vehiclePlate?: string | null;
  customerId?: number | null;
  services?: unknown[];
  parts?: unknown[];
  laborFee?: number;
  discount?: number;
  totalAmount?: number;
  validUntil?: string | null;
  notes?: string | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdBy?: string | null;
}

interface ApiList<T> { success: boolean; message?: string; data?: T[]; }
interface ApiItem<T> { success: boolean; message?: string; data?: T; }
interface ApiCreate  { success: boolean; message?: string; id?: number; }

@Injectable({ providedIn: 'root' })
export class QuotationsService {

  async getAll(status?: string): Promise<ApiList<Quotation>> {
    const r = await apiClient.get<ApiList<Quotation>>('/quotations', { params: status ? { status } : undefined });
    return r.data;
  }

  async getOne(id: number): Promise<ApiItem<Quotation>> {
    const r = await apiClient.get<ApiItem<Quotation>>(`/quotations/${id}`);
    return r.data;
  }

  async create(payload: Partial<Quotation>): Promise<ApiCreate> {
    const r = await apiClient.post<ApiCreate>('/quotations', payload);
    return r.data;
  }

  async update(id: number, payload: Partial<Quotation>): Promise<ApiItem<Quotation>> {
    const r = await apiClient.patch<ApiItem<Quotation>>(`/quotations/${id}`, payload);
    return r.data;
  }

  async updateStatus(id: number, status: string): Promise<ApiItem<Quotation>> {
    const r = await apiClient.patch<ApiItem<Quotation>>(`/quotations/${id}/status`, { status });
    return r.data;
  }
}
