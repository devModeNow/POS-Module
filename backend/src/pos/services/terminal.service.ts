import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { PosDiscountsService } from './discounts.service';
import { PosPaymentMethodsService } from './payment-methods.service';

export type CheckoutItem = { variantId: number; quantity: number; unitType?: string };

export type CheckoutPayload = {
  items: CheckoutItem[];
  discountId?: number | null;
  discountAmount?: number;
  amountPaid?: number;
  paymentMethodId?: number | null;
};

@Injectable()
export class PosTerminalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly discountsService: PosDiscountsService,
    private readonly paymentMethodsService: PosPaymentMethodsService,
  ) {}

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
                COALESCE(MIN(v.selling_price), 0)::text AS "minPrice",
                COALESCE(MAX(v.selling_price), 0)::text AS "maxPrice",
                MIN(CASE WHEN v.sale_price > 0 AND v.sale_price < v.selling_price THEN v.sale_price END)::text AS "minSalePrice",
                COALESCE(SUM(v.stock_qty), 0)::text AS "totalStock",
                BOOL_OR(v.sale_price IS NOT NULL AND v.sale_price > 0 AND v.sale_price < v.selling_price) AS "hasSale"
         FROM tblinventory_products p
         LEFT JOIN tblinventory_variants v ON v.product_id = p.id AND v.is_active = TRUE
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
      const unitsMap = new Map<number, Array<{
        unitType: string;
        sellingPrice: number;
        salePrice: number | null;
        isManualEntry: boolean;
      }>>();
      if (variantIds.length) {
        const unitsResult = await this.db.query<{
          variantId: number;
          unitType: string;
          sellingPrice: string;
          salePrice: string | null;
          isManualEntry: boolean;
        }>(
          `SELECT variant_id AS "variantId", unit_type AS "unitType",
                  selling_price AS "sellingPrice", sale_price AS "salePrice",
                  is_manual_entry AS "isManualEntry"
           FROM tblinventory_variant_units
           WHERE variant_id = ANY($1::bigint[]) AND is_active = TRUE
           ORDER BY sort_order ASC, unit_type ASC`,
          [variantIds],
        );
        for (const u of unitsResult.rows) {
          const list = unitsMap.get(u.variantId) ?? [];
          list.push({
            unitType: u.unitType,
            sellingPrice: Number(u.sellingPrice ?? 0),
            salePrice: u.salePrice != null ? Number(u.salePrice) : null,
            isManualEntry: u.isManualEntry,
          });
          unitsMap.set(u.variantId, list);
        }
      }

      return {
        success: true,
        data: result.rows.map((row) => {
          const units = unitsMap.get(row.id) ?? [];
          const fallbackUnit = row.unitType ?? 'piece';
          const resolvedUnits = units.length
            ? units
            : [{
                unitType: fallbackUnit,
                sellingPrice: Number(row.sellingPrice ?? 0),
                salePrice: row.salePrice != null ? Number(row.salePrice) : null,
                isManualEntry: fallbackUnit === 'manual',
              }];
          const primary = resolvedUnits[0];
          return {
            ...row,
            sellingPrice: primary.sellingPrice,
            salePrice: primary.salePrice,
            unitType: primary.unitType,
            units: resolvedUnits,
            inStock: row.stockQty > 0,
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

    try {
      type LineDraft = {
        variantId: number;
        unitType: string;
        qty: number;
        regularUnitPrice: number;
        unitPrice: number;
        lineTotal: number;
        label: string;
      };

      const lineDrafts: Array<LineDraft & { qty: number }> = [];
      for (const line of items) {
        const variantId = Number(line.variantId);
        const rawQty = Number(line.quantity) || 0;
        if (!variantId || rawQty <= 0) {
          return { success: false, message: 'Invalid product in cart' };
        }
        lineDrafts.push({
          variantId,
          unitType: String(line.unitType ?? 'piece'),
          qty: rawQty,
          regularUnitPrice: 0,
          unitPrice: 0,
          lineTotal: 0,
          label: '',
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
            sellingPrice: string;
            salePrice: string | null;
            unitType: string | null;
          }>(
            `SELECT p.name AS "productName", v.variant_name AS "variantName",
                    v.stock_qty::text AS "stockQty", v.selling_price AS "sellingPrice",
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
          const unitType = draft.unitType || row.unitType || 'piece';

          const unitPriceRow = await client.query<{
            sellingPrice: string;
            salePrice: string | null;
            isManualEntry: boolean;
          }>(
            `SELECT selling_price AS "sellingPrice", sale_price AS "salePrice",
                    is_manual_entry AS "isManualEntry"
             FROM tblinventory_variant_units
             WHERE variant_id = $1 AND org_id = $2 AND is_active = TRUE
               AND lower(unit_type) = lower($3)
             LIMIT 1`,
            [draft.variantId, orgId, unitType],
          );

          let sellingPrice = Number(row.sellingPrice ?? 0);
          let salePrice = row.salePrice != null ? Number(row.salePrice) : null;
          let isManual = unitType === 'manual';
          if (unitPriceRow.rowCount) {
            const u = unitPriceRow.rows[0];
            sellingPrice = Number(u.sellingPrice ?? 0);
            salePrice = u.salePrice != null ? Number(u.salePrice) : null;
            isManual = u.isManualEntry;
          }

          const qty = isManual
            ? Math.round(Math.max(0.01, draft.qty) * 1000) / 1000
            : Math.max(1, Math.floor(draft.qty));
          const stockQty = Number(row.stockQty ?? 0);
          if (stockQty < qty) {
            throw new Error(`Insufficient stock for ${row.productName} (${row.variantName})`);
          }
          draft.qty = qty;
          draft.unitType = unitType;

          const unitPrice = this.discountsService.computeLineUnitPrice(
            sellingPrice,
            salePrice,
            discount,
            draft.qty,
          );

          resolved.push({
            variantId: draft.variantId,
            unitType,
            qty: draft.qty,
            regularUnitPrice: sellingPrice,
            unitPrice,
            lineTotal: unitPrice * draft.qty,
            label: `${row.productName} (${row.variantName})`,
          });
        }

        regularSubtotal = resolved.reduce(
          (sum, line) => sum + line.regularUnitPrice * line.qty,
          0,
        );
        computedSubtotal = resolved.reduce((sum, line) => sum + line.lineTotal, 0);

        const saleSavings = Math.round((regularSubtotal - computedSubtotal) * 100) / 100;
        let orderLevelDiscount = 0;

        if (discount?.discountType === 'percent' || discount?.discountType === 'fixed') {
          orderLevelDiscount = this.discountsService.computeOrderDiscount(computedSubtotal, discount);
          appliedDiscount = Math.round((saleSavings + orderLevelDiscount) * 100) / 100;
          grandTotal = Math.round((computedSubtotal - orderLevelDiscount) * 100) / 100;
        } else if (discount?.discountType === 'auto_bulk') {
          appliedDiscount = saleSavings;
          grandTotal = computedSubtotal;
        } else if (manualDiscount > 0) {
          orderLevelDiscount = Math.min(manualDiscount, computedSubtotal);
          appliedDiscount = Math.round((saleSavings + orderLevelDiscount) * 100) / 100;
          grandTotal = Math.round((computedSubtotal - orderLevelDiscount) * 100) / 100;
        } else {
          appliedDiscount = saleSavings;
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
                payment_method_id, payment_status, sale_date, created_by, unit_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, (NOW() AT TIME ZONE 'Asia/Manila')::date, $12, $13)
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
            ],
          );

          saleIds.push(sale.rows[0].id);

          await client.query(
            `UPDATE tblinventory_variants
             SET stock_qty = stock_qty - $1, updated_at = NOW()
             WHERE id = $2 AND org_id = $3`,
            [line.qty, line.variantId, orgId],
          );
        }
      });

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
