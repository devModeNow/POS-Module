import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { PosDiscountsService } from './discounts.service';
import { PosNotificationsService } from './pos-notifications.service';
import { PosPaymentMethodsService } from './payment-methods.service';
import {
  isGramsSellUnit,
  isRetailSellUnit,
  sellQtyToStockQty,
} from '../utils/weight-stock.util';

export type CheckoutItem = {
  variantId: number;
  quantity: number;
  unitType?: string;
  unitId?: number | null;
  subVariantId?: number | null;
  lineDiscount?: number;
};

export type CheckoutPayload = {
  items: CheckoutItem[];
  discountId?: number | null;
  discountAmount?: number;
  amountPaid?: number;
  paymentMethodId?: number | null;
  referenceNumber?: string | null;
  customerFullName?: string | null;
  /** Base64 data URL or remote URL for non-cash payment proof. */
  paymentProofImage?: string | null;
};

type PosSubVariant = {
  id: number;
  sortOrder: number;
  tempType: string | null;
  sizeLabel: string;
  sellingPrice: number;
  salePrice: number | null;
  stockQty: number;
  stockWarning: number;
};

type PosQtyPrice = { qty: number; price: number };

type PosVariantUnitRow = {
  id?: number;
  unitType: string;
  sellingPrice: number;
  salePrice: number | null;
  isManualEntry: boolean;
  isDefault: boolean;
  productSource?: 'Retail' | 'Wholesale';
  stockQty?: number;
  stockWarning?: number;
  defaultQty?: number;
  qtyPrices?: PosQtyPrice[];
};

@Injectable()
export class PosTerminalService {
  private readonly logger = new Logger(PosTerminalService.name);
  private beverageSchemaReady = false;
  private unitStockSchemaReady = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly discountsService: PosDiscountsService,
    private readonly paymentMethodsService: PosPaymentMethodsService,
    private readonly notificationsService: PosNotificationsService,
  ) {}

  private async ensureUnitStockSchema(): Promise<void> {
    if (this.unitStockSchemaReady) return;
    try {
      await this.db.query(`
        ALTER TABLE public.tblinventory_variant_units
          ADD COLUMN IF NOT EXISTS stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
      `);
      await this.db.query(`
        ALTER TABLE public.tblinventory_variant_units
          ADD COLUMN IF NOT EXISTS stock_warning NUMERIC(12, 3) NOT NULL DEFAULT 0
      `);
      await this.db.query(`
        ALTER TABLE public.tblinventory_variant_units
          ADD COLUMN IF NOT EXISTS default_qty NUMERIC(12, 3) NOT NULL DEFAULT 1
      `);
      await this.db.query(`
        ALTER TABLE public.tblinventory_variant_units
          ADD COLUMN IF NOT EXISTS qty_prices JSONB NOT NULL DEFAULT '[]'::jsonb
      `);
      await this.db.query(`DROP INDEX IF EXISTS public.idx_variant_units_variant_type`);
      await this.db.query(`
        ALTER TABLE public.tblsales_transactions
          ADD COLUMN IF NOT EXISTS variant_unit_id BIGINT
      `);
      this.unitStockSchemaReady = true;
    } catch (e) {
      this.logger.warn(`Unit stock schema ensure skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  private normalizeQtyPrices(raw: unknown): PosQtyPrice[] {
    if (!Array.isArray(raw)) return [];
    const out: PosQtyPrice[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const qty = Number((item as { qty?: unknown }).qty);
      const price = Number((item as { price?: unknown }).price);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) continue;
      out.push({ qty: Math.round(qty * 1000) / 1000, price: Math.round(price * 100) / 100 });
    }
    return out.sort((a, b) => a.qty - b.qty);
  }

  private unitRateFromQtyPrice(tier: PosQtyPrice): number {
    if (!tier.qty) return 0;
    return Math.round((tier.price / tier.qty) * 1000000) / 1000000;
  }

  private matchQtyPrice(tiers: PosQtyPrice[] | undefined, qty: number): PosQtyPrice | null {
    if (!tiers?.length) return null;
    return (
      tiers.find((t) => Math.abs(t.qty - qty) < 0.0005) ?? null
    );
  }

  private isBankTransferMethod(method: { code?: string | null; name?: string | null } | null | undefined): boolean {
    const code = String(method?.code ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const name = String(method?.name ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const haystack = `${code} ${name}`;
    return haystack.includes('banktransfer') || (haystack.includes('bank') && haystack.includes('transfer'));
  }

  private isFoodPandaMethod(method: { code?: string | null; name?: string | null } | null | undefined): boolean {
    const code = String(method?.code ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const name = String(method?.name ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const haystack = `${code} ${name}`;
    return haystack.includes('foodpanda') || haystack.includes('food_panda');
  }

  private isCashMethod(method: { code?: string | null; name?: string | null } | null | undefined): boolean {
    const code = String(method?.code ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const name = String(method?.name ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    const haystack = `${code} ${name}`;
    if (!haystack.trim()) return true;
    if (haystack.includes('gcash')) return false;
    return code === 'cash' || name === 'cash' || haystack.includes('cash payment');
  }

  private async ensureBeverageSchema(): Promise<void> {
    if (this.beverageSchemaReady) return;
    try {
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
      this.beverageSchemaReady = true;
    } catch (e) {
      this.logger.warn(`Beverage schema ensure skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async loadUnitsMap(orgId: number, variantIds: number[]): Promise<Map<number, PosVariantUnitRow[]>> {
    const unitsMap = new Map<number, PosVariantUnitRow[]>();
    if (!variantIds.length) return unitsMap;
    await this.ensureUnitStockSchema();
    const unitsResult = await this.db.query<{
      id: number;
      variantId: number;
      unitType: string;
      sellingPrice: string;
      salePrice: string | null;
      isManualEntry: boolean;
      isDefault: boolean;
      productSource: string;
      stockQty: string;
      stockWarning: string;
      defaultQty: string;
      qtyPrices: unknown;
    }>(
      `SELECT vu.id AS id, vu.variant_id AS "variantId", vu.unit_type AS "unitType",
              vu.selling_price AS "sellingPrice", vu.sale_price AS "salePrice",
              vu.is_manual_entry AS "isManualEntry",
              vu.is_default AS "isDefault",
              COALESCE(vu.product_source, 'Wholesale') AS "productSource",
              COALESCE(vu.stock_qty, 0)::text AS "stockQty",
              COALESCE(vu.stock_warning, 0)::text AS "stockWarning",
              COALESCE(vu.default_qty, 1)::text AS "defaultQty",
              COALESCE(vu.qty_prices, '[]'::jsonb) AS "qtyPrices"
       FROM tblinventory_variant_units vu
       WHERE vu.variant_id = ANY($1::bigint[]) AND vu.is_active = TRUE
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
    for (const u of unitsResult.rows) {
      const list = unitsMap.get(u.variantId) ?? [];
      const fallbackDefault =
        u.isManualEntry || ['grams', 'gram', 'manual'].includes(String(u.unitType).toLowerCase())
          ? 200
          : 1;
      list.push({
        id: Number(u.id),
        unitType: u.unitType,
        sellingPrice: Number(u.sellingPrice ?? 0),
        salePrice: u.salePrice != null ? Number(u.salePrice) : null,
        isManualEntry: u.isManualEntry,
        isDefault: u.isDefault,
        productSource: String(u.productSource ?? 'Wholesale') === 'Retail' ? 'Retail' : 'Wholesale',
        stockQty: Number(u.stockQty ?? 0),
        stockWarning: Number(u.stockWarning ?? 0),
        defaultQty: Math.max(0.01, Number(u.defaultQty ?? fallbackDefault) || fallbackDefault),
        qtyPrices: this.normalizeQtyPrices(u.qtyPrices),
      });
      unitsMap.set(u.variantId, list);
    }
    return unitsMap;
  }

  private async loadBeverageExtras(orgId: number, variantIds: number[]): Promise<{
    sugarMap: Map<number, boolean>;
    subMap: Map<number, PosSubVariant[]>;
  }> {
    const sugarMap = new Map<number, boolean>();
    const subMap = new Map<number, PosSubVariant[]>();
    if (!variantIds.length) return { sugarMap, subMap };
    await this.ensureBeverageSchema();
    try {
      const sugarResult = await this.db.query<{ id: number; hasSugarLevel: boolean }>(
        `SELECT id, COALESCE(has_sugar_level, FALSE) AS "hasSugarLevel"
         FROM tblinventory_variants
         WHERE org_id = $1 AND id = ANY($2::bigint[])`,
        [orgId, variantIds],
      );
      for (const row of sugarResult.rows) {
        sugarMap.set(row.id, Boolean(row.hasSugarLevel));
      }
    } catch {
      /* column may be missing mid-deploy */
    }
    try {
      const subResult = await this.db.query<{
        id: number;
        variantId: number;
        sortOrder: number;
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
      for (const row of subResult.rows) {
        const list = subMap.get(row.variantId) ?? [];
        list.push({
          id: row.id,
          sortOrder: Number(row.sortOrder ?? 0),
          tempType: row.tempType,
          sizeLabel: row.sizeLabel,
          sellingPrice: Number(row.sellingPrice ?? 0),
          salePrice: row.salePrice != null ? Number(row.salePrice) : null,
          stockQty: Number(row.stockQty ?? 0),
          stockWarning: Number(row.stockWarning ?? 0),
        });
        subMap.set(row.variantId, list);
      }
    } catch {
      /* table may be missing mid-deploy */
    }
    return { sugarMap, subMap };
  }

  private resolveUnits(
    row: { id: number; sellingPrice: string | number; salePrice: string | number | null },
    unitsMap: Map<number, PosVariantUnitRow[]>,
  ): PosVariantUnitRow[] {
    const units = unitsMap.get(row.id) ?? [];
    if (units.length) return units;
    return [{
      unitType: 'piece',
      sellingPrice: Number(row.sellingPrice ?? 0),
      salePrice: row.salePrice != null ? Number(row.salePrice) : null,
      isManualEntry: false,
      isDefault: true,
      stockQty: 0,
      stockWarning: 0,
      defaultQty: 1,
    }];
  }

  async listCategories(orgId: number) {
    try {
      const result = await this.db.query<{ category: string }>(
        `SELECT DISTINCT TRIM(category) AS category
         FROM tblinventory_products
         WHERE org_id = $1 AND category IS NOT NULL AND TRIM(category) <> '' AND is_active = TRUE
         ORDER BY category ASC`,
        [orgId],
      );
      return { success: true, data: result.rows.map((r) => r.category) };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load categories',
      };
    }
  }

  async listProducts(orgId: number, search?: string, category?: string) {
    try {
      const params: unknown[] = [orgId];
      let extra = '';
      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        extra += ` AND (
          LOWER(p.name) LIKE LOWER($${idx})
          OR LOWER(COALESCE(p.category,'')) LIKE LOWER($${idx})
          OR EXISTS (
            SELECT 1 FROM tblinventory_variants sv
            WHERE sv.product_id = p.id AND sv.is_active = TRUE
              AND LOWER(sv.variant_name) LIKE LOWER($${idx})
          )
        )`;
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
        imageUrl: string | null;
        variantCount: string;
        minPrice: string;
        maxPrice: string;
        minSalePrice: string | null;
        totalStock: string;
        hasSale: boolean;
      }>(
        `SELECT p.id,
                p.name,
                p.category,
                p.brand,
                p.image_url AS "imageUrl",
                COUNT(v.id)::text AS "variantCount",
                COALESCE(
                  MIN(
                    CASE
                      WHEN COALESCE(v.selling_price, 0) <= 0 AND svp."firstSellingPrice" IS NOT NULL
                        THEN svp."firstSellingPrice"
                      ELSE COALESCE(svp."minSellingPrice", v.selling_price)
                    END
                  ),
                  0
                )::text AS "minPrice",
                COALESCE(
                  MAX(
                    CASE
                      WHEN COALESCE(v.selling_price, 0) <= 0 AND svp."firstSellingPrice" IS NOT NULL
                        THEN svp."firstSellingPrice"
                      ELSE COALESCE(svp."maxSellingPrice", v.selling_price)
                    END
                  ),
                  0
                )::text AS "maxPrice",
                MIN(
                  CASE
                    WHEN COALESCE(v.selling_price, 0) <= 0 AND svp."firstSalePrice" IS NOT NULL
                      THEN svp."firstSalePrice"
                    ELSE COALESCE(
                      svp."minSalePrice",
                      CASE WHEN v.sale_price > 0 AND v.sale_price < v.selling_price THEN v.sale_price END
                    )
                  )
                )::text AS "minSalePrice",
                COALESCE(SUM(v.stock_qty), 0)::text AS "totalStock",
                BOOL_OR(
                  (
                    COALESCE(v.selling_price, 0) <= 0
                    AND svp."firstSalePrice" IS NOT NULL
                  )
                  OR COALESCE(svp."hasSale", FALSE)
                  OR (v.sale_price IS NOT NULL AND v.sale_price > 0 AND v.sale_price < v.selling_price)
                ) AS "hasSale"
         FROM tblinventory_products p
         LEFT JOIN tblinventory_variants v ON v.product_id = p.id AND v.is_active = TRUE
         LEFT JOIN (
           SELECT sv.variant_id AS "variantId",
                  (
                    ARRAY_AGG(sv.selling_price ORDER BY sv.sort_order ASC, sv.id ASC)
                  )[1] AS "firstSellingPrice",
                  (
                    ARRAY_AGG(sv.sale_price ORDER BY sv.sort_order ASC, sv.id ASC)
                  )[1] AS "firstSalePrice",
                  MIN(sv.selling_price) AS "minSellingPrice",
                  MAX(sv.selling_price) AS "maxSellingPrice",
                  MIN(CASE WHEN sv.sale_price > 0 AND sv.sale_price < sv.selling_price THEN sv.sale_price END) AS "minSalePrice",
                  BOOL_OR(sv.sale_price IS NOT NULL AND sv.sale_price > 0 AND sv.sale_price < sv.selling_price) AS "hasSale"
           FROM tblinventory_variant_subvariants sv
           WHERE sv.is_active = TRUE
           GROUP BY sv.variant_id
         ) svp ON svp."variantId" = v.id
         LEFT JOIN (
           SELECT v2.product_id, COALESCE(SUM(st.quantity_sold), 0)::bigint AS total_sold
           FROM tblsales_transactions st
           INNER JOIN tblinventory_variants v2 ON v2.id = st.variant_id
           WHERE st.org_id = $1 AND st.variant_id IS NOT NULL
           GROUP BY v2.product_id
         ) sales ON sales.product_id = p.id
         WHERE p.org_id = $1 AND p.is_active = TRUE ${extra}
         GROUP BY p.id, sales.total_sold
         HAVING COUNT(v.id) > 0
         ORDER BY COALESCE(sales.total_sold, 0) DESC, p.category ASC NULLS LAST, p.name ASC`,
        params,
      );

      const data = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        brand: row.brand,
        imageUrl: row.imageUrl,
        variantCount: Number(row.variantCount),
        minPrice: Number(row.minPrice),
        maxPrice: Number(row.maxPrice),
        minSalePrice: row.minSalePrice != null ? Number(row.minSalePrice) : null,
        totalStock: Number(row.totalStock),
        hasSale: row.hasSale,
        inStock: Number(row.totalStock) > 0,
      }));

      return { success: true, data };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load products',
      };
    }
  }

  async listVariants(productId: number, orgId: number) {
    try {
      const result = await this.db.query<{
        id: number;
        productId: number;
        productName: string;
        variantName: string;
        category: string | null;
        stockQty: number;
        retailStockQty: number;
        sellingPrice: string;
        salePrice: string | null;
        unitType: string | null;
        imageUrl: string | null;
        productImageUrl: string | null;
      }>(
        `SELECT v.id,
                v.product_id AS "productId",
                p.name AS "productName",
                v.variant_name AS "variantName",
                p.category,
                v.stock_qty AS "stockQty",
                COALESCE(v.retail_stock_qty, 0) AS "retailStockQty",
                v.selling_price AS "sellingPrice",
                v.sale_price AS "salePrice",
                v.unit_type AS "unitType",
                v.image_url AS "imageUrl",
                p.image_url AS "productImageUrl"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.product_id = $1 AND v.org_id = $2 AND v.is_active = TRUE AND p.is_active = TRUE
         ORDER BY v.sort_order ASC, v.variant_name ASC`,
        [productId, orgId],
      );

      const variantIds = result.rows.map((r) => r.id);
      const [unitsMap, beverageExtras] = await Promise.all([
        this.loadUnitsMap(orgId, variantIds),
        this.loadBeverageExtras(orgId, variantIds),
      ]);

      return {
        success: true,
        data: result.rows.map((row) => {
          const resolvedUnits = this.resolveUnits(row, unitsMap);
          const primary = resolvedUnits[0];
          const subVariants = beverageExtras.subMap.get(row.id) ?? [];
          const unitStock = resolvedUnits.reduce((s, u) => s + Number(u.stockQty ?? 0), 0);
          const subStock = subVariants.reduce((s, sv) => s + Number(sv.stockQty ?? 0), 0);
          return {
            ...row,
            sellingPrice: primary.sellingPrice,
            salePrice: primary.salePrice,
            unitType: primary.unitType,
            units: resolvedUnits,
            hasSugarLevel: beverageExtras.sugarMap.get(row.id) ?? false,
            subVariants,
            inStock:
              unitStock > 0 ||
              subStock > 0 ||
              Number(row.stockQty) > 0 ||
              Number(row.retailStockQty) > 0,
          };
        }),
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load variants',
      };
    }
  }

  async listAllVariants(orgId: number, search?: string, category?: string) {
    try {
      const params: unknown[] = [orgId];
      let extra = '';
      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        extra += ` AND (
          LOWER(v.variant_name) LIKE LOWER($${idx})
          OR LOWER(p.name) LIKE LOWER($${idx})
          OR LOWER(COALESCE(p.category,'')) LIKE LOWER($${idx})
        )`;
      }
      if (category?.trim()) {
        params.push(category.trim());
        extra += ` AND LOWER(TRIM(p.category)) = LOWER(TRIM($${params.length}))`;
      }

      const result = await this.db.query<{
        id: number;
        productId: number;
        productName: string;
        variantName: string;
        category: string | null;
        stockQty: number;
        sellingPrice: string;
        salePrice: string | null;
        unitType: string | null;
        imageUrl: string | null;
        productImageUrl: string | null;
      }>(
        `SELECT v.id,
                v.product_id AS "productId",
                p.name AS "productName",
                v.variant_name AS "variantName",
                p.category,
                v.stock_qty AS "stockQty",
                COALESCE(v.retail_stock_qty, 0) AS "retailStockQty",
                v.selling_price AS "sellingPrice",
                v.sale_price AS "salePrice",
                v.unit_type AS "unitType",
                v.image_url AS "imageUrl",
                p.image_url AS "productImageUrl"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         LEFT JOIN (
           SELECT st.variant_id, COALESCE(SUM(st.quantity_sold), 0)::bigint AS total_sold
           FROM tblsales_transactions st
           WHERE st.org_id = $1 AND st.variant_id IS NOT NULL
           GROUP BY st.variant_id
         ) sales ON sales.variant_id = v.id
         WHERE v.org_id = $1 AND v.is_active = TRUE AND p.is_active = TRUE ${extra}
         ORDER BY COALESCE(sales.total_sold, 0) DESC, p.category ASC NULLS LAST, p.name ASC, v.variant_name ASC`,
        params,
      );

      const variantIds = result.rows.map((r) => r.id);
      const [unitsMap, beverageExtras] = await Promise.all([
        this.loadUnitsMap(orgId, variantIds),
        this.loadBeverageExtras(orgId, variantIds),
      ]);

      const data = result.rows.map((row) => {
        const resolvedUnits = this.resolveUnits(row, unitsMap);
        const primary = resolvedUnits[0];
        const subVariants = beverageExtras.subMap.get(row.id) ?? [];
        const unitStock = resolvedUnits.reduce((s, u) => s + Number(u.stockQty ?? 0), 0);
        const subStock = subVariants.reduce((s, sv) => s + Number(sv.stockQty ?? 0), 0);
        return {
          id: row.id,
          productId: row.productId,
          productName: row.productName,
          variantName: row.variantName,
          category: row.category,
          stockQty: row.stockQty,
          retailStockQty: Number((row as { retailStockQty?: number }).retailStockQty ?? 0),
          sellingPrice: primary.sellingPrice,
          salePrice: primary.salePrice,
          unitType: primary.unitType,
          imageUrl: row.imageUrl,
          productImageUrl: row.productImageUrl,
          units: resolvedUnits,
          hasSugarLevel: beverageExtras.sugarMap.get(row.id) ?? false,
          subVariants,
          inStock:
            unitStock > 0 ||
            subStock > 0 ||
            Number(row.stockQty) > 0 ||
            Number((row as { retailStockQty?: number }).retailStockQty) > 0,
        };
      });

      return { success: true, data };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load variants',
      };
    }
  }

  async checkout(orgId: number, userId: number, payload: CheckoutPayload) {
    const items = payload.items ?? [];
    if (!items.length) {
      return { success: false, message: 'Cart is empty' };
    }

    const amountPaid = payload.amountPaid != null ? Number(payload.amountPaid) : null;
    const manualDiscount = Math.max(0, Number(payload.discountAmount ?? 0));

    let discount = null as Awaited<ReturnType<PosDiscountsService['findDiscount']>>;
    if (payload.discountId) {
      discount = await this.discountsService.findDiscount(Number(payload.discountId), orgId);
      if (!discount) {
        return { success: false, message: 'Selected discount is not available' };
      }
    }

    let paymentMethod = null as Awaited<ReturnType<PosPaymentMethodsService['findPaymentMethod']>>;
    if (payload.paymentMethodId) {
      paymentMethod = await this.paymentMethodsService.findPaymentMethod(
        Number(payload.paymentMethodId),
        orgId,
      );
      if (!paymentMethod) {
        return { success: false, message: 'Selected payment method is not available' };
      }
    }

    const paymentStatus = paymentMethod?.settlementMode === 'floating' ? 'floating' : 'settled';
    const referenceNumber = String(payload.referenceNumber ?? '').trim() || null;
    const customerFullName = String(payload.customerFullName ?? '').trim() || null;
    const paymentProofImage = String(payload.paymentProofImage ?? '').trim() || null;
    if (!this.isCashMethod(paymentMethod) && !this.isFoodPandaMethod(paymentMethod) && !referenceNumber) {
      return { success: false, message: 'Reference number is required for non-cash payments' };
    }
    if (this.isBankTransferMethod(paymentMethod) && !customerFullName) {
      return { success: false, message: 'Customer/buyer fullname is required for Bank Transfer payments' };
    }
    if (paymentProofImage && paymentProofImage.length > 6_000_000) {
      return { success: false, message: 'Payment proof image is too large' };
    }

    // Ensure optional columns exist for newer checkout fields.
    await this.ensureUnitStockSchema();
    await this.ensureBeverageSchema();
    await this.db.query(`
      ALTER TABLE public.tblsales_transactions
        ADD COLUMN IF NOT EXISTS reference_number TEXT,
        ADD COLUMN IF NOT EXISTS customer_full_name TEXT,
        ADD COLUMN IF NOT EXISTS sub_variant_id INTEGER,
        ADD COLUMN IF NOT EXISTS payment_proof_image TEXT
    `);

    try {
      type LineDraft = {
        variantId: number;
        subVariantId: number | null;
        unitType: string;
        unitId: number | null;
        qty: number;
        stockDeductQty: number;
        useRetailPool: boolean;
        useSubVariantStock: boolean;
        lineDiscount: number;
        regularUnitPrice: number;
        unitPrice: number;
        lineTotal: number;
        label: string;
      };

      const lineDrafts: Array<{
        variantId: number;
        subVariantId: number | null;
        unitType: string;
        unitId: number | null;
        qty: number;
        lineDiscount: number;
      }> = [];
      for (const line of items) {
        const variantId = Number(line.variantId);
        const rawQty = Number(line.quantity) || 0;
        if (!variantId || rawQty <= 0) {
          return { success: false, message: 'Invalid product in cart' };
        }
        const subVariantId =
          line.subVariantId != null && Number(line.subVariantId) > 0
            ? Number(line.subVariantId)
            : null;
        const unitId =
          line.unitId != null && Number(line.unitId) > 0 ? Number(line.unitId) : null;
        lineDrafts.push({
          variantId,
          subVariantId,
          unitType: String(line.unitType ?? 'piece'),
          unitId,
          qty: rawQty,
          lineDiscount: Math.max(0, Number(line.lineDiscount ?? 0) || 0),
        });
      }

      let regularSubtotal = 0;
      let computedSubtotal = 0;
      let appliedDiscount = 0;
      let grandTotal = 0;
      let changeDue: number | null = null;
      const saleIds: number[] = [];

      await this.db.withTransaction(async (client) => {
        const resolved: LineDraft[] = [];

        for (const draft of lineDrafts) {
          const product = await client.query<{
            productName: string;
            variantName: string;
            stockQty: string;
            retailStockQty: string;
            sellingPrice: string;
            salePrice: string | null;
            unitType: string | null;
          }>(
            `SELECT p.name AS "productName", v.variant_name AS "variantName",
                    v.stock_qty::text AS "stockQty",
                    COALESCE(v.retail_stock_qty, 0)::text AS "retailStockQty",
                    v.selling_price AS "sellingPrice",
                    v.sale_price AS "salePrice", v.unit_type AS "unitType"
             FROM tblinventory_variants v
             INNER JOIN tblinventory_products p ON p.id = v.product_id
             WHERE v.id = $1 AND v.org_id = $2
             FOR UPDATE OF v`,
            [draft.variantId, orgId],
          );

          if (product.rowCount === 0) {
            throw new Error('Product variant not found');
          }

          const row = product.rows[0];
          let unitType = draft.unitType || row.unitType || 'piece';
          let unitId = draft.unitId;

          const unitRow = await client.query<{
            id: number;
            unitType: string;
            sellingPrice: string;
            salePrice: string | null;
            isManualEntry: boolean;
            productSource: string;
            stockQty: string;
            qtyPrices: unknown;
          }>(
            unitId
              ? `SELECT id, unit_type AS "unitType",
                        selling_price AS "sellingPrice", sale_price AS "salePrice",
                        is_manual_entry AS "isManualEntry",
                        COALESCE(product_source, 'Wholesale') AS "productSource",
                        COALESCE(stock_qty, 0)::text AS "stockQty",
                        COALESCE(qty_prices, '[]'::jsonb) AS "qtyPrices"
                 FROM tblinventory_variant_units
                 WHERE id = $1 AND variant_id = $2 AND org_id = $3 AND is_active = TRUE
                 LIMIT 1`
              : `SELECT id, unit_type AS "unitType",
                        selling_price AS "sellingPrice", sale_price AS "salePrice",
                        is_manual_entry AS "isManualEntry",
                        COALESCE(product_source, 'Wholesale') AS "productSource",
                        COALESCE(stock_qty, 0)::text AS "stockQty",
                        COALESCE(qty_prices, '[]'::jsonb) AS "qtyPrices"
                 FROM tblinventory_variant_units
                 WHERE variant_id = $1 AND org_id = $2 AND is_active = TRUE
                   AND lower(unit_type) = lower($3)
                 ORDER BY is_default DESC, sort_order ASC, id ASC
                 LIMIT 1`,
            unitId
              ? [unitId, draft.variantId, orgId]
              : [draft.variantId, orgId, unitType],
          );

          let sellingPrice = Number(row.sellingPrice ?? 0);
          let salePrice = row.salePrice != null ? Number(row.salePrice) : null;
          let isManual = unitType === 'manual' || isGramsSellUnit(unitType);
          let productSource: string | undefined;
          let unitStock: number | null = null;
          let qtyPrices: PosQtyPrice[] = [];
          if (unitRow.rowCount) {
            const u = unitRow.rows[0];
            unitId = Number(u.id);
            unitType = u.unitType || unitType;
            sellingPrice = Number(u.sellingPrice ?? 0);
            salePrice = u.salePrice != null ? Number(u.salePrice) : null;
            isManual = u.isManualEntry || isGramsSellUnit(unitType);
            productSource = u.productSource;
            unitStock = Number(u.stockQty ?? 0);
            qtyPrices = this.normalizeQtyPrices(u.qtyPrices);
          }
          const useRetailPool = isRetailSellUnit(
            unitType,
            productSource,
            isManual,
          );

          let sizeLabel: string | null = null;
          let tempType: string | null = null;
          let subStock: number | null = null;
          if (draft.subVariantId != null) {
            const subRow = await client.query<{
              sizeLabel: string;
              tempType: string | null;
              sellingPrice: string;
              salePrice: string | null;
              stockQty: string;
            }>(
              `SELECT size_label AS "sizeLabel",
                      temp_type AS "tempType",
                      selling_price AS "sellingPrice",
                      sale_price AS "salePrice",
                      COALESCE(stock_qty, 0)::text AS "stockQty"
               FROM tblinventory_variant_subvariants
               WHERE id = $1
                 AND variant_id = $2
                 AND org_id = $3
                 AND is_active = TRUE
               LIMIT 1
               FOR UPDATE`,
              [draft.subVariantId, draft.variantId, orgId],
            );
            if (!subRow.rowCount) {
              throw new Error(
                `Selected size/option not found for ${row.productName} (${row.variantName})`,
              );
            }
            const sub = subRow.rows[0];
            sellingPrice = Number(sub.sellingPrice ?? 0);
            salePrice = sub.salePrice != null ? Number(sub.salePrice) : null;
            sizeLabel = sub.sizeLabel;
            tempType = sub.tempType;
            subStock = Number(sub.stockQty ?? 0);
          } else if (sellingPrice <= 0) {
            const hasSubVariants = await client.query<{ count: string }>(
              `SELECT COUNT(*)::text AS count
               FROM tblinventory_variant_subvariants
               WHERE variant_id = $1 AND org_id = $2 AND is_active = TRUE`,
              [draft.variantId, orgId],
            );
            if (Number(hasSubVariants.rows[0]?.count ?? 0) > 0) {
              throw new Error(
                `Size/option is required for ${row.productName} (${row.variantName})`,
              );
            }
          }

          if (sellingPrice <= 0) {
            throw new Error(
              `No selling price configured for ${row.productName} (${row.variantName})`,
            );
          }

          const qty = isManual
            ? Math.round(Math.max(0.01, draft.qty) * 1000) / 1000
            : Math.max(1, Math.floor(draft.qty));
          const matchedTier = this.matchQtyPrice(qtyPrices, qty);
          if (matchedTier) {
            sellingPrice = this.unitRateFromQtyPrice(matchedTier);
            // Tier price is the full amount for that qty; ignore unit sale_price rate.
            salePrice = null;
          }
          const wholesaleStock = Number(row.stockQty ?? 0);
          const retailStock = Number(row.retailStockQty ?? 0);
          const useSubVariantStock = draft.subVariantId != null && subStock != null;
          const stockDeductQty = useSubVariantStock
            ? qty
            : useRetailPool
              ? sellQtyToStockQty(qty, unitType, true)
              : sellQtyToStockQty(qty, unitType, false);
          const availableStock = useSubVariantStock
            ? (subStock as number)
            : unitStock != null
              ? unitStock
              : useRetailPool
                ? retailStock
                : wholesaleStock;
          if (availableStock < stockDeductQty) {
            throw new Error(`Insufficient stock for ${row.productName} (${row.variantName})`);
          }
          draft.qty = qty;
          draft.unitType = unitType;
          draft.unitId = unitId;

          const unitPrice = this.discountsService.computeLineUnitPrice(
            sellingPrice,
            salePrice,
            discount,
            draft.qty,
          );
          const rawLineTotal = unitPrice * draft.qty;
          const lineDiscount = Math.min(draft.lineDiscount, rawLineTotal);
          const lineTotal = Math.round((rawLineTotal - lineDiscount) * 100) / 100;

          const detailParts = [tempType, sizeLabel].filter(Boolean);
          const detailSuffix = detailParts.length ? ` · ${detailParts.join(' / ')}` : '';

          resolved.push({
            variantId: draft.variantId,
            subVariantId: draft.subVariantId,
            unitType,
            unitId,
            qty: draft.qty,
            stockDeductQty,
            useRetailPool,
            useSubVariantStock,
            lineDiscount,
            regularUnitPrice: sellingPrice,
            unitPrice,
            lineTotal,
            label: `${row.productName} (${row.variantName})${detailSuffix}`,
          });
        }

        regularSubtotal = resolved.reduce(
          (sum, line) => sum + line.regularUnitPrice * line.qty,
          0,
        );
        computedSubtotal = resolved.reduce((sum, line) => sum + line.lineTotal, 0);
        const lineDiscountsTotal = resolved.reduce((sum, line) => sum + line.lineDiscount, 0);

        const saleSavings = Math.round((regularSubtotal - (computedSubtotal + lineDiscountsTotal)) * 100) / 100;
        let orderLevelDiscount = 0;

        if (discount?.discountType === 'percent' || discount?.discountType === 'fixed') {
          orderLevelDiscount = this.discountsService.computeOrderDiscount(computedSubtotal, discount);
          appliedDiscount = Math.round((saleSavings + lineDiscountsTotal + orderLevelDiscount) * 100) / 100;
          grandTotal = Math.round((computedSubtotal - orderLevelDiscount) * 100) / 100;
        } else if (discount?.discountType === 'auto_bulk') {
          appliedDiscount = Math.round((saleSavings + lineDiscountsTotal) * 100) / 100;
          grandTotal = computedSubtotal;
        } else if (manualDiscount > 0) {
          orderLevelDiscount = Math.min(manualDiscount, computedSubtotal);
          appliedDiscount = Math.round((saleSavings + lineDiscountsTotal + orderLevelDiscount) * 100) / 100;
          grandTotal = Math.round((computedSubtotal - orderLevelDiscount) * 100) / 100;
        } else {
          appliedDiscount = Math.round((saleSavings + lineDiscountsTotal) * 100) / 100;
          grandTotal = computedSubtotal;
        }

        if (amountPaid != null && amountPaid < grandTotal) {
          throw new Error(
            `Amount received (₱${amountPaid.toFixed(2)}) is less than total (₱${grandTotal.toFixed(2)})`,
          );
        }

        changeDue =
          amountPaid != null ? Math.round((amountPaid - grandTotal) * 100) / 100 : null;

        const discountFactor =
          computedSubtotal > 0 ? (computedSubtotal - orderLevelDiscount) / computedSubtotal : 1;

        for (let i = 0; i < resolved.length; i++) {
          const line = resolved[i];
          const adjustedTotal = Math.round(line.lineTotal * discountFactor * 100) / 100;

          const sale = await client.query<{ id: number }>(
            `INSERT INTO tblsales_transactions
               (org_id, variant_id, quantity_sold, unit_price, total_amount,
                discount_amount, discount_id, amount_paid, change_amount,
                payment_method_id, payment_status, sale_date, created_by, unit_type,
                reference_number, customer_full_name, sub_variant_id, payment_proof_image,
                variant_unit_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, (NOW() AT TIME ZONE 'Asia/Manila')::date, $12, $13, $14, $15, $16, $17, $18)
             RETURNING id`,
            [
              orgId,
              line.variantId,
              line.qty,
              line.unitPrice,
              adjustedTotal,
              i === 0 ? appliedDiscount : 0,
              i === 0 ? (payload.discountId ?? null) : null,
              i === 0 ? amountPaid : null,
              i === 0 ? changeDue : null,
              i === 0 ? (payload.paymentMethodId ?? null) : null,
              i === 0 ? paymentStatus : 'settled',
              userId || null,
              line.unitType,
              i === 0 ? referenceNumber : null,
              i === 0 ? customerFullName : null,
              line.subVariantId,
              i === 0 ? paymentProofImage : null,
              line.unitId,
            ],
          );

          saleIds.push(sale.rows[0].id);

          if (line.useSubVariantStock && line.subVariantId != null) {
            await client.query(
              `UPDATE tblinventory_variant_subvariants
               SET stock_qty = GREATEST(0, stock_qty - $1), updated_at = NOW()
               WHERE id = $2 AND org_id = $3 AND variant_id = $4 AND is_active = TRUE`,
              [line.stockDeductQty, line.subVariantId, orgId, line.variantId],
            );
          } else if (line.unitId) {
            await client.query(
              `UPDATE tblinventory_variant_units
               SET stock_qty = stock_qty - $1, updated_at = NOW()
               WHERE id = $2 AND org_id = $3 AND is_active = TRUE`,
              [line.stockDeductQty, line.unitId, orgId],
            );
          } else {
            await client.query(
              `UPDATE tblinventory_variant_units
               SET stock_qty = stock_qty - $1, updated_at = NOW()
               WHERE id = (
                 SELECT id FROM tblinventory_variant_units
                 WHERE variant_id = $2 AND org_id = $3 AND is_active = TRUE
                   AND lower(unit_type) = lower($4)
                 ORDER BY is_default DESC, sort_order ASC, id ASC
                 LIMIT 1
               )`,
              [line.stockDeductQty, line.variantId, orgId, line.unitType],
            );
          }
          // Keep denormalized variant pools in sync.
          if (line.useRetailPool && !line.useSubVariantStock) {
            await client.query(
              `UPDATE tblinventory_variants
               SET retail_stock_qty = GREATEST(0, retail_stock_qty - $1), updated_at = NOW()
               WHERE id = $2 AND org_id = $3`,
              [line.stockDeductQty, line.variantId, orgId],
            );
          } else {
            await client.query(
              `UPDATE tblinventory_variants
               SET stock_qty = GREATEST(0, stock_qty - $1), updated_at = NOW()
               WHERE id = $2 AND org_id = $3`,
              [line.stockDeductQty, line.variantId, orgId],
            );
          }
        }
      });

      const cashierRow = await this.db.query<{ name: string }>(
        `SELECT COALESCE(to_jsonb(u)->>'fullname', u.username) AS name
         FROM tblusers u WHERE u.id = $1 LIMIT 1`,
        [userId],
      );
      const cashierName = cashierRow.rows[0]?.name ?? 'Cashier';
      const methodLabel = paymentMethod?.name ?? 'POS';
      const primarySaleId = saleIds[0] ?? 0;
      if (primarySaleId > 0) {
        const notifyResult = await this.notificationsService.notifySale(
          orgId,
          'New sale completed',
          `${cashierName} completed a ${methodLabel} sale for ₱${grandTotal.toFixed(2)} (${paymentStatus})`,
          primarySaleId,
        );
        if (!notifyResult.success) {
          this.logger.warn(
            `Sale notification failed for org ${orgId}, sale ${primarySaleId}: ${notifyResult.message ?? 'unknown error'}`,
          );
        }
      }

      return {
        success: true,
        data: {
          saleIds,
          subtotal: regularSubtotal,
          discountAmount: appliedDiscount,
          totalAmount: grandTotal,
          amountPaid,
          changeDue,
          itemCount: items.length,
          paymentStatus,
        },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Checkout failed',
      };
    }
  }
}
