import { Injectable } from '@angular/core';
import { CartLine } from './pos.service';

const STORAGE_PREFIX = 'cbis-pos-cart-';

@Injectable({ providedIn: 'root' })
export class PosCartService {
  cartKey(
    variantId: number,
    unitType: string,
    extras?: { subVariantId?: number | null; sugarLevel?: string | null },
  ): string {
    const sub = extras?.subVariantId != null ? String(extras.subVariantId) : '0';
    const sugar = extras?.sugarLevel ? String(extras.sugarLevel) : '-';
    return `${variantId}:${unitType}:${sub}:${sugar}`;
  }

  load(orgId: number): CartLine[] {
    if (!orgId) return [];
    try {
      const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${orgId}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CartLine[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  save(orgId: number, cart: CartLine[]): void {
    if (!orgId) return;
    sessionStorage.setItem(`${STORAGE_PREFIX}${orgId}`, JSON.stringify(cart));
  }

  clear(orgId: number): void {
    if (!orgId) return;
    sessionStorage.removeItem(`${STORAGE_PREFIX}${orgId}`);
  }
}
