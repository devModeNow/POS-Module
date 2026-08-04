import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface PosProduct {
  id: number;
  name: string;
  category?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  variantCount: number;
  minPrice: number;
  maxPrice: number;
  minSalePrice?: number | null;
  totalStock: number;
  hasSale: boolean;
  inStock: boolean;
}

export interface PosVariantUnit {
  unitType: string;
  sellingPrice: number;
  salePrice?: number | null;
  isManualEntry: boolean;
  isDefault?: boolean;
}

export interface PosSubVariant {
  id: number;
  sortOrder?: number;
  tempType?: string | null;
  sizeLabel: string;
  sellingPrice: number;
  salePrice?: number | null;
}

export interface PosVariant {
  id: number;
  productId: number;
  productName: string;
  variantName: string;
  category?: string | null;
  stockQty: number;
  sellingPrice: number;
  salePrice?: number | null;
  unitType?: string | null;
  imageUrl?: string | null;
  productImageUrl?: string | null;
  units: PosVariantUnit[];
  hasSugarLevel?: boolean;
  subVariants?: PosSubVariant[];
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

export interface PosPaymentMethod {
  id: number;
  code: string;
  name: string;
  parentCode: string | null;
  settlementMode: 'immediate' | 'floating';
}

export interface CartLine {
  cartKey: string;
  variantId: number;
  productId?: number;
  productName: string;
  variantName: string;
  sellingPrice: number;
  salePrice?: number | null;
  quantity: number;
  stockQty: number;
  imageUrl?: string | null;
  unitType: string;
  isManualEntry?: boolean;
  units?: PosVariantUnit[];
  subVariantId?: number | null;
  tempType?: string | null;
  sizeLabel?: string | null;
  sugarLevel?: string | null;
}

export interface CheckoutResult {
  saleIds: number[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  amountPaid: number | null;
  changeDue: number | null;
  itemCount: number;
  paymentStatus?: string;
}

export interface PosSaleTransaction {
  id: number;
  saleDate: string;
  totalAmount: number;
  amountPaid: number | null;
  changeAmount: number | null;
  paymentStatus: string;
  paymentMethod: string;
  referenceNumber?: string | null;
  cashier: string;
  createdAt: string;
  itemCount: number;
}

export interface PosCompletedSale {
  saleId: number;
  title: string;
  body: string;
  completedAt: string;
  saleDate: string | null;
  cashier: string;
  paymentMethod: string;
  referenceNumber?: string | null;
  paymentStatus: string;
  totalAmount: number;
  itemCount: number;
}

export interface PosProductLogRow {
  id: number;
  productName: string;
  category?: string | null;
  brand?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PosDashboardReport {
  summary: {
    totalSales: number;
    settledSales: number;
    floatingSales: number;
    transactionCount: number;
    totalDiscount: number;
  };
  byDay: Array<{ saleDate: string; totalSales: number; settledSales: number; floatingSales: number }>;
  byPayment: Array<{ methodName: string; paymentStatus: string; totalAmount: number; transactionCount: number }>;
  byCategory: Array<{ category: string; totalAmount: number; quantitySold: number }>;
}

export interface InventoryVariantRow {
  id: number;
  productId: number;
  productName: string;
  variantName: string;
  category?: string | null;
  brand?: string | null;
  stockQty: number;
  stockWarning: number;
  costPrice: number;
  sellingPrice: number;
  salePrice?: number | null;
  unitType?: string | null;
  marginPercent?: number | null;
  imageUrl?: string | null;
  hasSugarLevel?: boolean;
  units?: Array<{
    unitType: string;
    sellingPrice: number;
    salePrice?: number | null;
    isManualEntry?: boolean;
    isDefault?: boolean;
  }>;
  subVariants?: Array<{
    id?: number;
    sortOrder?: number;
    tempType?: string | null;
    sizeLabel: string;
    sellingPrice: number;
    salePrice?: number | null;
  }>;
}

export interface InventoryProductRow {
  id: number;
  name: string;
  category?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  variantCount: number;
  minPrice: number;
  maxPrice: number;
  totalStock: number;
  hasSale: boolean;
}

export interface InventoryProductPayload {
  id?: number;
  name: string;
  category?: string;
  brand?: string;
  description?: string;
  variants: Array<{
    id?: number;
    variantName: string;
    stockQty?: number;
    stockWarning?: number;
    costPrice?: number;
    sellingPrice?: number;
    salePrice?: number | null;
    unitType?: string;
    marginPercent?: number | null;
    hasSugarLevel?: boolean;
    units?: Array<{
      unitType: string;
      sellingPrice?: number;
      salePrice?: number | null;
      isManualEntry?: boolean;
      isDefault?: boolean;
    }>;
    subVariants?: Array<{
      id?: number;
      sortOrder?: number;
      tempType?: string | null;
      sizeLabel: string;
      sellingPrice?: number;
      salePrice?: number | null;
    }>;
  }>;
}

@Injectable({ providedIn: 'root' })
export class PosService {
  async getProducts(search?: string, category?: string) {
    const params: Record<string, string> = {};
    if (search?.trim()) params['search'] = search.trim();
    if (category?.trim()) params['category'] = category.trim();
    const r = await apiClient.get<{ success: boolean; data?: PosProduct[]; message?: string }>(
      '/api/pos/products',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getVariantsCatalog(search?: string, category?: string) {
    const params: Record<string, string> = {};
    if (search?.trim()) params['search'] = search.trim();
    if (category?.trim()) params['category'] = category.trim();
    const r = await apiClient.get<{ success: boolean; data?: PosVariant[]; message?: string }>(
      '/api/pos/variants',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getVariants(productId: number) {
    const r = await apiClient.get<{ success: boolean; data?: PosVariant[]; message?: string }>(
      `/api/pos/products/${productId}/variants`,
    );
    return r.data;
  }

  async getCategories() {
    const r = await apiClient.get<{ success: boolean; data?: string[]; message?: string }>('/api/pos/categories');
    return r.data;
  }

  async getDiscounts() {
    const r = await apiClient.get<{ success: boolean; data?: PosDiscount[]; message?: string }>('/api/pos/discounts');
    return r.data;
  }

  async getPaymentMethods() {
    const r = await apiClient.get<{ success: boolean; data?: PosPaymentMethod[]; message?: string }>(
      '/api/pos/payment-methods',
    );
    return r.data;
  }

  async checkout(payload: {
    items: Array<{
      variantId: number;
      quantity: number;
      unitType?: string;
      subVariantId?: number | null;
    }>;
    discountId?: number | null;
    discountAmount?: number;
    amountPaid?: number;
    paymentMethodId?: number | null;
    referenceNumber?: string | null;
    customerFullName?: string | null;
  }) {
    const r = await apiClient.post<{ success: boolean; data?: CheckoutResult; message?: string }>(
      '/api/pos/checkout',
      payload,
    );
    return r.data;
  }

  async getDashboardReport(from?: string, to?: string, paymentStatus?: string) {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    if (paymentStatus) params['paymentStatus'] = paymentStatus;
    const r = await apiClient.get<{ success: boolean; data?: PosDashboardReport; message?: string }>(
      '/api/pos/reports/dashboard',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getCustomChart(groupBy: string, metric: string, from?: string, to?: string) {
    const params: Record<string, string> = { groupBy, metric };
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<{
      success: boolean;
      data?: { groupBy: string; metric: string; labels: string[]; values: number[] };
      message?: string;
    }>('/api/pos/reports/custom-chart', { params });
    return r.data;
  }

  async getSaleTransactions(
    from?: string,
    to?: string,
    paymentStatus?: string,
    limit = 50,
    offset = 0,
    options?: { search?: string; sortBy?: string; sortDir?: string },
  ) {
    const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    if (paymentStatus) params['paymentStatus'] = paymentStatus;
    if (options?.search) params['search'] = options.search;
    if (options?.sortBy) params['sortBy'] = options.sortBy;
    if (options?.sortDir) params['sortDir'] = options.sortDir;
    const r = await apiClient.get<{ success: boolean; data?: PosSaleTransaction[]; total?: number; message?: string }>(
      '/api/pos/reports/transactions',
      { params },
    );
    return r.data;
  }

  async updateTransactionPaymentStatus(transactionId: number, paymentStatus: 'settled' | 'floating') {
    const r = await apiClient.patch<{ success: boolean; message?: string }>(
      `/api/pos/reports/transactions/${transactionId}/payment-status`,
      { paymentStatus },
    );
    return r.data;
  }

  async getTransactionDetail(transactionId: number) {
    const r = await apiClient.get<{
      success: boolean;
      data?: {
        id: number;
        saleDate: string;
        createdAt: string;
        cashier: string;
        paymentMethod: string;
        paymentStatus: string;
        amountPaid: number | null;
        changeAmount: number | null;
        discountAmount: number;
        totalAmount: number;
        itemCount: number;
        items: Array<{
          id: number;
          variantId: number;
          productName: string;
          variantName: string;
          quantitySold: number;
          unitType: string;
          unitPrice: number;
          totalAmount: number;
        }>;
      };
      message?: string;
    }>(`/api/pos/reports/transactions/${transactionId}`);
    return r.data;
  }

  async getTopProductsReport(from?: string, to?: string) {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<{ success: boolean; data?: Array<{ partName: string; category: string | null; quantitySold: number; totalAmount: number }>; message?: string }>(
      '/api/pos/reports/top-products',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getSalesByCategoryReport(from?: string, to?: string) {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<{ success: boolean; data?: Array<{ category: string; quantitySold: number; totalAmount: number }>; message?: string }>(
      '/api/pos/reports/sales-by-category',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getInventoryValuationReport() {
    const r = await apiClient.get<{ success: boolean; data?: Array<{ category: string; itemCount: number; totalStock: number; retailValue: number }>; message?: string }>(
      '/api/pos/reports/inventory-valuation',
    );
    return r.data;
  }

  async getLowStockReport() {
    const r = await apiClient.get<{ success: boolean; data?: Array<{ partName: string; category: string | null; stockQty: number; stockWarning: number; sellingPrice: number }>; message?: string }>(
      '/api/pos/reports/low-stock',
    );
    return r.data;
  }

  async getProductLogsReport() {
    const r = await apiClient.get<{ success: boolean; data?: PosProductLogRow[]; message?: string }>(
      '/api/pos/reports/product-logs',
    );
    return r.data;
  }

  async getCompletedSalesReport(from?: string, to?: string, limit = 100, offset = 0) {
    const params: Record<string, string> = {
      limit: String(limit),
      offset: String(offset),
    };
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    const r = await apiClient.get<{ success: boolean; data?: PosCompletedSale[]; total?: number; message?: string }>(
      '/api/pos/reports/completed-sales',
      { params },
    );
    return r.data;
  }

  async getInventoryVariants(search?: string, category?: string, deletedOnly = false) {
    const params: Record<string, string> = {};
    if (search) params['search'] = search;
    if (category) params['category'] = category;
    if (deletedOnly) params['deleted'] = 'true';
    const r = await apiClient.get<{ success: boolean; data?: InventoryVariantRow[]; message?: string }>(
      '/inventory/products/variants',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getInventoryProducts(search?: string, category?: string, deletedOnly = false) {
    const params: Record<string, string> = {};
    if (search) params['search'] = search;
    if (category) params['category'] = category;
    if (deletedOnly) params['deleted'] = 'true';
    const r = await apiClient.get<{ success: boolean; data?: InventoryProductRow[]; message?: string }>(
      '/inventory/products',
      { params: Object.keys(params).length ? params : undefined },
    );
    return r.data;
  }

  async getInventoryProduct(id: number) {
    const r = await apiClient.get<{ success: boolean; data?: any; message?: string }>(`/inventory/products/${id}`);
    return r.data;
  }

  async saveInventoryVariant(variantId: number, payload: Record<string, unknown>) {
    const r = await apiClient.patch<{ success: boolean; id?: number; message?: string }>(
      `/inventory/products/variant/${variantId}`,
      payload,
    );
    return r.data;
  }

  async duplicateInventoryVariant(variantId: number) {
    const r = await apiClient.post<{
      success: boolean;
      data?: InventoryVariantRow;
      message?: string;
    }>(`/inventory/products/variant/${variantId}/duplicate`, {});
    return r.data;
  }

  async saveInventoryProduct(payload: InventoryProductPayload) {
    const r = await apiClient.post<{ success: boolean; id?: number; message?: string }>(
      '/inventory/products',
      payload,
    );
    return r.data;
  }

  async deleteInventoryProduct(id: number) {
    const r = await apiClient.delete<{ success: boolean; message?: string }>(`/inventory/products/${id}`);
    return r.data;
  }

  async deleteInventoryVariant(variantId: number) {
    const r = await apiClient.delete<{ success: boolean; message?: string }>(
      `/inventory/products/variant/${variantId}`,
    );
    return r.data;
  }

  async restoreInventoryProduct(id: number) {
    const r = await apiClient.patch<{ success: boolean; message?: string }>(`/inventory/products/${id}/restore`, {});
    return r.data;
  }

  async restoreInventoryVariant(variantId: number) {
    const r = await apiClient.patch<{ success: boolean; message?: string }>(
      `/inventory/products/variant/${variantId}/restore`,
      {},
    );
    return r.data;
  }

  async bulkImportProducts(products: Array<{
    name: string;
    category?: string;
    brand?: string;
    description?: string;
    variants: Array<{
      variantName: string;
      unitType?: string;
      stockQty?: number;
      stockWarning?: number;
      costPrice?: number;
      sellingPrice?: number;
      salePrice?: number | null;
    }>;
  }>) {
    const r = await apiClient.post<{
      success: boolean;
      importedProducts?: number;
      updatedProducts?: number;
      importedVariants?: number;
      updatedVariants?: number;
      errors?: string[];
      message?: string;
    }>('/inventory/products/bulk-import', { products });
    return r.data;
  }

  async uploadProductImage(productId: number, file: File) {
    const form = new FormData();
    form.append('image', file);
    const r = await apiClient.post<{ success: boolean; data?: { imageUrl: string }; message?: string }>(
      `/inventory/products/${productId}/image`,
      form,
    );
    return r.data;
  }

  async uploadVariantImage(variantId: number, file: File) {
    const form = new FormData();
    form.append('image', file);
    const r = await apiClient.post<{ success: boolean; data?: { imageUrl: string }; message?: string }>(
      `/inventory/products/variant/${variantId}/image`,
      form,
    );
    return r.data;
  }

  effectiveUnitPrice(sellingPrice: number, salePrice: number | null | undefined): number {
    if (salePrice != null && salePrice > 0 && salePrice < sellingPrice) return salePrice;
    return sellingPrice;
  }

  computeLineUnitPrice(
    sellingPrice: number,
    salePrice: number | null | undefined,
    discount: PosDiscount | null,
    quantity: number,
  ): number {
    let unit = this.effectiveUnitPrice(sellingPrice, salePrice);
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

  async staffHeartbeat(): Promise<{ success: boolean }> {
    const r = await apiClient.post<{ success: boolean }>('/api/pos/staff/heartbeat', {});
    return r.data;
  }

  async getMySales(options?: {
    from?: string;
    to?: string;
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: string;
  }) {
    const r = await apiClient.get<{ success: boolean; data?: unknown; message?: string }>(
      '/api/pos/my-sales',
      { params: options },
    );
    return r.data;
  }

  async getOnDutyStaff(withinMinutes = 30) {
    const r = await apiClient.get<{ success: boolean; data?: unknown[]; message?: string }>(
      '/api/pos/staff/on-duty',
      { params: { withinMinutes } },
    );
    return r.data;
  }

  async getAuditTrail(limit = 100, offset = 0) {
    const r = await apiClient.get<{ success: boolean; data?: unknown[]; message?: string }>(
      '/audit-trail',
      { params: { limit, offset } },
    );
    return r.data;
  }

  async voidCartLine(payload: { saleId?: number; cartKey?: string; adminCode: string; reason?: string }) {
    const r = await apiClient.post<{ success: boolean; message?: string }>('/api/pos/void', payload);
    return r.data;
  }

  async authorizeAdminCode(payload: { adminCode: string; action?: string; saleId?: number }) {
    const r = await apiClient.post<{ success: boolean; message?: string }>('/api/pos/admin-code/authorize', payload);
    return r.data;
  }

  async getVoidCodes() {
    const r = await apiClient.get<{ success: boolean; message?: string; data?: Array<{ id: number; label: string; isActive: boolean }> }>(
      '/api/pos/void-codes',
    );
    return r.data;
  }

  async saveVoidCode(payload: { id?: number; label: string; code?: string }) {
    const r = await apiClient.post<{ success: boolean; message?: string }>('/api/pos/void-codes', payload);
    return r.data;
  }

  async setVoidCodeActive(id: number, isActive: boolean) {
    const r = await apiClient.post<{ success: boolean; message?: string }>(`/api/pos/void-codes/${id}/active`, { isActive });
    return r.data;
  }
}
