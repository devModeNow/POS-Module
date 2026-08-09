/** 1 kilo = 1000 grams. Retail/grams products store stock_qty in grams. */

export const GRAMS_PER_KILO = 1000;

export function normalizeWeightUnit(unitType?: string | null): string {
  const unit = String(unitType ?? '').trim().toLowerCase();
  if (unit === 'manual' || unit === 'gram') return 'grams';
  if (unit === 'kilogram' || unit === 'kilograms' || unit === 'kg') return 'kilo';
  return unit;
}

export function isGramsSellUnit(unitType?: string | null): boolean {
  const unit = normalizeWeightUnit(unitType);
  return unit === 'grams' || unit === 'manual';
}

export function isKiloSellUnit(unitType?: string | null): boolean {
  return normalizeWeightUnit(unitType) === 'kilo';
}

export function isRetailSellUnit(
  unitType?: string | null,
  productSource?: string | null,
  isManualEntry?: boolean,
): boolean {
  if (isManualEntry || isGramsSellUnit(unitType)) return true;
  return String(productSource ?? '').trim().toLowerCase() === 'retail';
}

export function tracksStockInGrams(
  unitType?: string | null,
  units?: Array<{ unitType?: string | null; isManualEntry?: boolean; productSource?: string }> | null,
): boolean {
  if (Array.isArray(units) && units.length) {
    return units.some((u) =>
      isRetailSellUnit(u.unitType, u.productSource, u.isManualEntry),
    );
  }
  return isGramsSellUnit(unitType);
}

export function roundStockQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

export function sellQtyToStockQty(
  qty: number,
  sellUnitType: string | null | undefined,
  stockInGrams: boolean,
): number {
  const safeQty = Number(qty);
  if (!Number.isFinite(safeQty) || safeQty <= 0) return 0;
  if (!stockInGrams) return roundStockQty(safeQty);
  if (isKiloSellUnit(sellUnitType)) return roundStockQty(safeQty * GRAMS_PER_KILO);
  return roundStockQty(safeQty);
}

export function kilosToStockGrams(kilos: number): number {
  return roundStockQty(Number(kilos) * GRAMS_PER_KILO);
}

export function stockGramsToKilos(grams: number): number {
  const g = Number(grams);
  if (!Number.isFinite(g)) return 0;
  return Math.round((g / GRAMS_PER_KILO) * 1000) / 1000;
}

export function stockQtyToSellUnits(
  stockQty: number,
  sellUnitType: string | null | undefined,
  stockInGrams: boolean,
): number {
  const stock = Number(stockQty);
  if (!Number.isFinite(stock) || stock <= 0) return 0;
  if (!stockInGrams) return roundStockQty(stock);
  if (isKiloSellUnit(sellUnitType)) return stockGramsToKilos(stock);
  return roundStockQty(stock);
}

/** Display helper: "4.8 kg (4800 g)" or plain number. */
export function formatWeightStock(stockQty: number, stockInGrams: boolean): string {
  const n = Number(stockQty);
  if (!Number.isFinite(n)) return '0';
  if (!stockInGrams) {
    return n.toLocaleString('en-PH', { maximumFractionDigits: 3 });
  }
  const kilos = stockGramsToKilos(n);
  const grams = roundStockQty(n);
  return `${kilos.toLocaleString('en-PH', { maximumFractionDigits: 3 })} kg (${grams.toLocaleString('en-PH', { maximumFractionDigits: 3 })} g)`;
}
