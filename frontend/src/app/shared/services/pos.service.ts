import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface PosProduct {
  id: number;
  partName: string;
  category?: string | null;
  brand?: string | null;
  stockQty: number;
  sellingPrice: number;
  salePrice?: number | null;
  imageUrl?: string | null;
  unitType?: string | null;
  inStock: boolean;
}

export interface PosDiscount {
  id: number;
  orgId: number;
  name: string;
  code: string;
  discountType: 'percent' | 'fixed' | 'auto_sale' | 'auto_bulk';
  discountValue: number;
  bulkMinQty: number | null;
  description: string | null;
}

export interface CartLine {
  inventoryId: number;
  partName: string;
  sellingPrice: number;
  salePrice?: number | null;
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

export interface PosDailySalesReport {
  summary: { totalSales: number; transactionCount: number; totalDiscount: number };
  byDay: Array<{ saleDate: string; totalSales: number; transactionCount: number }>;
}

export interface PosTopProductRow {
  partName: string;
  category: string | null;
  quantitySold: number;
  totalAmount: number;
}

export interface PosCategorySalesRow {
  category: string;
  quantitySold: number;
  totalAmount: number;
}

export interface PosInventoryValuationRow {
  category: string;
  itemCount: number;
  totalStock: number;
  retailValue: number;
}

export interface PosLowStockRow {
  partName: string;
  category: string | null;
  stockQty: number;
  stockWarning: number;
  sellingPrice: number;
}

@Injectable({ providedIn: 'root' })
export class PosService {
  async getProducts(
    search?: string,
    category?: string,
  ): Promise<{ success: boolean; data?: PosProduct[]; message?: string }> {
    const params: Record<string, string> = {};
    if (search?.trim()) params['search'] = search.trim();
    if (category?.trim()) params['category'] = category.trim();
    const r = await apiClient.get<{ success: boolean; data?: PosProduct[]; message?: string }>(
      '/api/pos/products',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getCategories(): Promise<{ success: boolean; data?: string[]; message?: string }> {
    const r = await apiClient.get<{ success: boolean; data?: string[]; message?: string }>(
      '/api/pos/categories',
    );
    return r.data;
  }

  async getDiscounts(): Promise<{ success: boolean; data?: PosDiscount[]; message?: string }> {
    const r = await apiClient.get<{ success: boolean; data?: PosDiscount[]; message?: string }>(
      '/api/pos/discounts',
    );
    return r.data;
  }

  async checkout(payload: {
    items: Array<{ inventoryId: number; quantity: number }>;
    discountId?: number | null;
    discountAmount?: number;
    amountPaid?: number;
  }): Promise<{ success: boolean; data?: CheckoutResult; message?: string }> {
    const r = await apiClient.post<{ success: boolean; data?: CheckoutResult; message?: string }>(
      '/api/pos/checkout',
      payload,
    );
    return r.data;
  }

  async getDailySalesReport(from?: string, to?: string) {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<{ success: boolean; data?: PosDailySalesReport; message?: string }>(
      '/api/pos/reports/daily-sales',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getTopProductsReport(from?: string, to?: string) {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<{ success: boolean; data?: PosTopProductRow[]; message?: string }>(
      '/api/pos/reports/top-products',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getSalesByCategoryReport(from?: string, to?: string) {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<{ success: boolean; data?: PosCategorySalesRow[]; message?: string }>(
      '/api/pos/reports/sales-by-category',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getInventoryValuationReport() {
    const r = await apiClient.get<{ success: boolean; data?: PosInventoryValuationRow[]; message?: string }>(
      '/api/pos/reports/inventory-valuation',
    );
    return r.data;
  }

  async getLowStockReport() {
    const r = await apiClient.get<{ success: boolean; data?: PosLowStockRow[]; message?: string }>(
      '/api/pos/reports/low-stock',
    );
    return r.data;
  }

  /** Mirror backend discount math for checkout preview */
  computeLineUnitPrice(
    sellingPrice: number,
    salePrice: number | null | undefined,
    discount: PosDiscount | null,
    quantity: number,
  ): number {
    let unit = sellingPrice;
    if (discount?.discountType === 'auto_sale' && salePrice != null && salePrice > 0) {
      unit = salePrice;
    }
    if (discount?.discountType === 'auto_bulk' && discount.bulkMinQty && quantity >= discount.bulkMinQty) {
      unit = unit * (1 - discount.discountValue / 100);
    }
    return Math.round(unit * 100) / 100;
  }

  computeOrderDiscount(subtotal: number, discount: PosDiscount | null): number {
    if (!discount || subtotal <= 0) return 0;
    if (discount.discountType === 'percent') {
      return Math.round(subtotal * (discount.discountValue / 100) * 100) / 100;
    }
    if (discount.discountType === 'fixed') {
      return Math.min(subtotal, discount.discountValue);
    }
    return 0;
  }
}
