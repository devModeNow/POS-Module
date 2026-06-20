import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface InventoryItem {
  id: number;
  partName: string;
  category?: string | null;
  brand?: string | null;
  description?: string | null;
  stockQty: number;
  stockWarning?: number;
  costPrice?: number;
  sellingPrice?: number;
  maxDiscountPrice?: number | null;
  updatedAt?: string | null;
}

export interface PurchaseOrderItem {
  id?: number;
  inventoryId?: number | null;
  itemName: string;
  productName?: string | null;
  brand?: string | null;
  category?: string | null;
  quantity: number;
  unitCost: number;
  totalCost?: number;
  lineTotal?: number;
  partName?: string | null;
}

export interface PurchaseOrder {
  id: number;
  poNumber?: string | null;
  status: string;
  notes?: string | null;
  comments?: string | null;
  orderDate?: string | null;
  expectedDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  supplierName?: string | null;
  supplierId?: number | null;
  createdBy?: string | null;
  totalCost?: number;
  totalQuantity?: number;
  itemCount?: number;
  items?: PurchaseOrderItem[];
  paymentType?: string | null;
  paymentDate?: string | null;
  paymentAmount?: number | null;
  referenceNumber?: string | null;
  paymentNotes?: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  contactInfo?: string | null;
  email?: string | null;
  address?: string | null;
}

interface ApiList<T> { success: boolean; message?: string; data?: T[]; }
interface ApiItem<T> { success: boolean; message?: string; data?: T; }
interface ApiCreate  { success: boolean; message?: string; id?: number; }
interface ApiOk      { success: boolean; message?: string; }

@Injectable({ providedIn: 'root' })
export class InventoryService {

  async getAll(search?: string, category?: string, brand?: string): Promise<ApiList<InventoryItem>> {
    const params: Record<string, string> = { pageSize: '9999' };
    if (search)   params['search']   = search;
    if (category) params['category'] = category;
    if (brand)    params['brand']    = brand;
    const r = await apiClient.get<ApiList<InventoryItem>>('/inventory', { params });
    return r.data;
  }

  async getOne(id: number): Promise<ApiItem<InventoryItem>> {
    const r = await apiClient.get<ApiItem<InventoryItem>>(`/inventory/${id}`);
    return r.data;
  }

  async create(payload: Partial<InventoryItem>): Promise<ApiCreate> {
    const r = await apiClient.post<ApiCreate>('/inventory', payload);
    return r.data;
  }

  async bulkImport(items: Array<{ partName: string; brand?: string; category?: string; description?: string; stockQty?: number; stockWarning?: number; costPrice?: number; sellingPrice?: number; marginPercent?: number }>): Promise<{ success: boolean; imported?: number; updated?: number; errors?: string[]; message?: string }> {
    const r = await apiClient.post<{ success: boolean; imported?: number; updated?: number; errors?: string[]; message?: string }>('/inventory/bulk-import', { items });
    return r.data;
  }

  getTemplateDownloadUrl(): string {
    return '/api/inventory/template/download';
  }

  async update(id: number, payload: Partial<InventoryItem>): Promise<ApiItem<InventoryItem>> {
    const r = await apiClient.patch<ApiItem<InventoryItem>>(`/inventory/${id}`, payload);
    return r.data;
  }

  async adjustStock(id: number, qty: number, notes?: string): Promise<ApiOk> {
    const r = await apiClient.post<ApiOk>(`/inventory/${id}/adjust-stock`, { qty, notes });
    return r.data;
  }

  async getStockHistory(id: number): Promise<{ success: boolean; data?: any[] }> {
    const r = await apiClient.get<{ success: boolean; data?: any[] }>(`/inventory/${id}/stock-history`);
    return r.data;
  }

  async verifyPassword(password: string): Promise<{ success: boolean }> {
    const r = await apiClient.post<{ success: boolean }>('/login/verify-password', { password });
    return r.data;
  }

  async search(q: string): Promise<ApiList<InventoryItem>> {
    const r = await apiClient.get<ApiList<InventoryItem>>('/inventory/search', { params: { q } });
    return r.data;
  }

  async getLowStock(): Promise<ApiList<InventoryItem>> {
    const r = await apiClient.get<ApiList<InventoryItem>>('/inventory/low-stock');
    return r.data;
  }

  async getSuppliers(): Promise<ApiList<Supplier>> {
    const r = await apiClient.get<ApiList<Supplier>>('/inventory/suppliers');
    return r.data;
  }

  async searchSuppliers(q: string): Promise<ApiList<Supplier>> {
    const r = await apiClient.get<ApiList<Supplier>>('/inventory/suppliers/search', { params: { q } });
    return r.data;
  }

  async createSupplier(name: string): Promise<{ success: boolean; data?: { id: number; name: string }; message?: string }> {
    const r = await apiClient.post<{ success: boolean; data?: { id: number; name: string }; message?: string }>('/inventory/suppliers', { name });
    return r.data;
  }

  // Brands
  async getBrands(q?: string): Promise<ApiList<{ id: number; name: string }>> {
    const r = await apiClient.get<ApiList<{ id: number; name: string }>>('/inventory/brands', {
      params: q ? { q } : undefined,
    });
    return r.data;
  }

  async createBrand(name: string): Promise<{ success: boolean; data?: { id: number; name: string }; message?: string }> {
    const r = await apiClient.post<{ success: boolean; data?: { id: number; name: string }; message?: string }>('/inventory/brands', { name });
    return r.data;
  }

  // Categories
  async getCategories(q?: string): Promise<ApiList<{ id: number; name: string }>> {
    const r = await apiClient.get<ApiList<{ id: number; name: string }>>('/inventory/categories', {
      params: q ? { q } : undefined,
    });
    return r.data;
  }

  async createCategory(name: string): Promise<{ success: boolean; data?: { id: number; name: string }; message?: string }> {
    const r = await apiClient.post<{ success: boolean; data?: { id: number; name: string }; message?: string }>('/inventory/categories', { name });
    return r.data;
  }

  // Purchase Orders
  async getAllPO(status?: string): Promise<ApiList<PurchaseOrder>> {
    const r = await apiClient.get<ApiList<PurchaseOrder>>('/inventory/purchase-orders', {
      params: status ? { status } : undefined,
    });
    return r.data;
  }

  async getOnePO(id: number): Promise<ApiItem<PurchaseOrder>> {
    const r = await apiClient.get<ApiItem<PurchaseOrder>>(`/inventory/purchase-orders/${id}`);
    return r.data;
  }

  async createPO(payload: { supplierId: number; comments?: string; items: PurchaseOrderItem[] }): Promise<ApiCreate> {
    const r = await apiClient.post<ApiCreate>('/inventory/purchase-orders', payload);
    return r.data;
  }

  async updatePOStatus(id: number, status: string): Promise<ApiOk> {
    const r = await apiClient.patch<ApiOk>(`/inventory/purchase-orders/${id}/status`, { status });
    return r.data;
  }

  async updatePO(id: number, payload: { comments?: string; items?: PurchaseOrderItem[] }): Promise<ApiOk> {
    const r = await apiClient.patch<ApiOk>(`/inventory/purchase-orders/${id}`, payload);
    return r.data;
  }

  async receivePO(id: number): Promise<ApiOk> {
    const r = await apiClient.post<ApiOk>(`/inventory/purchase-orders/${id}/receive`, {});
    return r.data;
  }
}
