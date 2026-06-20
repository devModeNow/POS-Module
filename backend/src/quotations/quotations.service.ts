import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class QuotationsService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(orgId: number, status?: string) {
    try {
      const where = status ? `AND q.status = $2` : '';
      const params: unknown[] = status ? [orgId, status] : [orgId];
      const result = await this.db.query(
        `SELECT q.id, q.customer_name AS "customerName", q.contact, q.vehicle_plate AS "vehiclePlate",
                q.total_amount AS "totalAmount", q.status, q.valid_until AS "validUntil",
                q.created_at AS "createdAt", q.updated_at AS "updatedAt",
                u.fullname AS "createdBy"
         FROM tblquotations q
         LEFT JOIN tblusers u ON u.id = q.created_by
         WHERE q.org_id = $1 ${where}
         ORDER BY q.created_at DESC`, params);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load quotations' };
    }
  }

  async findOne(id: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT q.*, u.fullname AS "createdByName"
         FROM tblquotations q
         LEFT JOIN tblusers u ON u.id = q.created_by
         WHERE q.id = $1 AND q.org_id = $2 LIMIT 1`, [id, orgId]);
      if (result.rowCount === 0) return { success: false, message: 'Quotation not found' };
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load quotation' };
    }
  }

  async create(orgId: number, createdBy: number, dto: {
    customerName: string; contact?: string; vehiclePlate?: string; customerId?: number;
    services?: unknown[]; parts?: unknown[]; laborFee?: number;
    discount?: number; totalAmount?: number; validUntil?: string; notes?: string;
  }) {
    if (!dto.customerName?.trim()) return { success: false, message: 'Customer name is required' };
    try {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblquotations
           (org_id, customer_id, customer_name, contact, vehicle_plate, services, parts,
            labor_fee, discount, total_amount, valid_until, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13) RETURNING id`,
        [orgId, dto.customerId ?? null, dto.customerName.trim(), dto.contact ?? null,
         dto.vehiclePlate ?? null, JSON.stringify(dto.services ?? []),
         JSON.stringify(dto.parts ?? []), dto.laborFee ?? 0, dto.discount ?? 0,
         dto.totalAmount ?? 0, dto.validUntil ?? null, dto.notes ?? null, createdBy]);
      return { success: true, id: result.rows[0].id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create quotation' };
    }
  }

  async update(id: number, orgId: number, dto: Record<string, unknown>) {
    try {
      const fieldMap: Record<string, string> = {
        customerName: 'customer_name', contact: 'contact', vehiclePlate: 'vehicle_plate',
        services: 'services', parts: 'parts', laborFee: 'labor_fee',
        discount: 'discount', totalAmount: 'total_amount', validUntil: 'valid_until',
        notes: 'notes', status: 'status',
      };
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [key, col] of Object.entries(fieldMap)) {
        if (dto[key] === undefined) continue;
        const val = key === 'services' || key === 'parts' ? JSON.stringify(dto[key]) : dto[key];
        vals.push(val);
        sets.push(`"${col}" = $${vals.length}`);
      }
      if (sets.length === 0) return { success: false, message: 'No changes provided' };
      sets.push(`"updated_at" = NOW()`);
      vals.push(id, orgId);
      await this.db.query(
        `UPDATE tblquotations SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND org_id = $${vals.length}`, vals);
      return this.findOne(id, orgId);
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update quotation' };
    }
  }

  async updateStatus(id: number, orgId: number, status: string) {
    return this.update(id, orgId, { status });
  }
}
