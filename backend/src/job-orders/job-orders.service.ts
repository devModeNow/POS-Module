import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class JobOrdersService {
  constructor(private readonly db: DatabaseService) {}

  private async generateJoNumber(orgId: number): Promise<string> {
    const year = new Date().getFullYear();
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tbljoborders
       WHERE org_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`, [orgId, year]);
    const seq = String(Number(result.rows[0]?.count ?? 0) + 1).padStart(4, '0');
    return `JO-${year}-${seq}`;
  }

  async findAll(orgId: number, status?: string, search?: string) {
    try {
      const conditions = [`jo.org_id = $1`];
      const params: unknown[] = [orgId];
      if (status) { params.push(status); conditions.push(`jo.status = $${params.length}`); }
      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        conditions.push(`(LOWER(jo.jo_number) LIKE LOWER($${params.length}) OR LOWER(v.plate_number) LIKE LOWER($${params.length}) OR LOWER(c.name) LIKE LOWER($${params.length}))`);
      }
      const result = await this.db.query(
        `SELECT jo.id, jo.jo_number AS "joNumber", jo.status, jo.description,
                jo.total_amount AS "totalAmount", jo.labor_fee AS "laborFee",
                jo.discount, jo.created_at AS "createdAt", jo.updated_at AS "updatedAt",
                jo.for_payment_at AS "forPaymentAt", jo.completed_at AS "completedAt",
                jo.transaction_date AS "transactionDate",
                v.plate_number AS "plateNumber", v.make, v.model,
                c.id AS "customerId", c.name AS "customerName", c.contact,
                t.name AS "mechanicName",
                (SELECT p.mode FROM tbljo_payments p WHERE p.job_order_id = jo.id ORDER BY p.id DESC LIMIT 1) AS "paymentMode"
         FROM tbljoborders jo
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         LEFT JOIN tblcustomers c ON c.id = v.customer_id
         LEFT JOIN tbltechnicians t ON t.id = COALESCE(jo.technician_id, jo."technicianId")
         WHERE ${conditions.join(' AND ')}
         ORDER BY COALESCE(jo.transaction_date, jo.created_at::date) DESC, jo.created_at DESC`, params);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load job orders' };
    }
  }

  async findOne(id: number, orgId: number) {
    try {
      const jo = await this.db.query(
        `SELECT jo.id, jo.jo_number AS "joNumber", jo.status, jo.description,
                jo.labor_fee AS "laborFee", jo.discount, jo.total_amount AS "totalAmount",
                jo.customer_signature_data AS "customerSignatureData",
                jo.mechanic_signature_data AS "mechanicSignatureData",
                jo.created_at AS "createdAt", jo.updated_at AS "updatedAt",
                jo.for_payment_at AS "forPaymentAt", jo.completed_at AS "completedAt",
                jo.transaction_date AS "transactionDate",
                jo.odometer_reading AS "joOdometerReading",
                COALESCE(jo.warranty_text, '') AS "warranty",
                COALESCE(jo.parts_supplied_by, '') AS "partsSuppliedBy",
                COALESCE(jo.released_by, '') AS "releasedBy",
                v.plate_number AS "plateNumber", v.make, v.model,
                v.year_model AS "yearModel", v."engineType" AS "engineType",
                v.fuel_type AS "fuelType", v.odometer_reading AS "odometerReading",
                v.color, v.transmission,
                c.id AS "customerId", c.name AS "customerName",
                c.contact, c.email, c.address,
                t.name AS "mechanicName"
         FROM tbljoborders jo
         INNER JOIN tblvehicles v ON v.id = jo.vehicle_id
         LEFT JOIN tblcustomers c ON c.id = v.customer_id
         LEFT JOIN tbltechnicians t ON t.id = COALESCE(jo.technician_id, jo."technicianId")
         WHERE jo.id = $1 AND jo.org_id = $2 LIMIT 1`, [id, orgId]);
      if (jo.rowCount === 0) return { success: false, message: 'Job order not found' };

      const supplies = await this.db.query(
        `SELECT s.id, s."supplyType" AS "supplyType", s.service_name AS "serviceName",
                s.description, s.quantity, s.cost_price AS "costPrice",
                s.billing_price AS "billingPrice", s.fee, s.source,
                s.parts_supplied_by AS "suppliedBy",
                s.record_as_expense AS "recordAsExpense",
                i.part_name AS "inventoryName"
         FROM tbljoborder_supplies s
         LEFT JOIN tblinventory i ON i.id = s.inventory_id
         WHERE s.job_order_id = $1 ORDER BY s.id ASC`, [id]);

      const payments = await this.db.query(
        `SELECT id, mode, amount, payment_date AS "paymentDate",
                reference_no AS "referenceNo", notes, created_at AS "createdAt"
         FROM tbljo_payments WHERE job_order_id = $1 ORDER BY payment_date ASC`, [id]);

      return {
        success: true,
        data: { ...jo.rows[0], supplies: supplies.rows, payments: payments.rows },
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load job order' };
    }
  }

  async create(orgId: number, createdBy: number, dto: {
    vehicleId?: number; plateNumber?: string; make?: string; model?: string;
    yearModel?: number; engineType?: string; fuelType?: string; odometerReading?: number;
    color?: string; transmission?: string;
    customerId?: number; customerName?: string; contact?: string; email?: string; address?: string;
    technicianId?: number; description?: string; status?: string;
    customerSignatureData?: string | null;
    transactionDate?: string | null;
    services?: Array<{ serviceName: string; description?: string; fee: number }>;
    parts?: Array<{ inventoryId?: number; description: string; quantity: number; costPrice?: number; billingPrice?: number; source?: string; suppliedBy?: string; recordAsExpense?: boolean }>;
    laborFee?: number; discount?: number; totalAmount?: number;
  }) {
    try {
      let vehicleId = dto.vehicleId;
      let customerId = dto.customerId;

      await this.db.withTransaction(async (client) => {
        // Upsert customer if new
        if (!customerId && dto.customerName?.trim()) {
          const cust = await client.query<{ id: number }>(
            `INSERT INTO tblcustomers (org_id, name, contact, email, address)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [orgId, dto.customerName.trim(), dto.contact ?? null, dto.email ?? null, dto.address ?? null]);
          customerId = cust.rows[0].id;
        } else if (customerId) {
          // Update existing customer details
          await client.query(
            `UPDATE tblcustomers SET contact=$1, email=$2, address=$3 WHERE id=$4`,
            [dto.contact ?? null, dto.email ?? null, dto.address ?? null, customerId]);
        }

        // Upsert vehicle if new
        if (!vehicleId && dto.plateNumber?.trim()) {
          const plate = dto.plateNumber.trim().toUpperCase();
          const existing = await client.query<{ id: number }>(
            `SELECT id FROM tblvehicles WHERE UPPER(TRIM(plate_number)) = $1 AND org_id = $2 LIMIT 1`,
            [plate, orgId]);
          if (existing.rowCount > 0) {
            vehicleId = existing.rows[0].id;
            await client.query(
              `UPDATE tblvehicles SET make=$1, model=$2, year_model=$3, "engineType"=$4,
               fuel_type=$5, odometer_reading=$6, color=$7, transmission=$8 WHERE id=$9`,
              [dto.make ?? null, dto.model ?? null, dto.yearModel ?? null, dto.engineType ?? null,
               dto.fuelType ?? null, dto.odometerReading ?? null, dto.color ?? null,
               dto.transmission ?? null, vehicleId]);
          } else {
            const veh = await client.query<{ id: number }>(
              `INSERT INTO tblvehicles (customer_id, org_id, plate_number, make, model, year_model,
               "engineType", fuel_type, odometer_reading, color, transmission)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
              [customerId, orgId, plate, dto.make ?? '', dto.model ?? '', dto.yearModel ?? null,
               dto.engineType ?? null, dto.fuelType ?? null, dto.odometerReading ?? null,
               dto.color ?? null, dto.transmission ?? null]);
            vehicleId = veh.rows[0].id;
          }
        }

        const joNumber = await this.generateJoNumber(orgId);
        const techId = dto.technicianId ? Number(dto.technicianId) : null;
        const jo = await client.query<{ id: number }>(
          `INSERT INTO tbljoborders
             (org_id, vehicle_id, technician_id, "technicianId", description, status, jo_number,
              labor_fee, discount, total_amount, customer_signature_data, created_by, odometer_reading, transaction_date, updated_at)
           VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) RETURNING id`,
          [orgId, vehicleId, techId, dto.description ?? '',
           dto.status ?? 'pending', joNumber, dto.laborFee ?? 0,
           dto.discount ?? 0, dto.totalAmount ?? 0,
           dto.customerSignatureData ?? null, createdBy, dto.odometerReading ?? null,
           dto.transactionDate ?? null]);
        const joId = jo.rows[0].id;

        // Insert services
        for (const svc of dto.services ?? []) {
          await client.query(
            `INSERT INTO tbljoborder_supplies (job_order_id, "supplyType", service_name, description, quantity, fee, billing_price, source)
             VALUES ($1,'service',$2,$3,1,$4,$4,'service')`,
            [joId, svc.serviceName, svc.description ?? '', svc.fee ?? 0]);
        }

        // Insert parts
        for (const part of dto.parts ?? []) {
          await client.query(
            `INSERT INTO tbljoborder_supplies (job_order_id, "supplyType", inventory_id, description, quantity, cost_price, billing_price, source, parts_supplied_by, record_as_expense)
             VALUES ($1,'part',$2,$3,$4,$5,$6,$7,$8,$9)`,
            [joId, part.inventoryId ?? null, part.description, part.quantity ?? 1,
             part.costPrice ?? 0, part.billingPrice ?? 0, part.source ?? 'inventory', part.suppliedBy ?? 'car_expert', part.recordAsExpense ?? false]);

          // Deduct from inventory if from stock
          if (part.inventoryId && (part.source ?? 'inventory') === 'inventory') {
            await client.query(
              `UPDATE tblinventory SET stock_qty = GREATEST(stock_qty - $1, 0) WHERE id = $2`,
              [part.quantity ?? 1, part.inventoryId]);
          }
        }

        // Return joId via closure
        (dto as any)._joId = joId;
      });

      return { success: true, id: (dto as any)._joId };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create job order' };
    }
  }

  async updateStatus(id: number, orgId: number, status: string, extra?: Record<string, unknown>) {
    try {
      const sets: string[] = [`status = $1`, `updated_at = NOW()`];
      const vals: unknown[] = [status];
      if (status === 'for-payment') { sets.push(`for_payment_at = NOW()`); }
      if (status === 'released')    { sets.push(`completed_at = NOW()`); }
      if (extra?.jobsDone)          { vals.push(extra.jobsDone); sets.push(`jobs_done = $${vals.length}`); }
      if (extra?.serviceRemarks)    { vals.push(extra.serviceRemarks); sets.push(`service_remarks = $${vals.length}`); }
      if (extra?.warranty != null)  { vals.push(extra.warranty); sets.push(`warranty_text = $${vals.length}`); }
      if (extra?.releasedBy)        { vals.push(extra.releasedBy); sets.push(`released_by = $${vals.length}`); }
      vals.push(id, orgId);
      await this.db.query(
        `UPDATE tbljoborders SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND org_id = $${vals.length}`, vals);

      // When released, create expense records for parts marked as expense
      if (status === 'released') {
        try {
          const expenseParts = await this.db.query<{ description: string; billing_price: string; quantity: string }>(
            `SELECT description, billing_price, quantity FROM tbljoborder_supplies
             WHERE job_order_id = $1 AND "supplyType" = 'part'
               AND COALESCE(record_as_expense, false) = true`,
            [id],
          );

          for (const part of expenseParts.rows) {
            const qty = Number(part.quantity) || 1;
            const amount = (Number(part.billing_price) || 0) * qty;
            if (amount > 0) {
              await this.db.query(
                `INSERT INTO tblorg_expenses (org_id, description, amount, category, expense_date)
                 VALUES ($1, $2, $3, 'Parts', CURRENT_DATE)`,
                [orgId, `JO Parts: ${part.description}`, amount],
              );
            }
          }
        } catch (expErr) {
          // Log but don't fail the release if expense creation has issues
          console.error('Failed to create expense records:', expErr);
        }
      }

      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update status' };
    }
  }

  async saveSignature(id: number, orgId: number, type: 'customer' | 'mechanic', signatureData: string, signatoryName?: string) {
    try {
      const col = type === 'customer' ? 'customer_signature_data' : 'mechanic_signature_data';
      const nameCol = type === 'customer' ? 'customer_approved_by' : 'mechanic_signatory_name';
      const timeCol = type === 'customer' ? 'customer_approved_at' : 'mechanic_signed_at';
      await this.db.query(
        `UPDATE tbljoborders SET "${col}" = $1, "${nameCol}" = $2, "${timeCol}" = NOW(), updated_at = NOW()
         WHERE id = $3 AND org_id = $4`,
        [signatureData, signatoryName ?? null, id, orgId]);
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to save signature' };
    }
  }

  async addPayment(id: number, orgId: number, createdBy: number, dto: {
    mode: string; amount: number; paymentDate: string; referenceNo?: string; notes?: string;
  }) {
    try {
      await this.db.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO tbljo_payments (job_order_id, org_id, mode, amount, payment_date, reference_no, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, orgId, dto.mode, dto.amount, dto.paymentDate, dto.referenceNo ?? null, dto.notes ?? null, createdBy]);

        // Create service history entry
        const jo = await client.query(
          `SELECT vehicle_id FROM tbljoborders WHERE id = $1 LIMIT 1`, [id]);
        if (jo.rowCount > 0) {
          await client.query(
            `INSERT INTO tblservice_history (vehicle_id, job_order_id, org_id, service_date, notes)
             VALUES ($1,$2,$3,NOW(),'Payment recorded')`,
            [jo.rows[0].vehicle_id, id, orgId]);
        }
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to add payment' };
    }
  }

  async getTechnicians(orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT id, name, contact_info AS "contactInfo" FROM tbltechnicians
         WHERE org_id = $1 ORDER BY name ASC`, [orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load technicians' };
    }
  }

  async createTechnician(orgId: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, message: 'Technician name is required' };
    try {
      const result = await this.db.query<{ id: number; name: string }>(
        `INSERT INTO tbltechnicians (org_id, name) VALUES ($1, $2) RETURNING id, name`,
        [orgId, trimmed],
      );
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create technician' };
    }
  }

  async searchTechnicians(orgId: number, query: string) {
    try {
      const result = await this.db.query(
        `SELECT id, name, contact_info AS "contactInfo"
         FROM tbltechnicians
         WHERE org_id = $1 AND LOWER(name) LIKE LOWER($2)
         ORDER BY name ASC LIMIT 20`,
        [orgId, `%${query.trim()}%`],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Search failed' };
    }
  }

  async searchVehicles(orgId: number, query: string) {
    try {
      const result = await this.db.query(
        `SELECT v.id, v.plate_number AS "plateNumber", v.make, v.model,
                v.year_model AS "yearModel", v."engineType" AS "engineType",
                v.fuel_type AS "fuelType", v.odometer_reading AS "odometerReading",
                v.color, v.transmission,
                c.id AS "customerId", c.name AS "customerName",
                c.contact, c.email, c.address,
                (SELECT jo2.odometer_reading FROM tbljoborders jo2 WHERE jo2.vehicle_id = v.id ORDER BY jo2.created_at DESC LIMIT 1) AS "lastOdometerReading"
         FROM tblvehicles v
         INNER JOIN tblcustomers c ON c.id = v.customer_id
         WHERE v.org_id = $1
           AND (UPPER(v.plate_number) LIKE UPPER($2) OR LOWER(v.make) LIKE LOWER($2) OR LOWER(v.model) LIKE LOWER($2))
         ORDER BY v.plate_number ASC LIMIT 20`,
        [orgId, `%${query.trim()}%`],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Search failed' };
    }
  }

  async getVehicleHistory(vehicleId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT jo.id, jo.jo_number AS "joNumber", jo.status, jo.description,
                jo.total_amount AS "totalAmount", jo.labor_fee AS "laborFee",
                jo.odometer_reading AS "odometerReading",
                jo.created_at AS "createdAt", jo.updated_at AS "updatedAt",
                t.name AS "mechanicName"
         FROM tbljoborders jo
         LEFT JOIN tbltechnicians t ON t.id = COALESCE(jo.technician_id, jo."technicianId")
         WHERE jo.vehicle_id = $1 AND jo.org_id = $2
         ORDER BY jo.created_at DESC`,
        [vehicleId, orgId],
      );

      const historyItems = result.rows;

      // Fetch supplies for all history JOs
      if (historyItems.length > 0) {
        const joIds = historyItems.map((h: any) => h.id);
        const suppliesResult = await this.db.query(
          `SELECT s.job_order_id, s."supplyType", s.service_name AS "serviceName", s.description, s.quantity, s.billing_price AS "billingPrice"
           FROM tbljoborder_supplies s
           WHERE s.job_order_id = ANY($1)
           ORDER BY s.job_order_id, s.id ASC`,
          [joIds],
        );

        // Group supplies by job_order_id
        const suppliesByJo: Record<number, any[]> = {};
        for (const s of suppliesResult.rows) {
          if (!suppliesByJo[s.job_order_id]) suppliesByJo[s.job_order_id] = [];
          suppliesByJo[s.job_order_id].push(s);
        }

        // Attach services and parts to each history item
        for (const h of historyItems as any[]) {
          const supplies = suppliesByJo[h.id] ?? [];
          h.services = supplies
            .filter((s: any) => s.supplyType === 'service')
            .map((s: any) => s.serviceName || s.description)
            .filter(Boolean);
          h.parts = supplies
            .filter((s: any) => s.supplyType === 'part')
            .map((s: any) => ({ description: s.description, quantity: Number(s.quantity) || 1 }));
        }
      }

      return { success: true, data: historyItems };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load vehicle history' };
    }
  }

  async searchCustomers(orgId: number, query: string) {
    try {
      const result = await this.db.query(
        `SELECT c.id, c.name, c.contact, c.email, c.address
         FROM tblcustomers c
         WHERE c.org_id = $1 AND LOWER(c.name) LIKE LOWER($2)
         ORDER BY c.name ASC LIMIT 20`,
        [orgId, `%${query.trim()}%`],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Search failed' };
    }
  }

  // ── Service Lookup ───────────────────────────────────────────────────────

  async searchServices(orgId: number, query: string) {
    try {
      const result = await this.db.query(
        `SELECT id, name, default_fee AS "defaultFee" FROM tbljo_services
         WHERE org_id = $1 AND LOWER(name) LIKE LOWER($2)
         ORDER BY name ASC LIMIT 20`,
        [orgId, `%${query.trim()}%`],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Search failed' };
    }
  }

  async createService(orgId: number, name: string, defaultFee?: number) {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, message: 'Service name is required' };
    try {
      const result = await this.db.query<{ id: number; name: string }>(
        `INSERT INTO tbljo_services (org_id, name, default_fee)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_id, LOWER(name)) DO NOTHING
         RETURNING id, name`,
        [orgId, trimmed, defaultFee ?? 0],
      );
      if (result.rowCount === 0) {
        const existing = await this.db.query<{ id: number; name: string; defaultFee: number }>(
          `SELECT id, name, default_fee AS "defaultFee" FROM tbljo_services WHERE org_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
          [orgId, trimmed]);
        return { success: true, data: existing.rows[0] };
      }
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create service' };
    }
  }

  // ── Change Logs ─────────────────────────────────────────────────────────

  async getChangeLogs(joId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT id, action, description, old_value AS "oldValue", new_value AS "newValue",
                created_by_name AS "createdByName", created_at AS "createdAt"
         FROM tbljo_change_logs
         WHERE job_order_id = $1 AND org_id = $2
         ORDER BY created_at DESC`,
        [joId, orgId],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load change logs' };
    }
  }

  async addChangeLog(orgId: number, joId: number, action: string, description: string, userId?: number, userName?: string, oldValue?: string, newValue?: string) {
    try {
      await this.db.query(
        `INSERT INTO tbljo_change_logs (org_id, job_order_id, action, description, old_value, new_value, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [orgId, joId, action, description, oldValue ?? null, newValue ?? null, userId ?? null, userName ?? null],
      );
    } catch { /* non-critical, don't fail the main operation */ }
  }

  // ── Update Supplies (in-progress modification) ──────────────────────────

  async updateSupplies(joId: number, orgId: number, userId: number, userName: string, dto: {
    services?: Array<{ serviceName: string; description?: string; fee: number }>;
    parts?: Array<{ inventoryId?: number | null; description: string; quantity: number; costPrice?: number; billingPrice?: number; source?: string; suppliedBy?: string; recordAsExpense?: boolean }>;
    customerSignatureData?: string;
    laborFee?: number;
    discount?: number;
  }) {
    try {
      // Verify JO exists and is in-progress
      const joCheck = await this.db.query<{ status: string; total_amount: number }>(
        `SELECT status, total_amount FROM tbljoborders WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [joId, orgId],
      );
      if (joCheck.rowCount === 0) return { success: false, message: 'Job order not found' };
      if (joCheck.rows[0].status !== 'in-progress') return { success: false, message: 'Only in-progress job orders can be modified' };

      await this.db.withTransaction(async (client) => {
        // Delete existing supplies
        await client.query(`DELETE FROM tbljoborder_supplies WHERE job_order_id = $1`, [joId]);

        let newTotal = 0;

        // Insert services
        for (const svc of dto.services ?? []) {
          const fee = Number(svc.fee) || 0;
          newTotal += fee;
          await client.query(
            `INSERT INTO tbljoborder_supplies (job_order_id, "supplyType", service_name, description, quantity, fee, billing_price, source)
             VALUES ($1,'service',$2,$3,1,$4,$4,'service')`,
            [joId, svc.serviceName, svc.description ?? '', fee]);
        }

        // Insert parts
        for (const part of dto.parts ?? []) {
          const billingPrice = Number(part.billingPrice) || 0;
          const qty = Number(part.quantity) || 1;
          newTotal += billingPrice * qty;
          await client.query(
            `INSERT INTO tbljoborder_supplies (job_order_id, "supplyType", inventory_id, description, quantity, cost_price, billing_price, source, parts_supplied_by, record_as_expense)
             VALUES ($1,'part',$2,$3,$4,$5,$6,$7,$8,$9)`,
            [joId, part.inventoryId ?? null, part.description, qty,
             part.costPrice ?? 0, billingPrice, part.source ?? 'manual', part.suppliedBy ?? 'car_expert', part.recordAsExpense ?? false]);
        }

        // Update total amount with labor and discount
        const laborFee = Number(dto.laborFee) || 0;
        const discountAmt = Number(dto.discount) || 0;
        const grandTotal = newTotal + laborFee - discountAmt;
        await client.query(
          `UPDATE tbljoborders SET total_amount = $1, labor_fee = $2, discount = $3, updated_at = NOW() WHERE id = $4`,
          [grandTotal, laborFee, discountAmt, joId]);

        // Save re-approval signature if provided
        if (dto.customerSignatureData) {
          await client.query(
            `UPDATE tbljoborders SET customer_signature_data = $1 WHERE id = $2`,
            [dto.customerSignatureData, joId]);
        }
      });

      // Record change log
      await this.addChangeLog(orgId, joId, 'modified', 'Services and parts modified (re-approved)', userId, userName);

      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update supplies' };
    }
  }

  async updateTransactionDate(id: number, orgId: number, transactionDate: string) {
    try {
      await this.db.query(
        `UPDATE tbljoborders SET transaction_date = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [transactionDate, id, orgId],
      );
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update transaction date' };
    }
  }
}
