import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class CustomersService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(orgId: number, search?: string) {
    try {
      const where = search?.trim()
        ? `AND (LOWER(c.name) LIKE LOWER($2) OR LOWER(c.contact) LIKE LOWER($2) OR LOWER(c.email) LIKE LOWER($2))`
        : '';
      const params: unknown[] = search?.trim() ? [orgId, `%${search.trim()}%`] : [orgId];
      const result = await this.db.query(
        `SELECT c.id, c.name, c.contact, c.email, c.address, c.created_at AS "createdAt",
                COUNT(DISTINCT v.id)::int AS "vehicleCount",
                COUNT(DISTINCT jo.id)::int AS "jobOrderCount",
                MAX(jo.created_at) AS "lastVisit"
         FROM tblcustomers c
         LEFT JOIN tblvehicles v ON v.customer_id = c.id
         LEFT JOIN tbljoborders jo ON jo.vehicle_id = v.id
         WHERE c.org_id = $1 ${where}
         GROUP BY c.id ORDER BY c.name ASC`, params);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load customers' };
    }
  }

  async findOne(id: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT id, name, contact, email, address, created_at AS "createdAt"
         FROM tblcustomers WHERE id = $1 AND org_id = $2 LIMIT 1`, [id, orgId]);
      if (result.rowCount === 0) return { success: false, message: 'Customer not found' };
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load customer' };
    }
  }

  async create(orgId: number, dto: { name: string; contact?: string; email?: string; address?: string }) {
    const name = String(dto.name ?? '').trim();
    if (!name) return { success: false, message: 'Customer name is required' };
    try {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblcustomers (org_id, name, contact, email, address)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [orgId, name, dto.contact ?? null, dto.email ?? null, dto.address ?? null]);
      return { success: true, id: result.rows[0].id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create customer' };
    }
  }

  async update(id: number, orgId: number, dto: { name?: string; contact?: string; email?: string; address?: string }) {
    try {
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (dto.name    !== undefined) { vals.push(dto.name);    sets.push(`name = $${vals.length}`); }
      if (dto.contact !== undefined) { vals.push(dto.contact); sets.push(`contact = $${vals.length}`); }
      if (dto.email   !== undefined) { vals.push(dto.email);   sets.push(`email = $${vals.length}`); }
      if (dto.address !== undefined) { vals.push(dto.address); sets.push(`address = $${vals.length}`); }
      if (sets.length === 0) return { success: false, message: 'No changes provided' };
      vals.push(id, orgId);
      await this.db.query(
        `UPDATE tblcustomers SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND org_id = $${vals.length}`, vals);
      return this.findOne(id, orgId);
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update customer' };
    }
  }

  async getVehicles(customerId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT v.id, v.plate_number AS "plateNumber", v.make, v.model, v.year_model AS "yearModel",
                v."engineType" AS "engineType", v.fuel_type AS "fuelType",
                v.odometer_reading AS "odometerReading", v.color, v.transmission,
                v.chassis_info AS "chassisInfo", v.engine_info AS "engineInfo"
         FROM tblvehicles v
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         WHERE v.customer_id = $1 AND c.org_id = $2
         ORDER BY v.plate_number ASC`, [customerId, orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load vehicles' };
    }
  }

  async createVehicle(customerId: number, orgId: number, dto: {
    plateNumber: string; make: string; model: string; yearModel?: number;
    engineType?: string; fuelType?: string; odometerReading?: number;
    color?: string; transmission?: string; chassisInfo?: string; engineInfo?: string;
  }) {
    const plate = String(dto.plateNumber ?? '').trim().toUpperCase();
    if (!plate) return { success: false, message: 'Plate number is required' };
    try {
      const exists = await this.db.query(
        `SELECT id FROM tblvehicles WHERE UPPER(TRIM(plate_number)) = $1 AND org_id = $2 LIMIT 1`,
        [plate, orgId]);
      if (exists.rowCount > 0) return { success: false, message: 'Plate number already registered' };
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblvehicles (customer_id, org_id, plate_number, make, model, year_model,
           "engineType", fuel_type, odometer_reading, color, transmission, chassis_info, engine_info)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [customerId, orgId, plate, dto.make ?? '', dto.model ?? '', dto.yearModel ?? null,
         dto.engineType ?? null, dto.fuelType ?? null, dto.odometerReading ?? null,
         dto.color ?? null, dto.transmission ?? null, dto.chassisInfo ?? null, dto.engineInfo ?? null]);
      return { success: true, id: result.rows[0].id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create vehicle' };
    }
  }

  async getJobOrders(customerId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT jo.id, jo.jo_number AS "joNumber", jo.status, jo.description,
                jo.total_amount AS "totalAmount", jo.created_at AS "createdAt",
                v.plate_number AS "plateNumber", v.make, v.model,
                t.name AS "mechanicName"
         FROM tbljoborders jo
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         LEFT JOIN tbltechnicians t ON t.id = jo.technician_id
         WHERE c.id = $1 AND jo.org_id = $2
         ORDER BY jo.created_at DESC`, [customerId, orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load job orders' };
    }
  }

  async getPayments(customerId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT p.id, p.mode, p.amount, p.payment_date AS "paymentDate",
                p.reference_no AS "referenceNo", p.notes,
                jo.jo_number AS "joNumber", v.plate_number AS "plateNumber"
         FROM tbljo_payments p
         INNER JOIN tbljoborders jo ON jo.id = p.job_order_id
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         WHERE c.id = $1 AND p.org_id = $2
         ORDER BY p.payment_date DESC`, [customerId, orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load payments' };
    }
  }

  async getHistory(customerId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT sh.id, sh.service_date AS "serviceDate", sh.notes,
                sh.parts_replaced AS "partsReplaced",
                v.plate_number AS "plateNumber", v.make, v.model,
                jo.jo_number AS "joNumber", jo.status AS "joStatus"
         FROM tblservice_history sh
         INNER JOIN tblvehicles v ON v.id = sh.vehicle_id
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         INNER JOIN tbljoborders jo ON jo.id = sh.job_order_id
         WHERE c.id = $1 AND sh.org_id = $2
         ORDER BY sh.service_date DESC`, [customerId, orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load history' };
    }
  }

  async searchByPlate(plate: string, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT v.id AS "vehicleId", v.plate_number AS "plateNumber", v.make, v.model,
                v.year_model AS "yearModel", v."engineType" AS "engineType",
                v.fuel_type AS "fuelType", v.odometer_reading AS "odometerReading",
                v.color, v.transmission, v.chassis_info AS "chassisInfo",
                c.id AS "customerId", c.name AS "customerName",
                c.contact, c.email, c.address
         FROM tblvehicles v
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         WHERE UPPER(TRIM(v.plate_number)) = UPPER(TRIM($1)) AND v.org_id = $2
         LIMIT 1`, [plate, orgId]);
      return { success: true, data: result.rows[0] ?? null };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to search plate' };
    }
  }
}
