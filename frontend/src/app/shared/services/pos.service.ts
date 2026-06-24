import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface PosProduct {
  id: number;
  partName: string;
  category?: string | null;
  brand?: string | null;
  stockQty: number;
  sellingPrice: number;
  imageUrl?: string | null;
  unitType?: string | null;
  inStock: boolean;
}

export interface CartLine {
  inventoryId: number;
  partName: string;
  sellingPrice: number;
  quantity: number;
  stockQty: number;
  imageUrl?: string | null;
  unitType?: string | null;
}

export interface CheckoutResult {
  saleIds: number[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  amountPaid: number | null;
  changeDue: number | null;
  itemCount: number;
}

@Injectable({ providedIn: 'root' })
export class PosService {
  async getProducts(search?: string): Promise<{ success: boolean; data?: PosProduct[]; message?: string }> {
    const r = await apiClient.get<{ success: boolean; data?: PosProduct[]; message?: string }>(
      '/api/pos/products',
      { params: search?.trim() ? { search: search.trim() } : undefined },
    );
    return r.data;
  }

  async checkout(payload: {
    items: Array<{ inventoryId: number; quantity: number }>;
    discountAmount?: number;
    amountPaid?: number;
  }): Promise<{ success: boolean; data?: CheckoutResult; message?: string }> {
    const r = await apiClient.post<{ success: boolean; data?: CheckoutResult; message?: string }>(
      '/api/pos/checkout',
      payload,
    );
    return r.data;
  }
}
