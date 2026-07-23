import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type OfflineCheckoutPayload = {
  items: Array<{ variantId: number; quantity: number; unitType?: string }>;
  discountId?: number | null;
  discountAmount?: number;
  amountPaid?: number;
  paymentMethodId?: number | null;
  referenceNumber?: string | null;
};

export type QueuedCheckout = {
  id: string;
  orgId: number;
  createdAt: string;
  payload: OfflineCheckoutPayload;
  clientTotal: number;
};

export type CustomChartGroupBy =
  | 'day'
  | 'cashier'
  | 'payment_method'
  | 'payment_status'
  | 'category'
  | 'product'
  | 'brand'
  | 'unit_type';

export type CustomChartMetric =
  | 'total_amount'
  | 'quantity_sold'
  | 'transaction_count'
  | 'discount_amount';

export type CustomChartConfig = {
  title: string;
  groupBy: CustomChartGroupBy;
  metric: CustomChartMetric;
  visualType: 'bar' | 'donut';
};

const QUEUE_KEY = 'pos.offline.checkoutQueue';
const CATALOG_PREFIX = 'pos.offline.catalog.';
const CUSTOM_CHART_KEY = 'pos-admin-custom-chart-v2';

@Injectable({ providedIn: 'root' })
export class PosOfflineService {
  private readonly onlineSubject = new BehaviorSubject<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  readonly online$ = this.onlineSubject.asObservable();

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.onlineSubject.next(true));
    window.addEventListener('offline', () => this.onlineSubject.next(false));
  }

  isOnline(): boolean {
    return this.onlineSubject.value;
  }

  pendingCount(): number {
    return this.readQueue().length;
  }

  queueCheckout(orgId: number, payload: OfflineCheckoutPayload, clientTotal: number): string {
    const id = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queue = this.readQueue();
    queue.push({ id, orgId, createdAt: new Date().toISOString(), payload, clientTotal });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return id;
  }

  readQueue(): QueuedCheckout[] {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async syncQueue(
    checkoutFn: (payload: OfflineCheckoutPayload) => Promise<{ success?: boolean; message?: string } | null | undefined>,
  ): Promise<{ synced: number; failed: number }> {
    const queue = this.readQueue();
    if (!queue.length) return { synced: 0, failed: 0 };

    const remaining: QueuedCheckout[] = [];
    let synced = 0;
    let failed = 0;

    for (const item of queue) {
      try {
        const result = await checkoutFn(item.payload);
        if (result?.success) {
          synced += 1;
        } else {
          failed += 1;
          remaining.push(item);
        }
      } catch {
        failed += 1;
        remaining.push(item);
      }
    }

    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    return { synced, failed };
  }

  cacheCatalog(
    orgId: number,
    data: { variantCatalog?: unknown[]; products?: unknown[]; mode: 'variants' | 'types' },
  ): void {
    try {
      localStorage.setItem(`${CATALOG_PREFIX}${orgId}`, JSON.stringify({ cachedAt: Date.now(), ...data }));
    } catch {
      /* ignore quota */
    }
  }

  getCachedCatalog(orgId: number): {
    cachedAt: number;
    variantCatalog?: unknown[];
    products?: unknown[];
    mode?: 'variants' | 'types';
  } | null {
    try {
      const raw = localStorage.getItem(`${CATALOG_PREFIX}${orgId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  loadCustomChartConfig(): CustomChartConfig | null {
    try {
      const raw = localStorage.getItem(CUSTOM_CHART_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<CustomChartConfig>;
      if (!parsed?.title || !parsed?.groupBy || !parsed?.metric) return null;
      const groupByOptions: CustomChartGroupBy[] = [
        'day',
        'cashier',
        'payment_method',
        'payment_status',
        'category',
        'product',
        'brand',
        'unit_type',
      ];
      const metricOptions: CustomChartMetric[] = [
        'total_amount',
        'quantity_sold',
        'transaction_count',
        'discount_amount',
      ];
      const groupBy = groupByOptions.includes(parsed.groupBy as CustomChartGroupBy)
        ? (parsed.groupBy as CustomChartGroupBy)
        : 'category';
      const metric = metricOptions.includes(parsed.metric as CustomChartMetric)
        ? (parsed.metric as CustomChartMetric)
        : 'total_amount';
      return {
        title: String(parsed.title),
        groupBy,
        metric,
        visualType: parsed.visualType === 'donut' ? 'donut' : 'bar',
      };
    } catch {
      return null;
    }
  }

  saveCustomChartConfig(config: CustomChartConfig | null): void {
    try {
      if (!config) {
        localStorage.removeItem(CUSTOM_CHART_KEY);
        return;
      }
      localStorage.setItem(CUSTOM_CHART_KEY, JSON.stringify(config));
    } catch {
      /* ignore */
    }
  }
}
