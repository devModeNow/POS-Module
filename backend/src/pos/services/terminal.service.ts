import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export type CheckoutItem = { inventoryId: number; quantity: number };

export type CheckoutPayload = {
  items: CheckoutItem[];
  discountAmount?: number;
  amountPaid?: number;
};

@Injectable()
export class PosTerminalService {
  constructor(private readonly db: DatabaseService) {}

  async listProducts(orgId: number, search?: string) {
    try {
      const params: unknown[] = [orgId];
      let searchClause = '';
      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        searchClause = `AND (
          LOWER(part_name) LIKE LOWER($${idx})
          OR LOWER(COALESCE(brand, '')) LIKE LOWER($${idx})
          OR LOWER(COALESCE(category, '')) LIKE LOWER($${idx})
        )`;
      }

      const result = await this.db.query<{
        id: number;
        partName: string;
        category: string | null;
        brand: string | null;
        stockQty: number;
        sellingPrice: string;
        imageUrl: string | null;
        unitType: string | null;
      }>(
        `SELECT id,
                part_name AS "partName",
                category,
                brand,
                stock_qty AS "stockQty",
                selling_price AS "sellingPrice",
                image_url AS "imageUrl",
                unit_type AS "unitType"
         FROM tblinventory
         WHERE org_id = $1 ${searchClause}
         ORDER BY part_name ASC`,
        params,
      );

      const data = result.rows.map((row) => ({
        ...row,
        sellingPrice: Number(row.sellingPrice ?? 0),
        inStock: row.stockQty > 0,
      }));

      return { success: true, data };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load products',
      };
    }
  }

  async checkout(orgId: number, userId: number, payload: CheckoutPayload) {
    const items = payload.items ?? [];
    if (!items.length) {
      return { success: false, message: 'Cart is empty' };
    }

    const discountAmount = Math.max(0, Number(payload.discountAmount ?? 0));
    const amountPaid = payload.amountPaid != null ? Number(payload.amountPaid) : null;

    try {
      type LineDraft = {
        inventoryId: number;
        qty: number;
        unitPrice: number;
        lineTotal: number;
        partName: string;
      };

      const lineDrafts: LineDraft[] = [];

      for (const line of items) {
        const qty = Math.max(1, Math.floor(Number(line.quantity) || 0));
        const inventoryId = Number(line.inventoryId);
        if (!inventoryId) {
          return { success: false, message: 'Invalid product in cart' };
        }
        lineDrafts.push({ inventoryId, qty, unitPrice: 0, lineTotal: 0, partName: '' });
      }

      let computedSubtotal = 0;
      let grandTotal = 0;
      let appliedDiscount = 0;
      let changeDue: number | null = null;
      const saleIds: number[] = [];

      await this.db.withTransaction(async (client) => {
        const resolved: LineDraft[] = [];

        for (const draft of lineDrafts) {
          const product = await client.query<{
            partName: string;
            stockQty: number;
            sellingPrice: string;
          }>(
            `SELECT part_name AS "partName", stock_qty AS "stockQty", selling_price AS "sellingPrice"
             FROM tblinventory
             WHERE id = $1 AND org_id = $2
             FOR UPDATE`,
            [draft.inventoryId, orgId],
          );

          if (product.rowCount === 0) {
            throw new Error('Product not found');
          }

          const row = product.rows[0];
          if (row.stockQty < draft.qty) {
            throw new Error(`Insufficient stock for ${row.partName}`);
          }

          const unitPrice = Number(row.sellingPrice ?? 0);
          resolved.push({
            inventoryId: draft.inventoryId,
            qty: draft.qty,
            unitPrice,
            lineTotal: unitPrice * draft.qty,
            partName: row.partName,
          });
        }

        computedSubtotal = resolved.reduce((sum, line) => sum + line.lineTotal, 0);
        appliedDiscount = Math.min(discountAmount, computedSubtotal);
        grandTotal = Math.round((computedSubtotal - appliedDiscount) * 100) / 100;

        if (amountPaid != null && amountPaid < grandTotal) {
          throw new Error(
            `Amount received (₱${amountPaid.toFixed(2)}) is less than total (₱${grandTotal.toFixed(2)})`,
          );
        }

        changeDue =
          amountPaid != null ? Math.round((amountPaid - grandTotal) * 100) / 100 : null;

        const discountFactor =
          computedSubtotal > 0 ? (computedSubtotal - appliedDiscount) / computedSubtotal : 1;

        for (let i = 0; i < resolved.length; i++) {
          const line = resolved[i];
          const adjustedTotal = Math.round(line.lineTotal * discountFactor * 100) / 100;

          const sale = await client.query<{ id: number }>(
            `INSERT INTO tblsales_transactions
               (org_id, inventory_id, quantity_sold, unit_price, total_amount,
                discount_amount, amount_paid, change_amount, sale_date, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (NOW() AT TIME ZONE 'Asia/Manila')::date, $9)
             RETURNING id`,
            [
              orgId,
              line.inventoryId,
              line.qty,
              line.unitPrice,
              adjustedTotal,
              i === 0 ? appliedDiscount : 0,
              i === 0 ? amountPaid : null,
              i === 0 ? changeDue : null,
              userId || null,
            ],
          );

          saleIds.push(sale.rows[0].id);

          await client.query(
            `UPDATE tblinventory
             SET stock_qty = stock_qty - $1, updated_at = NOW()
             WHERE id = $2 AND org_id = $3`,
            [line.qty, line.inventoryId, orgId],
          );
        }
      });

      return {
        success: true,
        data: {
          saleIds,
          subtotal: computedSubtotal,
          discountAmount: appliedDiscount,
          totalAmount: grandTotal,
          amountPaid,
          changeDue,
          itemCount: items.length,
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
