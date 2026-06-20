import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface Customer {
  id: number;
  name: string;
  contact?: string | null;
  email?: string | null;
  address?: string | null;
  createdAt?: string | null;
  vehicleCount?: number;
  jobOrderCount?: number;
  lastVisit?: string | null;
}

export interface Vehicle {
  id: number;
  plateNumber: string;
  make: string;
  model: string;
  yearModel?: number | null;
  engineType?: string | null;
  fuelType?: string | null;
  odometerReading?: number | null;
  color?: string | null;
  transmission?: string | null;
  chassisInfo?: string | null;
  engineInfo?: string | null;
}

export interface PlateSearchResult {
  vehicleId: number;
  plateNumber: string;
  make: string;
  model: string;
  yearModel?: number | null;
  engineType?: string | null;
  fuelType?: string | null;
  odometerReading?: number | null;
  color?: string | null;
  transmission?: string | null;
  chassisInfo?: string | null;
  customerId: number;
  customerName: string;
  contact?: string | null;
  email?: string | null;
  address?: string | null;
}

interface ApiList<T> { success: boolean; message?: string; data?: T[]; }
interface ApiItem<T> { success: boolean; message?: string; data?: T; }
interface ApiCreate  { success: boolean; message?: string; id?: number; }

@Injectable({ providedIn: 'root' })
export class CustomersService {

  async getAll(search?: string): Promise<ApiList<Customer>> {
    const r = await apiClient.get<ApiList<Customer>>('/customers', { params: search ? { search } : undefined });
    return r.data;
  }

  async getOne(id: number): Promise<ApiItem<Customer>> {
    const r = await apiClient.get<ApiItem<Customer>>(`/customers/${id}`);
    return r.data;
  }

  async create(payload: Partial<Customer>): Promise<ApiCreate> {
    const r = await apiClient.post<ApiCreate>('/customers', payload);
    return r.data;
  }

  async update(id: number, payload: Partial<Customer>): Promise<ApiItem<Customer>> {
    const r = await apiClient.patch<ApiItem<Customer>>(`/customers/${id}`, payload);
    return r.data;
  }

  async getVehicles(customerId: number): Promise<ApiList<Vehicle>> {
    const r = await apiClient.get<ApiList<Vehicle>>(`/customers/${customerId}/vehicles`);
    return r.data;
  }

  async createVehicle(customerId: number, payload: Partial<Vehicle>): Promise<ApiCreate> {
    const r = await apiClient.post<ApiCreate>(`/customers/${customerId}/vehicles`, payload);
    return r.data;
  }

  async getJobOrders(customerId: number): Promise<ApiList<Record<string, unknown>>> {
    const r = await apiClient.get<ApiList<Record<string, unknown>>>(`/customers/${customerId}/job-orders`);
    return r.data;
  }

  async getPayments(customerId: number): Promise<ApiList<Record<string, unknown>>> {
    const r = await apiClient.get<ApiList<Record<string, unknown>>>(`/customers/${customerId}/payments`);
    return r.data;
  }

  async getHistory(customerId: number): Promise<ApiList<Record<string, unknown>>> {
    const r = await apiClient.get<ApiList<Record<string, unknown>>>(`/customers/${customerId}/history`);
    return r.data;
  }

  async searchByPlate(plate: string): Promise<ApiItem<PlateSearchResult>> {
    const r = await apiClient.get<ApiItem<PlateSearchResult>>('/customers/search-plate', { params: { plate } });
    return r.data;
  }
}
