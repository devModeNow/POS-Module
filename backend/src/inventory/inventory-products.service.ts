import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import sharp from 'sharp';

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const THUMB_SIZE = 400;

export type UnitQtyPrice = {
  qty: number;
  price: number;
};

export type VariantUnitRow = {
  id?: number;
  unitType: string;
  sellingPrice: number;
  salePrice: number | null;
  isManualEntry: boolean;
  isDefault?: boolean;
  productSource?: 'Retail' | 'Wholesale';
  stockQty?: number;
  stockWarning?: number;
  costPrice?: number;
  defaultQty?: number;
  qtyPrices?: UnitQtyPrice[];
};

export type VariantRow = {
  id: number;
  productId: number;
  productName: string;
  category: string | null;
  brand: string | null;
  variantName: string;
  stockQty: number;
  stockWarning: number;
  costPrice: number;
  sellingPrice: number;
  salePrice: number | null;
  unitType: string | null;
  marginPercent: number | null;
  imageUrl: string | null;
  productImageUrl: string | null;
};

export type ProductRow = {
  id: number;
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  variantCount: number;
  minPrice: number;
  maxPrice: number;
  totalStock: number;
  hasSale: boolean;
};

@Injectable()
export class InventoryProductsService {
  private productSourceRepairDoneV2 = false;
  private retailStockSchemaReady = false;
  private unitStockSchemaReady = false;
  private unitCostSchemaReady = false;
  private unitDefaultQtySchemaReady = false;
  private unitQtyPricesSchemaReady = false;
  private duplicateUnitTypesAllowed = false;

  constructor(private readonly db: DatabaseService) {}

  private async ensureRetailStockSchema(): Promise<void> {
    if (this.retailStockSchemaReady) return;
    await this.db.query(`
      ALTER TABLE public.tblinventory_variants
        ADD COLUMN IF NOT EXISTS retail_stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
    `);
    await this.db.query(`
      ALTER TABLE public.tblinventory_variants
        ADD COLUMN IF NOT EXISTS retail_stock_warning NUMERIC(12, 3) NOT NULL DEFAULT 0
    `);
    this.retailStockSchemaReady = true;
  }

  private async ensureDuplicateUnitTypesAllowed(): Promise<void> {
    if (this.duplicateUnitTypesAllowed) return;
    await this.db.query(`DROP INDEX IF EXISTS public.idx_variant_units_variant_type`);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_variant_units_variant_type_nonunique
        ON public.tblinventory_variant_units (variant_id, lower(unit_type))
        WHERE is_active = TRUE
    `);
    this.duplicateUnitTypesAllowed = true;
  }

  private async ensureUnitDefaultQtySchema(): Promise<void> {
    if (this.unitDefaultQtySchemaReady) return;
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_units
        ADD COLUMN IF NOT EXISTS default_qty NUMERIC(12, 3) NOT NULL DEFAULT 1
    `);
    await this.db.query(`
      UPDATE public.tblinventory_variant_units
      SET default_qty = 200,
          updated_at = NOW()
      WHERE default_qty = 1
        AND (
          COALESCE(is_manual_entry, FALSE) = TRUE
          OR LOWER(COALESCE(unit_type, '')) IN ('grams', 'gram', 'manual')
        )
    `);
    this.unitDefaultQtySchemaReady = true;
  }

  private async ensureUnitQtyPricesSchema(): Promise<void> {
    if (this.unitQtyPricesSchemaReady) return;
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_units
        ADD COLUMN IF NOT EXISTS qty_prices JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    this.unitQtyPricesSchemaReady = true;
  }

  private normalizeQtyPrices(raw: unknown): UnitQtyPrice[] {
    if (!Array.isArray(raw)) return [];
    const out: UnitQtyPrice[] = [];
    const seen = new Set<number>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const qty = this.toFiniteNumber((item as { qty?: unknown }).qty, 0);
      const price = this.toFiniteNumber((item as { price?: unknown }).price, 0);
      if (qty <= 0 || price < 0) continue;
      const key = Math.round(qty * 1000) / 1000;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        qty: key,
        price: Math.round(price * 100) / 100,
      });
    }
    out.sort((a, b) => a.qty - b.qty);
    return out;
  }

  private async ensureUnitCostSchema(): Promise<void> {
    if (this.unitCostSchemaReady) return;
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_units
        ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0
    `);
    await this.db.query(`
      UPDATE public.tblinventory_variant_units vu
      SET cost_price = COALESCE(v.cost_price, 0),
          updated_at = NOW()
      FROM public.tblinventory_variants v
      WHERE v.id = vu.variant_id
        AND COALESCE(vu.cost_price, 0) = 0
        AND COALESCE(v.cost_price, 0) > 0
    `);
    this.unitCostSchemaReady = true;
  }

  private async ensureUnitStockSchema(): Promise<void> {
    if (this.unitStockSchemaReady) return;
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_units
        ADD COLUMN IF NOT EXISTS stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
    `);
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_units
        ADD COLUMN IF NOT EXISTS stock_warning NUMERIC(12, 3) NOT NULL DEFAULT 0
    `);
    // One-time migrate from variant pools into unit rows (only when unit stock still 0).
    await this.db.query(`
      UPDATE public.tblinventory_variant_units vu
      SET stock_qty = CASE
            WHEN COALESCE(vu.is_manual_entry, FALSE) = TRUE
              OR LOWER(COALESCE(vu.unit_type, '')) IN ('grams', 'gram', 'manual')
              OR LOWER(COALESCE(vu.product_source, '')) = 'retail'
            THEN COALESCE(v.retail_stock_qty, 0)
            WHEN COALESCE(vu.is_default, FALSE) = TRUE
            THEN COALESCE(v.stock_qty, 0)
            ELSE COALESCE(vu.stock_qty, 0)
          END,
          stock_warning = CASE
            WHEN COALESCE(vu.is_manual_entry, FALSE) = TRUE
              OR LOWER(COALESCE(vu.unit_type, '')) IN ('grams', 'gram', 'manual')
              OR LOWER(COALESCE(vu.product_source, '')) = 'retail'
            THEN COALESCE(v.retail_stock_warning, 0)
            WHEN COALESCE(vu.is_default, FALSE) = TRUE
            THEN COALESCE(v.stock_warning, 0)
            ELSE COALESCE(vu.stock_warning, 0)
          END,
          updated_at = NOW()
      FROM public.tblinventory_variants v
      WHERE v.id = vu.variant_id
        AND COALESCE(vu.stock_qty, 0) = 0
        AND (
          COALESCE(v.stock_qty, 0) > 0
          OR COALESCE(v.retail_stock_qty, 0) > 0
        )
    `);
    this.unitStockSchemaReady = true;
  }

  private formatSaveError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('idx_inv_products_org_name')) {
      return 'A product with this name already exists. Edit the existing product from the inventory list to add more variants.';
    }
    if (msg.includes('idx_inv_variants_product_name')) {
      return 'Each variant must have a unique name under the same product.';
    }
    if (msg.includes('idx_variant_units_variant_type')) {
      return 'Could not save unit types. Refresh and try again.';
    }
    if (msg.includes('numeric field overflow')) {
      return 'One of the price or margin values is too large. Check cost, selling, and sale prices.';
    }
    return msg || 'Failed to save product';
  }

  private toFiniteNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private computeMarginPercent(cost: number, selling: number): number | null {
    if (cost <= 0 || selling <= 0) return null;
    const margin = ((selling - cost) / cost) * 100;
    if (!Number.isFinite(margin)) return null;
    const clamped = Math.max(-99999999.99, Math.min(99999999.99, margin));
    return Math.round(clamped * 100) / 100;
  }

  private normalizeUnits(
    v: {
      unitType?: string;
      sellingPrice?: number;
      salePrice?: number | null;
      productSource?: string;
      costPrice?: number;
      units?: Array<{
        id?: number;
        unitType?: string;
        sellingPrice?: number;
        salePrice?: number | null;
        isManualEntry?: boolean;
        isDefault?: boolean;
        productSource?: string;
        stockQty?: number;
        stockWarning?: number;
        costPrice?: number;
        defaultQty?: number;
        qtyPrices?: Array<{ qty?: number; price?: number }>;
      }>;
    },
  ): VariantUnitRow[] {
    const raw = Array.isArray(v.units)
      ? v.units
      : [{
          unitType: v.unitType ?? 'piece',
          sellingPrice: v.sellingPrice ?? 0,
          salePrice: v.salePrice ?? null,
          isManualEntry: v.unitType === 'manual',
          isDefault: true,
          productSource: v.productSource,
          stockQty: 0,
          stockWarning: 0,
          costPrice: v.costPrice ?? 0,
          defaultQty: undefined,
          qtyPrices: [],
        }];
    return raw
      .map((u, index) => {
        const rawType = String(u.unitType ?? 'piece').trim();
        const unitType = rawType.toLowerCase() === 'manual' ? 'grams' : rawType;
        const isManualEntry = Boolean(u.isManualEntry);
        const fallbackDefault =
          isManualEntry || ['grams', 'gram', 'manual'].includes(unitType.toLowerCase()) ? 200 : 1;
        const id = Number((u as { id?: number }).id);
        const qtyPrices = this.normalizeQtyPrices((u as { qtyPrices?: unknown }).qtyPrices);
        const defaultQty = qtyPrices.length
          ? qtyPrices[0].qty
          : Math.max(0.01, this.toFiniteNumber(u.defaultQty, fallbackDefault));
        let sellingPrice = Number(u.sellingPrice ?? 0);
        if (qtyPrices.length && (!Number.isFinite(sellingPrice) || sellingPrice <= 0)) {
          const t = qtyPrices[0];
          sellingPrice = t.qty > 0 ? Math.round((t.price / t.qty) * 1000000) / 1000000 : 0;
        }
        return {
          id: Number.isFinite(id) && id > 0 ? id : undefined,
          unitType,
          sellingPrice,
          salePrice: u.salePrice != null ? Number(u.salePrice) : null,
          isManualEntry,
          isDefault: Boolean(u.isDefault) || (index === 0 && !raw.some((x) => x.isDefault)),
          productSource: this.normalizeUnitProductSource(
            u.productSource,
            unitType,
            isManualEntry,
          ),
          stockQty: this.toFiniteNumber(u.stockQty, 0),
          stockWarning: this.toFiniteNumber(u.stockWarning, 0),
          costPrice: this.toFiniteNumber(u.costPrice, 0),
          defaultQty,
          qtyPrices,
        };
      })
      .filter((u) => u.unitType.length > 0);
  }

  private async loadUnitsMap(variantIds: number[], orgId: number, activeOnly = true) {
    const map = new Map<number, VariantUnitRow[]>();
    if (!variantIds.length) return map;
    await this.ensureUnitCostSchema();
    await this.ensureUnitDefaultQtySchema();
    await this.ensureUnitQtyPricesSchema();
    await this.ensureDuplicateUnitTypesAllowed();
    const activeClause = activeOnly ? 'AND vu.is_active = TRUE' : '';
    const result = await this.db.query<{
      id: number | string;
      variantId: number | string;
      unitType: string;
      sellingPrice: string;
      salePrice: string | null;
      isManualEntry: boolean;
      isDefault: boolean;
      productSource: string;
      stockQty: string;
      stockWarning: string;
      costPrice: string;
      defaultQty: string;
      qtyPrices: unknown;
    }>(
      `SELECT vu.id AS id, vu.variant_id AS "variantId", vu.unit_type AS "unitType",
              vu.selling_price AS "sellingPrice", vu.sale_price AS "salePrice",
              vu.is_manual_entry AS "isManualEntry",
              vu.is_default AS "isDefault",
              COALESCE(vu.product_source, 'Retail') AS "productSource",
              COALESCE(vu.stock_qty, 0)::text AS "stockQty",
              COALESCE(vu.stock_warning, 0)::text AS "stockWarning",
              COALESCE(vu.cost_price, 0)::text AS "costPrice",
              COALESCE(vu.default_qty, 1)::text AS "defaultQty",
              COALESCE(vu.qty_prices, '[]'::jsonb) AS "qtyPrices"
       FROM tblinventory_variant_units vu
       WHERE vu.variant_id = ANY($1::bigint[]) ${activeClause}
         AND (
           NOT EXISTS (SELECT 1 FROM tblorg_unit_types WHERE org_id = $2)
           OR EXISTS (
             SELECT 1 FROM tblorg_unit_types ut
             WHERE ut.org_id = $2
               AND lower(ut.code) = lower(vu.unit_type)
               AND ut.is_active = TRUE
           )
         )
       ORDER BY vu.is_default DESC, vu.sort_order ASC, vu.id ASC`,
      [variantIds, orgId],
    );
    for (const row of result.rows) {
      const variantId = Number(row.variantId);
      if (!Number.isFinite(variantId) || variantId <= 0) continue;
      const list = map.get(variantId) ?? [];
      const unitType = row.unitType;
      const isManualEntry = row.isManualEntry;
      const fallbackDefault =
        isManualEntry || ['grams', 'gram', 'manual'].includes(String(unitType).toLowerCase())
          ? 200
          : 1;
      const qtyPrices = this.normalizeQtyPrices(row.qtyPrices);
      list.push({
        id: Number(row.id),
        unitType,
        sellingPrice: Number(row.sellingPrice ?? 0),
        salePrice: row.salePrice != null ? Number(row.salePrice) : null,
        isManualEntry,
        isDefault: row.isDefault,
        productSource: this.normalizeUnitProductSource(
          row.productSource,
          unitType,
          isManualEntry,
        ),
        stockQty: Number(row.stockQty ?? 0),
        stockWarning: Number(row.stockWarning ?? 0),
        costPrice: Number(row.costPrice ?? 0),
        defaultQty: Math.max(0.01, Number(row.defaultQty ?? fallbackDefault) || fallbackDefault),
        qtyPrices,
      });
      map.set(variantId, list);
    }
    return map;
  }

  private attachUnits<T extends { id: number | string }>(rows: T[], unitsMap: Map<number, VariantUnitRow[]>) {
    return rows.map((row) => ({
      ...row,
      units: unitsMap.get(Number(row.id)) ?? [],
    }));
  }

  private async ensureProductSourceSchema(): Promise<void> {
    await this.db.query(`
      ALTER TABLE public.tblinventory_variants
        ADD COLUMN IF NOT EXISTS product_source TEXT NOT NULL DEFAULT 'Wholesale'
    `);
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_units
        ADD COLUMN IF NOT EXISTS product_source TEXT NOT NULL DEFAULT 'Wholesale'
    `);
    await this.db.query(`
      ALTER TABLE public.tblinventory_variants
        ALTER COLUMN product_source SET DEFAULT 'Wholesale'
    `);
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_units
        ALTER COLUMN product_source SET DEFAULT 'Wholesale'
    `);
    await this.db.query(`
      DO $$
      BEGIN
        ALTER TABLE public.tblinventory_variants
          ADD CONSTRAINT tblinventory_variants_product_source_check
          CHECK (product_source IN ('Retail', 'Wholesale'));
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await this.db.query(`
      DO $$
      BEGIN
        ALTER TABLE public.tblinventory_variant_units
          ADD CONSTRAINT tblinventory_variant_units_product_source_check
          CHECK (product_source IN ('Retail', 'Wholesale'));
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    // One-time repair: grams/manual → Retail; every other unit type → Wholesale.
    if (!this.productSourceRepairDoneV2) {
      await this.db.query(`
        UPDATE public.tblinventory_variant_units
        SET product_source = CASE
              WHEN LOWER(COALESCE(unit_type, '')) IN ('grams', 'gram', 'manual')
                OR COALESCE(is_manual_entry, FALSE) = TRUE
              THEN 'Retail'
              ELSE 'Wholesale'
            END,
            updated_at = NOW()
        WHERE COALESCE(product_source, '') <> CASE
              WHEN LOWER(COALESCE(unit_type, '')) IN ('grams', 'gram', 'manual')
                OR COALESCE(is_manual_entry, FALSE) = TRUE
              THEN 'Retail'
              ELSE 'Wholesale'
            END
      `);
      // Variant denormalized source follows the default unit only.
      await this.db.query(`
        UPDATE public.tblinventory_variants v
        SET product_source = src.product_source, updated_at = NOW()
        FROM (
          SELECT DISTINCT ON (vu.variant_id)
                 vu.variant_id,
                 vu.product_source
          FROM public.tblinventory_variant_units vu
          WHERE COALESCE(vu.is_active, TRUE) = TRUE
          ORDER BY vu.variant_id,
                   CASE WHEN COALESCE(vu.is_default, FALSE) THEN 0 ELSE 1 END,
                   vu.sort_order ASC NULLS LAST,
                   vu.id ASC
        ) src
        WHERE v.id = src.variant_id
          AND COALESCE(v.product_source, '') <> COALESCE(src.product_source, '')
      `);
      this.productSourceRepairDoneV2 = true;
    }
  }

  private normalizeUnitProductSource(
    _value: unknown,
    unitType?: string | null,
    isManualEntry?: boolean,
  ): 'Retail' | 'Wholesale' {
    const unit = String(unitType ?? '').trim().toLowerCase();
    // Grams/gram/manual → Retail. All other unit types → Wholesale.
    if (isManualEntry || unit === 'grams' || unit === 'gram' || unit === 'manual') return 'Retail';
    return 'Wholesale';
  }

  private normalizeProductSource(
    value: unknown,
    units: Array<{ unitType?: string | null; isManualEntry?: boolean; productSource?: string }> = [],
    fallbackUnitType?: string | null,
  ): 'Retail' | 'Wholesale' {
    const primary = units.find((u) => Boolean((u as { isDefault?: boolean }).isDefault)) ?? units[0];
    if (primary) {
      return this.normalizeUnitProductSource(
        primary.productSource ?? value,
        primary.unitType ?? fallbackUnitType,
        primary.isManualEntry,
      );
    }
    return this.normalizeUnitProductSource(value, fallbackUnitType, false);
  }

  private async ensureBeverageSchema(): Promise<void> {
    await this.ensureProductSourceSchema();
    await this.ensureRetailStockSchema();
    await this.ensureUnitStockSchema();
    await this.ensureUnitCostSchema();
    await this.ensureUnitDefaultQtySchema();
    await this.ensureUnitQtyPricesSchema();
    await this.ensureDuplicateUnitTypesAllowed();
    await this.db.query(`
      ALTER TABLE public.tblinventory_variants
        ADD COLUMN IF NOT EXISTS has_sugar_level BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblinventory_variant_subvariants (
        id            BIGSERIAL PRIMARY KEY,
        org_id        BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
        variant_id    BIGINT NOT NULL REFERENCES public.tblinventory_variants(id) ON DELETE CASCADE,
        temp_type     TEXT,
        size_label    TEXT NOT NULL,
        selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        sale_price    NUMERIC(12,2),
        stock_qty     NUMERIC(12,3) NOT NULL DEFAULT 0,
        stock_warning NUMERIC(12,3) NOT NULL DEFAULT 0,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_subvariants
        ADD COLUMN IF NOT EXISTS stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS stock_warning NUMERIC(12, 3) NOT NULL DEFAULT 0
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_inv_subvariants_variant
        ON public.tblinventory_variant_subvariants(variant_id)
        WHERE is_active = TRUE
    `);
  }

  private normalizeTempType(value: unknown): string | null {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'hot' || raw === 'iced') return raw;
    return null;
  }

  private normalizeSubvariants(
    rows?: Array<{
      id?: number;
      sortOrder?: number;
      tempType?: string | null;
      sizeLabel?: string;
      sellingPrice?: number;
      salePrice?: number | null;
      stockQty?: number;
      stockWarning?: number;
    }>,
  ) {
    if (!Array.isArray(rows)) return [] as Array<{
      id?: number;
      tempType: string | null;
      sizeLabel: string;
      sellingPrice: number;
      salePrice: number | null;
      stockQty: number;
      stockWarning: number;
    }>;
    return rows
      .map((r, index) => ({
        id: r.id,
        sortOrder: Number(r.sortOrder ?? index + 1) || (index + 1),
        tempType: this.normalizeTempType(r.tempType),
        sizeLabel: String(r.sizeLabel ?? '').trim(),
        sellingPrice: this.toFiniteNumber(r.sellingPrice, 0),
        salePrice: this.toOptionalNumber(r.salePrice),
        stockQty: this.toFiniteNumber(r.stockQty, 0),
        stockWarning: this.toFiniteNumber(r.stockWarning, 0),
      }))
      .filter((r) => r.sizeLabel.length > 0);
  }

  private async loadSubvariantsMap(variantIds: number[], orgId: number) {
    const map = new Map<number, Array<{
      id: number;
      sortOrder: number;
      tempType: string | null;
      sizeLabel: string;
      sellingPrice: number;
      salePrice: number | null;
      stockQty: number;
      stockWarning: number;
    }>>();
    if (!variantIds.length) return map;
    try {
      await this.ensureBeverageSchema();
      const result = await this.db.query<{
        id: number | string;
        variantId: number | string;
        sortOrder: number | string | null;
        tempType: string | null;
        sizeLabel: string;
        sellingPrice: string;
        salePrice: string | null;
        stockQty: string;
        stockWarning: string;
      }>(
        `SELECT id,
                variant_id AS "variantId",
                sort_order AS "sortOrder",
                temp_type AS "tempType",
                size_label AS "sizeLabel",
                selling_price AS "sellingPrice",
                sale_price AS "salePrice",
                COALESCE(stock_qty, 0)::text AS "stockQty",
                COALESCE(stock_warning, 0)::text AS "stockWarning"
         FROM tblinventory_variant_subvariants
         WHERE org_id = $1
           AND variant_id = ANY($2::bigint[])
           AND is_active = TRUE
         ORDER BY sort_order ASC, id ASC`,
        [orgId, variantIds],
      );
      for (const row of result.rows) {
        const variantId = Number(row.variantId);
        if (!Number.isFinite(variantId) || variantId <= 0) continue;
        const list = map.get(variantId) ?? [];
        list.push({
          id: Number(row.id),
          sortOrder: Number(row.sortOrder ?? 0),
          tempType: row.tempType,
          sizeLabel: row.sizeLabel,
          sellingPrice: Number(row.sellingPrice ?? 0),
          salePrice: row.salePrice != null ? Number(row.salePrice) : null,
          stockQty: Number(row.stockQty ?? 0),
          stockWarning: Number(row.stockWarning ?? 0),
        });
        map.set(variantId, list);
      }
    } catch {
      /* table may not exist yet on older DBs mid-deploy */
    }
    return map;
  }

  private attachSubvariants<T extends { id: number | string }>(
    rows: T[],
    subMap: Map<number, Array<{
      id: number;
      sortOrder?: number;
      tempType: string | null;
      sizeLabel: string;
      sellingPrice: number;
      salePrice: number | null;
      stockQty?: number;
      stockWarning?: number;
    }>>,
  ) {
    return rows.map((row) => ({
      ...row,
      subVariants: subMap.get(Number(row.id)) ?? [],
    }));
  }

  private async saveVariantSubvariants(
    client: { query: DatabaseService['query'] },
    orgId: number,
    variantId: number,
    subVariants: Array<{
      id?: number;
      sortOrder?: number;
      tempType: string | null;
      sizeLabel: string;
      sellingPrice: number;
      salePrice: number | null;
      stockQty: number;
      stockWarning: number;
    }>,
  ) {
    const keptIds: number[] = [];
    const orderedSubVariants = [...subVariants].sort(
      (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
    );
    for (let i = 0; i < orderedSubVariants.length; i++) {
      const s = orderedSubVariants[i];
      if (s.id) {
        await client.query(
          `UPDATE tblinventory_variant_subvariants
           SET temp_type = $1, size_label = $2, selling_price = $3, sale_price = $4,
               stock_qty = $5, stock_warning = $6,
               sort_order = $7, is_active = TRUE, updated_at = NOW()
           WHERE id = $8 AND org_id = $9 AND variant_id = $10`,
          [
            s.tempType,
            s.sizeLabel,
            s.sellingPrice,
            s.salePrice,
            s.stockQty,
            s.stockWarning,
            i + 1,
            s.id,
            orgId,
            variantId,
          ],
        );
        keptIds.push(s.id);
      } else {
        const ins = await client.query<{ id: number }>(
          `INSERT INTO tblinventory_variant_subvariants
             (org_id, variant_id, temp_type, size_label, selling_price, sale_price,
              stock_qty, stock_warning, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            orgId,
            variantId,
            s.tempType,
            s.sizeLabel,
            s.sellingPrice,
            s.salePrice,
            s.stockQty,
            s.stockWarning,
            i + 1,
          ],
        );
        keptIds.push(ins.rows[0].id);
      }
    }
    if (keptIds.length) {
      await client.query(
        `UPDATE tblinventory_variant_subvariants
         SET is_active = FALSE, updated_at = NOW()
         WHERE variant_id = $1 AND org_id = $2 AND id != ALL($3::bigint[])`,
        [variantId, orgId, keptIds],
      );
    } else {
      await client.query(
        `UPDATE tblinventory_variant_subvariants
         SET is_active = FALSE, updated_at = NOW()
         WHERE variant_id = $1 AND org_id = $2`,
        [variantId, orgId],
      );
    }
    await this.syncVariantStockPoolsFromUnits(client, orgId, variantId);
  }

  private async saveVariantUnits(
    client: { query: DatabaseService['query'] },
    orgId: number,
    variantId: number,
    units: VariantUnitRow[],
  ) {
    if (!units.length) {
      await client.query(
        `UPDATE tblinventory_variant_units SET is_active = FALSE, updated_at = NOW()
         WHERE variant_id = $1 AND org_id = $2 AND is_active = TRUE`,
        [variantId, orgId],
      );
      await this.syncVariantStockPoolsFromUnits(client, orgId, variantId);
      return;
    }
    await this.ensureDuplicateUnitTypesAllowed();
    await this.ensureUnitQtyPricesSchema();
    const keptIds: number[] = [];
    const defaultIndex = units.findIndex((u) => u.isDefault);
    const orderedUnits = defaultIndex > 0
      ? [units[defaultIndex], ...units.filter((_, i) => i !== defaultIndex)]
      : units;
    for (let i = 0; i < orderedUnits.length; i++) {
      const u = orderedUnits[i];
      const isDefault = Boolean(u.isDefault) || (defaultIndex < 0 && i === 0);
      const existingId = Number(u.id);
      if (Number.isFinite(existingId) && existingId > 0) {
        const owned = await client.query<{ id: number }>(
          `SELECT id FROM tblinventory_variant_units
           WHERE id = $1 AND variant_id = $2 AND org_id = $3
           LIMIT 1`,
          [existingId, variantId, orgId],
        );
        if (owned.rowCount) {
          await client.query(
            `UPDATE tblinventory_variant_units
             SET unit_type = $1, selling_price = $2, sale_price = $3, is_manual_entry = $4,
                 sort_order = $5, is_default = $6, product_source = $7,
                 stock_qty = $8, stock_warning = $9, cost_price = $10, default_qty = $11,
                 qty_prices = $12::jsonb,
                 is_active = TRUE, updated_at = NOW()
             WHERE id = $13`,
            [
              u.unitType,
              u.sellingPrice,
              u.salePrice,
              u.isManualEntry,
              i + 1,
              isDefault,
              this.normalizeUnitProductSource(u.productSource, u.unitType, u.isManualEntry),
              this.toFiniteNumber(u.stockQty, 0),
              this.toFiniteNumber(u.stockWarning, 0),
              this.toFiniteNumber(u.costPrice, 0),
              Math.max(0.01, this.toFiniteNumber(u.defaultQty, 1)),
              JSON.stringify(this.normalizeQtyPrices(u.qtyPrices)),
              existingId,
            ],
          );
          keptIds.push(existingId);
          continue;
        }
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO tblinventory_variant_units
           (org_id, variant_id, unit_type, selling_price, sale_price, is_manual_entry,
            sort_order, is_default, product_source, stock_qty, stock_warning, cost_price, default_qty, qty_prices)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
         RETURNING id`,
        [
          orgId,
          variantId,
          u.unitType,
          u.sellingPrice,
          u.salePrice,
          u.isManualEntry,
          i + 1,
          isDefault,
          this.normalizeUnitProductSource(u.productSource, u.unitType, u.isManualEntry),
          this.toFiniteNumber(u.stockQty, 0),
          this.toFiniteNumber(u.stockWarning, 0),
          this.toFiniteNumber(u.costPrice, 0),
          Math.max(0.01, this.toFiniteNumber(u.defaultQty, 1)),
          JSON.stringify(this.normalizeQtyPrices(u.qtyPrices)),
        ],
      );
      keptIds.push(Number(inserted.rows[0].id));
    }
    await client.query(
      `UPDATE tblinventory_variant_units SET is_default = FALSE, updated_at = NOW()
       WHERE variant_id = $1 AND org_id = $2 AND is_active = TRUE`,
      [variantId, orgId],
    );
    const defaultUnitId = keptIds[0];
    if (defaultUnitId) {
      await client.query(
        `UPDATE tblinventory_variant_units SET is_default = TRUE, updated_at = NOW()
         WHERE id = $1 AND org_id = $2`,
        [defaultUnitId, orgId],
      );
    }
    if (keptIds.length) {
      await client.query(
        `UPDATE tblinventory_variant_units SET is_active = FALSE, updated_at = NOW()
         WHERE variant_id = $1 AND org_id = $2 AND id != ALL($3::bigint[])`,
        [variantId, orgId, keptIds],
      );
    }
    await this.syncVariantStockPoolsFromUnits(client, orgId, variantId);
  }

  /** Keep variant stock_qty / retail_stock_qty in sync for list/report compatibility. */
  private async syncVariantStockPoolsFromUnits(
    client: { query: DatabaseService['query'] },
    orgId: number,
    variantId: number,
  ): Promise<void> {
    await client.query(
      `UPDATE tblinventory_variants v
       SET stock_qty = COALESCE((
             SELECT SUM(vu.stock_qty)
             FROM tblinventory_variant_units vu
             WHERE vu.variant_id = v.id AND vu.org_id = v.org_id AND vu.is_active = TRUE
               AND COALESCE(vu.is_manual_entry, FALSE) = FALSE
               AND LOWER(COALESCE(vu.unit_type, '')) NOT IN ('grams', 'gram', 'manual')
               AND LOWER(COALESCE(vu.product_source, 'Wholesale')) <> 'retail'
           ), 0)
           + COALESCE((
             SELECT SUM(sv.stock_qty)
             FROM tblinventory_variant_subvariants sv
             WHERE sv.variant_id = v.id AND sv.org_id = v.org_id AND sv.is_active = TRUE
           ), 0),
           stock_warning = COALESCE((
             SELECT SUM(vu.stock_warning)
             FROM tblinventory_variant_units vu
             WHERE vu.variant_id = v.id AND vu.org_id = v.org_id AND vu.is_active = TRUE
               AND COALESCE(vu.is_manual_entry, FALSE) = FALSE
               AND LOWER(COALESCE(vu.unit_type, '')) NOT IN ('grams', 'gram', 'manual')
               AND LOWER(COALESCE(vu.product_source, 'Wholesale')) <> 'retail'
           ), 0)
           + COALESCE((
             SELECT SUM(sv.stock_warning)
             FROM tblinventory_variant_subvariants sv
             WHERE sv.variant_id = v.id AND sv.org_id = v.org_id AND sv.is_active = TRUE
           ), 0),
           retail_stock_qty = COALESCE((
             SELECT SUM(vu.stock_qty)
             FROM tblinventory_variant_units vu
             WHERE vu.variant_id = v.id AND vu.org_id = v.org_id AND vu.is_active = TRUE
               AND (
                 COALESCE(vu.is_manual_entry, FALSE) = TRUE
                 OR LOWER(COALESCE(vu.unit_type, '')) IN ('grams', 'gram', 'manual')
                 OR LOWER(COALESCE(vu.product_source, '')) = 'retail'
               )
           ), 0),
           retail_stock_warning = COALESCE((
             SELECT SUM(vu.stock_warning)
             FROM tblinventory_variant_units vu
             WHERE vu.variant_id = v.id AND vu.org_id = v.org_id AND vu.is_active = TRUE
               AND (
                 COALESCE(vu.is_manual_entry, FALSE) = TRUE
                 OR LOWER(COALESCE(vu.unit_type, '')) IN ('grams', 'gram', 'manual')
                 OR LOWER(COALESCE(vu.product_source, '')) = 'retail'
               )
           ), 0),
           cost_price = COALESCE((
             SELECT vu.cost_price
             FROM tblinventory_variant_units vu
             WHERE vu.variant_id = v.id AND vu.org_id = v.org_id AND vu.is_active = TRUE
             ORDER BY vu.is_default DESC, vu.sort_order ASC
             LIMIT 1
           ), v.cost_price),
           updated_at = NOW()
       WHERE v.id = $1 AND v.org_id = $2`,
      [variantId, orgId],
    );
  }

  private async processImage(file: Express.Multer.File): Promise<string> {
    if (!file?.buffer || file.size <= 0) throw new Error('Image file is required');
    if (!String(file.mimetype ?? '').startsWith('image/')) throw new Error('Only image files are allowed');
    if (file.size > MAX_IMAGE_SIZE) throw new Error('Image must be under 2MB');
    const resizedBuffer = await sharp(file.buffer)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
    return `data:image/webp;base64,${resizedBuffer.toString('base64')}`;
  }

  private validateVariantNames(
    variants: Array<{ variantName: string }>,
  ): string | null {
    const seen = new Set<string>();
    for (const v of variants) {
      const key = String(v.variantName ?? '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        return 'Each variant must have a unique name. Duplicate variant names are not allowed.';
      }
      seen.add(key);
    }
    return null;
  }

  async listProducts(orgId: number, search?: string, category?: string, deletedOnly = false) {
    try {
      const params: unknown[] = [orgId];
      let extra = '';
      const productActive = deletedOnly ? 'FALSE' : 'TRUE';
      const variantActive = deletedOnly ? 'FALSE' : 'TRUE';
      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        extra += ` AND (LOWER(p.name) LIKE LOWER($${idx}) OR LOWER(COALESCE(p.category,'')) LIKE LOWER($${idx}))`;
      }
      if (category?.trim()) {
        params.push(category.trim());
        extra += ` AND LOWER(TRIM(p.category)) = LOWER(TRIM($${params.length}))`;
      }

      const result = await this.db.query<{
        id: number;
        name: string;
        category: string | null;
        brand: string | null;
        description: string | null;
        imageUrl: string | null;
        variantCount: string;
        minPrice: string;
        maxPrice: string;
        totalStock: string;
        hasSale: boolean;
        isActive: boolean;
      }>(
        `SELECT p.id,
                p.name,
                p.category,
                p.brand,
                p.description,
                p.image_url AS "imageUrl",
                COUNT(v.id)::text AS "variantCount",
                COALESCE(MIN(v.selling_price), 0)::text AS "minPrice",
                COALESCE(MAX(v.selling_price), 0)::text AS "maxPrice",
                COALESCE(SUM(v.stock_qty), 0)::text AS "totalStock",
                BOOL_OR(v.sale_price IS NOT NULL AND v.sale_price > 0 AND v.sale_price < v.selling_price) AS "hasSale",
                p.is_active AS "isActive"
         FROM tblinventory_products p
         LEFT JOIN tblinventory_variants v ON v.product_id = p.id AND v.is_active = ${variantActive}
         WHERE p.org_id = $1 AND p.is_active = ${productActive} ${extra}
         GROUP BY p.id
         ORDER BY p.category ASC NULLS LAST, p.name ASC`,
        params,
      );

      return {
        success: true,
        data: result.rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          brand: r.brand,
          description: r.description,
          imageUrl: r.imageUrl,
          variantCount: Number(r.variantCount),
          minPrice: Number(r.minPrice),
          maxPrice: Number(r.maxPrice),
          totalStock: Number(r.totalStock),
          hasSale: r.hasSale,
          isActive: r.isActive,
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load products' };
    }
  }

  async listVariantsByProduct(productId: number, orgId: number) {
    try {
      await this.ensureBeverageSchema();
      const result = await this.db.query(
        `SELECT v.id,
                v.product_id AS "productId",
                p.name AS "productName",
                p.category,
                p.brand,
                v.variant_name AS "variantName",
                v.stock_qty AS "stockQty",
                v.stock_warning AS "stockWarning",
                COALESCE(v.retail_stock_qty, 0) AS "retailStockQty",
                COALESCE(v.retail_stock_warning, 0) AS "retailStockWarning",
                v.cost_price AS "costPrice",
                v.selling_price AS "sellingPrice",
                v.sale_price AS "salePrice",
                v.unit_type AS "unitType",
                v.margin_percent AS "marginPercent",
                v.has_sugar_level AS "hasSugarLevel",
                COALESCE(v.product_source, 'Retail') AS "productSource",
                v.image_url AS "imageUrl",
                p.image_url AS "productImageUrl"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.product_id = $1 AND v.org_id = $2 AND v.is_active = TRUE AND p.is_active = TRUE
         ORDER BY v.sort_order ASC, v.variant_name ASC`,
        [productId, orgId],
      );
      const rows = result.rows.map((r: Record<string, unknown>) => ({
        ...r,
        stockQty: Number(r['stockQty'] ?? 0),
        stockWarning: Number(r['stockWarning'] ?? 0),
        retailStockQty: Number(r['retailStockQty'] ?? 0),
        retailStockWarning: Number(r['retailStockWarning'] ?? 0),
        costPrice: Number(r['costPrice'] ?? 0),
        sellingPrice: Number(r['sellingPrice'] ?? 0),
        salePrice: r['salePrice'] != null ? Number(r['salePrice']) : null,
        marginPercent: r['marginPercent'] != null ? Number(r['marginPercent']) : null,
        hasSugarLevel: Boolean(r['hasSugarLevel']),
        productSource: String(r['productSource'] ?? 'Retail') === 'Wholesale' ? 'Wholesale' : 'Retail',
        imageUrl: r['imageUrl'] ?? null,
      })) as Array<{ id: number } & Record<string, unknown>>;
      const unitsMap = await this.loadUnitsMap(rows.map((r) => r.id), orgId);
      const subMap = await this.loadSubvariantsMap(rows.map((r) => r.id), orgId);
      return {
        success: true,
        data: this.attachSubvariants(this.attachUnits(rows, unitsMap), subMap),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load variants' };
    }
  }

  async listAllVariants(orgId: number, search?: string, category?: string, deletedOnly = false) {
    try {
      await this.ensureBeverageSchema();
      const params: unknown[] = [orgId];
      let extra = '';
      const variantActive = deletedOnly ? 'FALSE' : 'TRUE';
      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        extra += ` AND (LOWER(p.name) LIKE LOWER($${idx}) OR LOWER(v.variant_name) LIKE LOWER($${idx}) OR LOWER(COALESCE(p.category,'')) LIKE LOWER($${idx}))`;
      }
      if (category?.trim()) {
        params.push(category.trim());
        extra += ` AND LOWER(TRIM(p.category)) = LOWER(TRIM($${params.length}))`;
      }

      const result = await this.db.query(
        `SELECT v.id,
                v.product_id AS "productId",
                p.name AS "productName",
                p.category,
                p.brand,
                v.variant_name AS "variantName",
                v.stock_qty AS "stockQty",
                v.stock_warning AS "stockWarning",
                COALESCE(v.retail_stock_qty, 0) AS "retailStockQty",
                COALESCE(v.retail_stock_warning, 0) AS "retailStockWarning",
                v.cost_price AS "costPrice",
                v.selling_price AS "sellingPrice",
                v.sale_price AS "salePrice",
                v.unit_type AS "unitType",
                v.margin_percent AS "marginPercent",
                COALESCE(v.product_source, 'Retail') AS "productSource",
                v.image_url AS "imageUrl",
                p.image_url AS "productImageUrl",
                v.is_active AS "isActive"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.org_id = $1 AND v.is_active = ${variantActive} ${extra}
         ORDER BY p.category ASC NULLS LAST, p.name ASC, v.sort_order ASC`,
        params,
      );

      const rows = result.rows.map((r: Record<string, unknown>) => ({
        ...r,
        stockQty: Number(r['stockQty'] ?? 0),
        stockWarning: Number(r['stockWarning'] ?? 0),
        retailStockQty: Number(r['retailStockQty'] ?? 0),
        retailStockWarning: Number(r['retailStockWarning'] ?? 0),
        costPrice: Number(r['costPrice'] ?? 0),
        sellingPrice: Number(r['sellingPrice'] ?? 0),
        salePrice: r['salePrice'] != null ? Number(r['salePrice']) : null,
        productSource: String(r['productSource'] ?? 'Retail') === 'Wholesale' ? 'Wholesale' : 'Retail',
        marginPercent: r['marginPercent'] != null ? Number(r['marginPercent']) : null,
        imageUrl: r['imageUrl'] ?? r['productImageUrl'] ?? null,
      })) as Array<{ id: number } & Record<string, unknown>>;
      const unitsMap = await this.loadUnitsMap(rows.map((r) => r.id), orgId, !deletedOnly);

      return {
        success: true,
        data: this.attachUnits(rows, unitsMap),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load variants' };
    }
  }

  async getProductWithVariants(productId: number, orgId: number) {
    try {
      const product = await this.db.query(
        `SELECT id, name, category, brand, description, image_url AS "imageUrl"
         FROM tblinventory_products WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [productId, orgId],
      );
      if (product.rowCount === 0) return { success: false, message: 'Product not found' };
      const variants = await this.listVariantsByProduct(productId, orgId);
      return { success: true, data: { ...product.rows[0], variants: variants.data ?? [] } };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load product' };
    }
  }

  async saveProduct(
    orgId: number,
    dto: {
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
        productSource?: string;
        units?: Array<{
          id?: number;
          unitType?: string;
          sellingPrice?: number;
          salePrice?: number | null;
          isManualEntry?: boolean;
        }>;
        subVariants?: Array<{
          id?: number;
          sortOrder?: number;
          tempType?: string | null;
          sizeLabel?: string;
          sellingPrice?: number;
          salePrice?: number | null;
          stockQty?: number;
          stockWarning?: number;
        }>;
      }>;
    },
  ) {
    const name = String(dto.name ?? '').trim();
    if (!name) return { success: false, message: 'Product name is required' };
    if (!dto.variants?.length) return { success: false, message: 'At least one variant is required' };

    const variantNameError = this.validateVariantNames(dto.variants);
    if (variantNameError) return { success: false, message: variantNameError };

    try {
      await this.ensureBeverageSchema();
      let productId = dto.id;
      await this.db.withTransaction(async (client) => {
        if (productId) {
          const conflict = await client.query<{ id: number }>(
            `SELECT id FROM tblinventory_products
             WHERE org_id = $1 AND lower(name) = lower($2) AND id != $3 AND is_active = TRUE
             LIMIT 1`,
            [orgId, name, productId],
          );
          if (conflict.rowCount) {
            throw new Error(
              `A product named "${name}" already exists. Choose a different product name or edit the existing product.`,
            );
          }
          await client.query(
            `UPDATE tblinventory_products
             SET name = $1, category = $2, brand = $3, description = $4, updated_at = NOW()
             WHERE id = $5 AND org_id = $6`,
            [name, dto.category ?? null, dto.brand ?? null, dto.description ?? null, productId, orgId],
          );
        } else {
          const existing = await client.query<{ id: number }>(
            `SELECT id FROM tblinventory_products
             WHERE org_id = $1 AND lower(name) = lower($2) AND is_active = TRUE
             LIMIT 1`,
            [orgId, name],
          );
          if (existing.rowCount) {
            throw new Error(
              `A product named "${name}" already exists. Edit it from the inventory list to add more variants.`,
            );
          }

          const inactive = await client.query<{ id: number }>(
            `SELECT id FROM tblinventory_products
             WHERE org_id = $1 AND lower(name) = lower($2) AND is_active = FALSE
             LIMIT 1`,
            [orgId, name],
          );
          if (inactive.rowCount) {
            productId = inactive.rows[0].id;
            await client.query(
              `UPDATE tblinventory_products
               SET name = $1, category = $2, brand = $3, description = $4,
                   is_active = TRUE, updated_at = NOW()
               WHERE id = $5 AND org_id = $6`,
              [name, dto.category ?? null, dto.brand ?? null, dto.description ?? null, productId, orgId],
            );
          } else {
            const ins = await client.query<{ id: number }>(
              `INSERT INTO tblinventory_products (org_id, name, category, brand, description)
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [orgId, name, dto.category ?? null, dto.brand ?? null, dto.description ?? null],
            );
            productId = ins.rows[0].id;
          }
        }

        const keptIds: number[] = [];
        for (let i = 0; i < dto.variants.length; i++) {
          const v = dto.variants[i];
          const vName = String(v.variantName ?? '').trim();
          if (!vName) continue;
          const units = this.normalizeUnits(v);
          const primary = units[0];
          const stockQty = this.toFiniteNumber(v.stockQty, 0);
          const stockWarning = this.toFiniteNumber(v.stockWarning, 0);
          const retailStockQty = this.toFiniteNumber(
            (v as { retailStockQty?: number }).retailStockQty,
            0,
          );
          const retailStockWarning = this.toFiniteNumber(
            (v as { retailStockWarning?: number }).retailStockWarning,
            0,
          );
          const costPrice = this.toFiniteNumber(v.costPrice, 0);
          const sellingPrice = this.toFiniteNumber(primary?.sellingPrice, 0);
          const salePrice = this.toOptionalNumber(primary?.salePrice);
          const marginPercent = this.computeMarginPercent(costPrice, sellingPrice);
          const hasSugarLevel = Boolean(v.hasSugarLevel);
          const subVariants = this.normalizeSubvariants(v.subVariants);
          const productSource = this.normalizeProductSource(
            v.productSource,
            units,
            primary?.unitType ?? v.unitType,
          );

          let variantId: number;
          if (v.id) {
            variantId = v.id;
            await client.query(
              `UPDATE tblinventory_variants
               SET variant_name = $1, stock_qty = $2, stock_warning = $3,
                   retail_stock_qty = $4, retail_stock_warning = $5,
                   cost_price = $6, selling_price = $7, sale_price = $8,
                   unit_type = $9, margin_percent = $10, sort_order = $11,
                   has_sugar_level = $12, product_source = $13, updated_at = NOW()
               WHERE id = $14 AND org_id = $15 AND product_id = $16`,
              [
                vName, stockQty, stockWarning, retailStockQty, retailStockWarning,
                costPrice, sellingPrice, salePrice,
                primary?.unitType ?? null, marginPercent, i + 1,
                hasSugarLevel, productSource,
                variantId, orgId, productId,
              ],
            );
            keptIds.push(variantId);
          } else {
            const ins = await client.query<{ id: number }>(
              `INSERT INTO tblinventory_variants
                 (org_id, product_id, variant_name, stock_qty, stock_warning,
                  retail_stock_qty, retail_stock_warning,
                  cost_price, selling_price, sale_price, unit_type, margin_percent,
                  sort_order, has_sugar_level, product_source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
              [
                orgId, productId, vName, stockQty, stockWarning,
                retailStockQty, retailStockWarning,
                costPrice, sellingPrice, salePrice,
                primary?.unitType ?? null, marginPercent, i + 1, hasSugarLevel, productSource,
              ],
            );
            variantId = ins.rows[0].id;
            keptIds.push(variantId);
          }
          await this.saveVariantUnits(client, orgId, variantId, units);
          await this.saveVariantSubvariants(client, orgId, variantId, subVariants);
        }

        if (keptIds.length) {
          await client.query(
            `UPDATE tblinventory_variants SET is_active = FALSE, updated_at = NOW()
             WHERE product_id = $1 AND org_id = $2 AND id != ALL($3::bigint[])`,
            [productId, orgId, keptIds],
          );
        }
      });

      return { success: true, id: productId };
    } catch (e) {
      return { success: false, message: this.formatSaveError(e) };
    }
  }

  async bulkImportProducts(
    orgId: number,
    products: Array<{
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
    }>,
  ) {
    if (!Array.isArray(products) || products.length === 0) {
      return { success: false, message: 'No products provided' };
    }
    if (products.length > 500) {
      return { success: false, message: 'Maximum 500 products per import' };
    }

    let importedProducts = 0;
    let updatedProducts = 0;
    let importedVariants = 0;
    let updatedVariants = 0;
    const errors: string[] = [];

    try {
      await this.db.withTransaction(async (client) => {
        for (let i = 0; i < products.length; i++) {
          const p = products[i];
          const name = String(p?.name ?? '').trim();
          if (!name) {
            errors.push(`Row ${i + 1}: Product name is required`);
            continue;
          }
          const variants = (p.variants ?? []).filter((v) => String(v?.variantName ?? '').trim());
          if (!variants.length) {
            errors.push(`Product "${name}": at least one variant with a name is required`);
            continue;
          }
          const variantNameError = this.validateVariantNames(variants);
          if (variantNameError) {
            errors.push(`Product "${name}": ${variantNameError}`);
            continue;
          }

          const category = p.category?.trim() || null;
          if (category) {
            await client.query(
              `INSERT INTO tblinventory_categories (org_id, name)
               VALUES ($1, $2)
               ON CONFLICT (org_id, LOWER(name)) DO NOTHING`,
              [orgId, category],
            );
          }

          const existingProduct = await client.query<{ id: number }>(
            `SELECT id FROM tblinventory_products
             WHERE org_id = $1 AND lower(name) = lower($2) LIMIT 1`,
            [orgId, name],
          );

          let productId: number;
          if (existingProduct.rowCount) {
            productId = existingProduct.rows[0].id;
            await client.query(
              `UPDATE tblinventory_products
               SET category = COALESCE($1, category), brand = COALESCE($2, brand),
                   description = COALESCE($3, description), is_active = TRUE, updated_at = NOW()
               WHERE id = $4 AND org_id = $5`,
              [category, p.brand?.trim() || null, p.description?.trim() || null, productId, orgId],
            );
            updatedProducts++;
          } else {
            const ins = await client.query<{ id: number }>(
              `INSERT INTO tblinventory_products (org_id, name, category, brand, description)
               VALUES ($1,$2,$3,$4,$5) RETURNING id`,
              [orgId, name, category, p.brand?.trim() || null, p.description?.trim() || null],
            );
            productId = ins.rows[0].id;
            importedProducts++;
          }

          for (const v of variants) {
            const vName = String(v.variantName).trim();
            const units = this.normalizeUnits(v);
            const primary = units[0];
            const stockQty = this.toFiniteNumber(v.stockQty, 0);
            const stockWarning = this.toFiniteNumber(v.stockWarning, 0);
            const retailStockQty = this.toFiniteNumber(
              (v as { retailStockQty?: number }).retailStockQty,
              0,
            );
            const retailStockWarning = this.toFiniteNumber(
              (v as { retailStockWarning?: number }).retailStockWarning,
              0,
            );
            const costPrice = this.toFiniteNumber(v.costPrice, 0);
            const sellingPrice = this.toFiniteNumber(primary?.sellingPrice, 0);
            const salePrice = this.toOptionalNumber(primary?.salePrice);
            const marginPercent = this.computeMarginPercent(costPrice, sellingPrice);

            const existingVariant = await client.query<{ id: number }>(
              `SELECT id FROM tblinventory_variants
               WHERE product_id = $1 AND org_id = $2 AND lower(variant_name) = lower($3) LIMIT 1`,
              [productId, orgId, vName],
            );

            let variantId: number;
            if (existingVariant.rowCount) {
              variantId = existingVariant.rows[0].id;
              await client.query(
                `UPDATE tblinventory_variants
                 SET stock_qty = $1, stock_warning = $2,
                     retail_stock_qty = $3, retail_stock_warning = $4,
                     cost_price = $5, selling_price = $6,
                     sale_price = $7, unit_type = $8, margin_percent = $9, is_active = TRUE, updated_at = NOW()
                 WHERE id = $10 AND org_id = $11`,
                [
                  stockQty, stockWarning, retailStockQty, retailStockWarning,
                  costPrice, sellingPrice, salePrice, primary?.unitType ?? null, marginPercent,
                  variantId, orgId,
                ],
              );
              updatedVariants++;
            } else {
              const ins = await client.query<{ id: number }>(
                `INSERT INTO tblinventory_variants
                   (org_id, product_id, variant_name, stock_qty, stock_warning,
                    retail_stock_qty, retail_stock_warning,
                    cost_price, selling_price, sale_price, unit_type, margin_percent)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
                [
                  orgId, productId, vName, stockQty, stockWarning,
                  retailStockQty, retailStockWarning,
                  costPrice, sellingPrice, salePrice, primary?.unitType ?? null, marginPercent,
                ],
              );
              variantId = ins.rows[0].id;
              importedVariants++;
            }
            await this.saveVariantUnits(client, orgId, variantId, units);
          }
        }
      });

      return {
        success: true,
        importedProducts,
        updatedProducts,
        importedVariants,
        updatedVariants,
        errors: errors.length ? errors : undefined,
      };
    } catch (e) {
      return { success: false, message: this.formatSaveError(e) };
    }
  }

  async deleteVariant(variantId: number, orgId: number) {
    try {
      await this.db.withTransaction(async (client) => {
        await client.query(
          `UPDATE tblinventory_variant_units SET is_active = FALSE, updated_at = NOW()
           WHERE variant_id = $1 AND org_id = $2`,
          [variantId, orgId],
        );
        const result = await client.query(
          `UPDATE tblinventory_variants SET is_active = FALSE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 RETURNING id`,
          [variantId, orgId],
        );
        if (result.rowCount === 0) {
          throw new Error('Variant not found');
        }
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to delete variant' };
    }
  }

  async deleteProduct(productId: number, orgId: number) {
    try {
      await this.db.withTransaction(async (client) => {
        await client.query(
          `UPDATE tblinventory_variant_units SET is_active = FALSE, updated_at = NOW()
           WHERE org_id = $2 AND variant_id IN (
             SELECT id FROM tblinventory_variants WHERE product_id = $1 AND org_id = $2
           )`,
          [productId, orgId],
        );
        await client.query(
          `UPDATE tblinventory_variants SET is_active = FALSE, updated_at = NOW()
           WHERE product_id = $1 AND org_id = $2`,
          [productId, orgId],
        );
        const result = await client.query(
          `UPDATE tblinventory_products SET is_active = FALSE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 RETURNING id`,
          [productId, orgId],
        );
        if (result.rowCount === 0) throw new Error('Product not found');
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to delete product' };
    }
  }

  async restoreProduct(productId: number, orgId: number) {
    try {
      await this.db.withTransaction(async (client) => {
        const product = await client.query<{ id: number }>(
          `UPDATE tblinventory_products SET is_active = TRUE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 AND is_active = FALSE
           RETURNING id`,
          [productId, orgId],
        );
        if (product.rowCount === 0) throw new Error('Deleted product not found');

        await client.query(
          `UPDATE tblinventory_variants SET is_active = TRUE, updated_at = NOW()
           WHERE product_id = $1 AND org_id = $2`,
          [productId, orgId],
        );
        await client.query(
          `UPDATE tblinventory_variant_units SET is_active = TRUE, updated_at = NOW()
           WHERE org_id = $2 AND variant_id IN (
             SELECT id FROM tblinventory_variants WHERE product_id = $1 AND org_id = $2
           )`,
          [productId, orgId],
        );
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to restore product' };
    }
  }

  async updateVariant(
    variantId: number,
    orgId: number,
    dto: {
      variantName: string;
      stockQty?: number;
      stockWarning?: number;
      costPrice?: number;
      sellingPrice?: number;
      salePrice?: number | null;
      unitType?: string;
      hasSugarLevel?: boolean;
      productSource?: string;
      units?: Array<{
        id?: number;
        unitType?: string;
        sellingPrice?: number;
        salePrice?: number | null;
        isManualEntry?: boolean;
      }>;
      subVariants?: Array<{
        id?: number;
        sortOrder?: number;
        tempType?: string | null;
        sizeLabel?: string;
        sellingPrice?: number;
        salePrice?: number | null;
        stockQty?: number;
        stockWarning?: number;
      }>;
    },
  ) {
    const vName = String(dto.variantName ?? '').trim();
    if (!vName) return { success: false, message: 'Variant name is required' };

    try {
      await this.ensureBeverageSchema();
      await this.db.withTransaction(async (client) => {
        const existing = await client.query<{ productId: number }>(
          `SELECT product_id AS "productId"
           FROM tblinventory_variants
           WHERE id = $1 AND org_id = $2 AND is_active = TRUE
           LIMIT 1`,
          [variantId, orgId],
        );
        if (existing.rowCount === 0) throw new Error('Variant not found');

        const productId = existing.rows[0].productId;
        const duplicate = await client.query<{ id: number }>(
          `SELECT id FROM tblinventory_variants
           WHERE product_id = $1 AND org_id = $2 AND lower(variant_name) = lower($3)
             AND id != $4 AND is_active = TRUE
           LIMIT 1`,
          [productId, orgId, vName, variantId],
        );
        if (duplicate.rowCount) {
          throw new Error('Each variant must have a unique name under the same product.');
        }

        const units = this.normalizeUnits(dto);
        const primary = units[0];
        const stockQty = this.toFiniteNumber(dto.stockQty, 0);
        const stockWarning = this.toFiniteNumber(dto.stockWarning, 0);
        const retailStockQty = this.toFiniteNumber(
          (dto as { retailStockQty?: number }).retailStockQty,
          0,
        );
        const retailStockWarning = this.toFiniteNumber(
          (dto as { retailStockWarning?: number }).retailStockWarning,
          0,
        );
        const costPrice = this.toFiniteNumber(dto.costPrice, 0);
        const sellingPrice = this.toFiniteNumber(primary?.sellingPrice ?? dto.sellingPrice, 0);
        const salePrice = this.toOptionalNumber(primary?.salePrice ?? dto.salePrice);
        const marginPercent = this.computeMarginPercent(costPrice, sellingPrice);
        const hasSugarLevel = Boolean(dto.hasSugarLevel);
        const subVariants = this.normalizeSubvariants(dto.subVariants);
        const productSource = this.normalizeProductSource(
          dto.productSource,
          units,
          primary?.unitType ?? dto.unitType,
        );

        await client.query(
          `UPDATE tblinventory_variants
           SET variant_name = $1, stock_qty = $2, stock_warning = $3,
               retail_stock_qty = $4, retail_stock_warning = $5,
               cost_price = $6, selling_price = $7, sale_price = $8,
               unit_type = $9, margin_percent = $10, has_sugar_level = $11,
               product_source = $12, updated_at = NOW()
           WHERE id = $13 AND org_id = $14`,
          [
            vName, stockQty, stockWarning, retailStockQty, retailStockWarning,
            costPrice, sellingPrice, salePrice,
            primary?.unitType ?? null, marginPercent, hasSugarLevel, productSource,
            variantId, orgId,
          ],
        );
        await this.saveVariantUnits(client, orgId, variantId, units);
        await this.saveVariantSubvariants(client, orgId, variantId, subVariants);
      });
      return { success: true, id: variantId };
    } catch (e) {
      return { success: false, message: this.formatSaveError(e) };
    }
  }

  async duplicateVariant(variantId: number, orgId: number) {
    try {
      await this.ensureBeverageSchema();

      const source = await this.db.query<{
        id: number;
        productId: number;
        productName: string;
        category: string | null;
        brand: string | null;
        variantName: string;
        stockWarning: string;
        costPrice: string;
        sellingPrice: string;
        salePrice: string | null;
        unitType: string | null;
        marginPercent: string | null;
        imageUrl: string | null;
        hasSugarLevel: boolean;
        productSource: string;
        sortOrder: number | null;
      }>(
        `SELECT v.id,
                v.product_id AS "productId",
                p.name AS "productName",
                p.category,
                p.brand,
                v.variant_name AS "variantName",
                v.stock_warning::text AS "stockWarning",
                v.cost_price::text AS "costPrice",
                v.selling_price::text AS "sellingPrice",
                v.sale_price::text AS "salePrice",
                v.unit_type AS "unitType",
                v.margin_percent::text AS "marginPercent",
                v.image_url AS "imageUrl",
                COALESCE(v.has_sugar_level, FALSE) AS "hasSugarLevel",
                COALESCE(v.product_source, 'Retail') AS "productSource",
                v.sort_order AS "sortOrder"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.id = $1 AND v.org_id = $2 AND v.is_active = TRUE AND p.is_active = TRUE
         LIMIT 1`,
        [variantId, orgId],
      );
      if (!source.rowCount) {
        return { success: false, message: 'Variant not found' };
      }

      const row = source.rows[0];
      const unitsMap = await this.loadUnitsMap([variantId], orgId, true);
      const subMap = await this.loadSubvariantsMap([variantId], orgId);
      const units = unitsMap.get(variantId) ?? [];
      const subVariants = (subMap.get(variantId) ?? []).map((s) => ({
        sortOrder: s.sortOrder,
        tempType: s.tempType,
        sizeLabel: s.sizeLabel,
        sellingPrice: s.sellingPrice,
        salePrice: s.salePrice,
        stockQty: 0,
        stockWarning: Number(s.stockWarning ?? 0),
      }));

      const existingNames = await this.db.query<{ variantName: string }>(
        `SELECT variant_name AS "variantName"
         FROM tblinventory_variants
         WHERE product_id = $1 AND org_id = $2 AND is_active = TRUE`,
        [row.productId, orgId],
      );
      const used = new Set(existingNames.rows.map((r) => r.variantName.trim().toLowerCase()));
      const baseName = String(row.variantName ?? '').trim() || 'Variant';
      let copyName = `${baseName} (copy)`;
      let suffix = 2;
      while (used.has(copyName.toLowerCase())) {
        copyName = `${baseName} (copy ${suffix})`;
        suffix += 1;
      }

      const primary = units[0];
      const costPrice = Number(row.costPrice ?? 0);
      const sellingPrice = Number(primary?.sellingPrice ?? row.sellingPrice ?? 0);
      const salePrice =
        primary?.salePrice != null
          ? Number(primary.salePrice)
          : row.salePrice != null
            ? Number(row.salePrice)
            : null;
      const marginPercent = this.computeMarginPercent(costPrice, sellingPrice);
      const stockWarning = Number(row.stockWarning ?? 0);
      const unitType = primary?.unitType ?? row.unitType ?? null;
      const hasSugarLevel = Boolean(row.hasSugarLevel);
      const productSource = this.normalizeProductSource(row.productSource, units, unitType);
      const sortOrder = Number(row.sortOrder ?? 0) || 1;

      let newId = 0;
      await this.db.withTransaction(async (client) => {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO tblinventory_variants
             (org_id, product_id, variant_name, stock_qty, stock_warning,
              cost_price, selling_price, sale_price, unit_type, margin_percent,
              sort_order, has_sugar_level, product_source, image_url)
           VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            orgId,
            row.productId,
            copyName,
            stockWarning,
            costPrice,
            sellingPrice,
            salePrice,
            unitType,
            marginPercent,
            sortOrder,
            hasSugarLevel,
            productSource,
            row.imageUrl,
          ],
        );
        newId = inserted.rows[0].id;
        await this.saveVariantUnits(
          client,
          orgId,
          newId,
          units.length
            ? units
            : [{
                unitType: unitType ?? 'piece',
                sellingPrice,
                salePrice,
                isManualEntry: false,
                isDefault: true,
              }],
        );
        await this.saveVariantSubvariants(client, orgId, newId, subVariants);
        await client.query(
          `UPDATE tblinventory_products SET updated_at = NOW() WHERE id = $1 AND org_id = $2`,
          [row.productId, orgId],
        );
      });

      return {
        success: true,
        data: {
          id: newId,
          productId: row.productId,
          productName: row.productName,
          variantName: copyName,
          category: row.category,
          brand: row.brand,
          stockQty: 0,
          stockWarning,
          costPrice,
          sellingPrice,
          salePrice,
          unitType,
          marginPercent,
          imageUrl: row.imageUrl,
          hasSugarLevel,
          units,
          subVariants,
        },
      };
    } catch (e) {
      return { success: false, message: this.formatSaveError(e) };
    }
  }

  async restoreVariant(variantId: number, orgId: number) {
    try {
      await this.db.withTransaction(async (client) => {
        const variant = await client.query<{ productId: number }>(
          `UPDATE tblinventory_variants SET is_active = TRUE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 AND is_active = FALSE
           RETURNING product_id AS "productId"`,
          [variantId, orgId],
        );
        if (variant.rowCount === 0) throw new Error('Deleted variant not found');

        await client.query(
          `UPDATE tblinventory_variant_units SET is_active = TRUE, updated_at = NOW()
           WHERE variant_id = $1 AND org_id = $2`,
          [variantId, orgId],
        );
        await client.query(
          `UPDATE tblinventory_products SET is_active = TRUE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 AND is_active = FALSE`,
          [variant.rows[0].productId, orgId],
        );
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to restore variant' };
    }
  }

  async uploadProductImageFile(productId: number, orgId: number, file: Express.Multer.File) {
    try {
      if (!file?.buffer?.length) {
        return { success: false, message: 'Image file is required' };
      }
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM tblinventory_products WHERE id = $1 AND org_id = $2 AND is_active = TRUE`,
        [productId, orgId],
      );
      if (existing.rowCount === 0) return { success: false, message: 'Product not found' };
      const dataUrl = await this.processImage(file);
      await this.db.query(
        `UPDATE tblinventory_products SET image_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [dataUrl, productId, orgId],
      );
      return { success: true, data: { imageUrl: dataUrl } };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to upload image' };
    }
  }

  async removeProductImageFile(productId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `UPDATE tblinventory_products SET image_url = NULL, updated_at = NOW()
         WHERE id = $1 AND org_id = $2 RETURNING id`,
        [productId, orgId],
      );
      if (result.rowCount === 0) return { success: false, message: 'Product not found' };
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to remove image' };
    }
  }

  async uploadVariantImageFile(variantId: number, orgId: number, file: Express.Multer.File) {
    try {
      if (!file?.buffer?.length) {
        return { success: false, message: 'Image file is required' };
      }
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM tblinventory_variants WHERE id = $1 AND org_id = $2 AND is_active = TRUE`,
        [variantId, orgId],
      );
      if (existing.rowCount === 0) return { success: false, message: 'Variant not found' };
      const dataUrl = await this.processImage(file);
      await this.db.query(
        `UPDATE tblinventory_variants SET image_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [dataUrl, variantId, orgId],
      );
      return { success: true, data: { imageUrl: dataUrl } };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to upload image' };
    }
  }

  async removeVariantImageFile(variantId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `UPDATE tblinventory_variants SET image_url = NULL, updated_at = NOW()
         WHERE id = $1 AND org_id = $2 RETURNING id`,
        [variantId, orgId],
      );
      if (result.rowCount === 0) return { success: false, message: 'Variant not found' };
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to remove image' };
    }
  }
}
