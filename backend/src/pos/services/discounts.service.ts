import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export type DiscountRow = {
  id: number;
  orgId: number;
  name: string;
  code: string;
  discountType: 'percent' | 'fixed' | 'auto_sale' | 'auto_bulk';
  discountValue: number;
  bulkMinQty: number | null;
  description: string | null;
};

@Injectable()
export class PosDiscountsService {
  constructor(private readonly db: DatabaseService) {}

  async listDiscounts(orgId: number) {
    try {
      const result = await this.db.query<{
        id: number;
        org_id: number;
        name: string;
        code: string;
        discount_type: string;
        discount_value: string;
        bulk_min_qty: number | null;
        description: string | null;
      }>(
        `SELECT id, org_id, name, code, discount_type, discount_value, bulk_min_qty, description
         FROM tbldiscounts
         WHERE org_id = $1 AND is_active = TRUE
         ORDER BY sort_order ASC, name ASC`,
        [orgId],
      );

      return {
        success: true,
        data: result.rows.map((row) => ({
          id: row.id,
          orgId: row.org_id,
          name: row.name,
          code: row.code,
          discountType: row.discount_type,
          discountValue: Number(row.discount_value ?? 0),
          bulkMinQty: row.bulk_min_qty,
          description: row.description,
        })),
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load discounts',
      };
    }
  }

  async findDiscount(id: number, orgId: number): Promise<DiscountRow | null> {
    const result = await this.db.query<{
      id: number;
      org_id: number;
      name: string;
      code: string;
      discount_type: string;
      discount_value: string;
      bulk_min_qty: number | null;
      description: string | null;
    }>(
      `SELECT id, org_id, name, code, discount_type, discount_value, bulk_min_qty, description
       FROM tbldiscounts
       WHERE id = $1 AND org_id = $2 AND is_active = TRUE
       LIMIT 1`,
      [id, orgId],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      code: row.code,
      discountType: row.discount_type as DiscountRow['discountType'],
      discountValue: Number(row.discount_value ?? 0),
      bulkMinQty: row.bulk_min_qty,
      description: row.description,
    };
  }

  computeLineUnitPrice(
    sellingPrice: number,
    salePrice: number | null,
    discount: DiscountRow | null,
    quantity: number,
  ): number {
    let unit = sellingPrice;
    if (salePrice != null && salePrice > 0 && salePrice < sellingPrice) {
      unit = salePrice;
    }
    if (discount?.discountType === 'auto_bulk' && discount.bulkMinQty && quantity >= discount.bulkMinQty) {
      unit = unit * (1 - discount.discountValue / 100);
    }
    return Math.round(unit * 100) / 100;
  }

  computeOrderDiscount(subtotal: number, discount: DiscountRow | null): number {
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
