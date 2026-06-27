import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export type PaymentMethodRow = {
  id: number;
  code: string;
  name: string;
  parentCode: string | null;
  settlementMode: 'immediate' | 'floating';
};

@Injectable()
export class PosPaymentMethodsService {
  constructor(private readonly db: DatabaseService) {}

  async listPaymentMethods(orgId: number) {
    try {
      const result = await this.db.query<{
        id: number;
        code: string;
        name: string;
        parent_code: string | null;
        settlement_mode: string;
      }>(
        `SELECT id, code, name, parent_code, settlement_mode
         FROM tblpayment_methods
         WHERE org_id = $1 AND is_active = TRUE
         ORDER BY sort_order ASC, name ASC`,
        [orgId],
      );
      return {
        success: true,
        data: result.rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          parentCode: r.parent_code,
          settlementMode: r.settlement_mode as PaymentMethodRow['settlementMode'],
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load payment methods' };
    }
  }

  async findPaymentMethod(id: number, orgId: number): Promise<PaymentMethodRow | null> {
    const result = await this.db.query<{
      id: number;
      code: string;
      name: string;
      parent_code: string | null;
      settlement_mode: string;
    }>(
      `SELECT id, code, name, parent_code, settlement_mode
       FROM tblpayment_methods WHERE id = $1 AND org_id = $2 AND is_active = TRUE LIMIT 1`,
      [id, orgId],
    );
    if (result.rowCount === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      parentCode: r.parent_code,
      settlementMode: r.settlement_mode as PaymentMethodRow['settlementMode'],
    };
  }
}
