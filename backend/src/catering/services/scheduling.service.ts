import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from 'src/database/database.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { ExpenseEntryDto } from '../dto/complete-schedule.dto';

@Injectable()
export class SchedulingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  private getStsCateringOrgId(): number {
    return Number(
      this.configService.get<string>('STS_CATERING_ORG_ID', '1'),
    );
  }

  // ── Public Schedule Creation ──────────────────────────────────────────────

  async createPublicSchedule(dto: CreateScheduleDto) {
    try {
      // Validate package exists
      const packageResult = await this.db.query<{
        id: number;
        min_pax: number;
      }>(
        `SELECT id, min_pax FROM catering_packages WHERE id = $1`,
        [dto.packageId],
      );

      if (packageResult.rowCount === 0) {
        return {
          success: false,
          message: 'The selected package does not exist',
        };
      }

      const pkg = packageResult.rows[0];

      // Validate pax >= package min_pax
      if (dto.pax < pkg.min_pax) {
        return {
          success: false,
          message: `Number of pax does not meet the package minimum requirement of ${pkg.min_pax}`,
        };
      }

      // Validate event_date is in the future
      const eventDate = new Date(dto.eventDate);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (eventDate <= today) {
        return {
          success: false,
          message: 'Event date must be a future date',
        };
      }

      // Get the STS Catering Services org ID
      const orgId = this.getStsCateringOrgId();

      // Create the schedule and store menu selections in a transaction
      let scheduleId: number;

      await this.db.withTransaction(async (client) => {
        // Create the schedule with status 'pending'
        const result = await client.query<{ id: number }>(
          `INSERT INTO catering_schedules
             (org_id, customer_name, contact_number, venue, event_date, pax, package_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
           RETURNING id`,
          [
            orgId,
            dto.customerName,
            dto.contactNumber,
            dto.venue,
            dto.eventDate,
            dto.pax,
            dto.packageId,
          ],
        );

        scheduleId = Number(result.rows[0].id);

        // Store menu selections if provided
        if (dto.menuSelections && dto.menuSelections.length > 0) {
          for (const selection of dto.menuSelections) {
            await client.query(
              `INSERT INTO catering_schedule_selections (schedule_id, menu_item_id, category)
               VALUES ($1, $2, $3)`,
              [scheduleId, selection.menuItemId, selection.category],
            );
          }
        }
      });

      return {
        success: true,
        data: { id: scheduleId! },
        message: 'Thank you for Scheduling with us',
      };
    } catch (e) {
      return {
        success: false,
        message:
          e instanceof Error ? e.message : 'Failed to create schedule',
      };
    }
  }

  // ── List Schedules ────────────────────────────────────────────────────────

  async findAll(orgId: number, status?: string) {
    try {
      const conditions: string[] = ['s.org_id = $1'];
      const params: unknown[] = [orgId];

      if (status) {
        params.push(status);
        conditions.push(`s.status = $${params.length}`);
      }

      // Determine order: ASC for pending/in_progress, DESC for completed
      let orderDirection = 'ASC';
      if (status === 'completed') {
        orderDirection = 'DESC';
      }

      const result = await this.db.query(
        `SELECT s.id, s.org_id AS "orgId", s.customer_name AS "customerName",
                s.contact_number AS "contactNumber", s.venue,
                s.event_date AS "eventDate", s.event_time AS "eventTime", s.pax,
                s.package_id AS "packageId", p.name AS "packageName",
                p.price_per_head AS "pricePerHead",
                s.status, s.total_expense AS "totalExpense",
                s.payment_method AS "paymentMethod",
                s.discount_amount AS "discountAmount",
                s.discount_type AS "discountType",
                s.notes,
                s.payment_reference AS "paymentReference",
                s.cheque_issued_by AS "chequeIssuedBy",
                s.cheque_post_dated AS "chequePostDated",
                s.cheque_amount AS "chequeAmount",
                s.is_floating_sales AS "isFloatingSales",
                s.created_at AS "createdAt", s.updated_at AS "updatedAt"
         FROM catering_schedules s
         JOIN catering_packages p ON s.package_id = p.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY s.event_date ${orderDirection}`,
        params,
      );

      return { success: true, data: result.rows };
    } catch (e) {
      return {
        success: false,
        message:
          e instanceof Error ? e.message : 'Failed to load schedules',
      };
    }
  }

  // ── Confirm Schedule ──────────────────────────────────────────────────────

  async confirm(id: number, orgId: number) {
    try {
      // Find the schedule
      const scheduleResult = await this.db.query<{
        id: number;
        status: string;
      }>(
        `SELECT id, status FROM catering_schedules WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );

      if (scheduleResult.rowCount === 0) {
        return { success: false, message: 'Schedule not found' };
      }

      const schedule = scheduleResult.rows[0];

      if (schedule.status !== 'pending') {
        return {
          success: false,
          message: 'Only pending schedules can be confirmed',
        };
      }

      // Update status to 'in_progress'
      const result = await this.db.query(
        `UPDATE catering_schedules
         SET status = 'in_progress', updated_at = NOW()
         WHERE id = $1 AND org_id = $2
         RETURNING id, org_id AS "orgId", customer_name AS "customerName",
                   contact_number AS "contactNumber", venue,
                   event_date AS "eventDate", pax,
                   package_id AS "packageId", status,
                   total_expense AS "totalExpense",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, orgId],
      );

      return { success: true, data: result.rows[0] };
    } catch (e) {
      return {
        success: false,
        message:
          e instanceof Error ? e.message : 'Failed to confirm schedule',
      };
    }
  }

  // ── Complete Schedule ─────────────────────────────────────────────────────

  async complete(id: number, orgId: number, expenses: ExpenseEntryDto[]) {
    try {
      // Find the schedule
      const scheduleResult = await this.db.query<{
        id: number;
        status: string;
      }>(
        `SELECT id, status FROM catering_schedules WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );

      if (scheduleResult.rowCount === 0) {
        return { success: false, message: 'Schedule not found' };
      }

      const schedule = scheduleResult.rows[0];

      if (schedule.status !== 'in_progress') {
        return {
          success: false,
          message: 'Only in-progress schedules can be completed',
        };
      }

      // Validate expense amounts
      for (const expense of expenses) {
        if (expense.amount < 0 || expense.amount > 999999999.99) {
          return {
            success: false,
            message:
              'Expense amounts must be between 0.00 and 999,999,999.99',
          };
        }
      }

      // Use a transaction to insert expenses and update schedule
      await this.db.withTransaction(async (client) => {
        // Insert each expense
        for (const expense of expenses) {
          await client.query(
            `INSERT INTO catering_expenses (schedule_id, category, amount)
             VALUES ($1, $2, $3)`,
            [id, expense.category, expense.amount],
          );
        }

        // Calculate total expense
        const totalExpense = expenses.reduce(
          (sum, exp) => sum + Number(exp.amount),
          0,
        );

        // Update schedule status and total_expense
        await client.query(
          `UPDATE catering_schedules
           SET status = 'completed', total_expense = $1, updated_at = NOW()
           WHERE id = $2 AND org_id = $3`,
          [totalExpense, id, orgId],
        );
      });

      return { success: true, message: 'Schedule completed successfully' };
    } catch (e) {
      return {
        success: false,
        message:
          e instanceof Error ? e.message : 'Failed to complete schedule',
      };
    }
  }

  // ── Cancel Schedule ───────────────────────────────────────────────────────

  async cancel(id: number, orgId: number) {
    try {
      const scheduleResult = await this.db.query<{ id: number; status: string }>(
        `SELECT id, status FROM catering_schedules WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );

      if (scheduleResult.rowCount === 0) {
        return { success: false, message: 'Schedule not found' };
      }

      const schedule = scheduleResult.rows[0];

      if (schedule.status !== 'pending') {
        return {
          success: false,
          message: 'Only pending schedules can be cancelled',
        };
      }

      await this.db.query(
        `UPDATE catering_schedules SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );

      return { success: true, message: 'Schedule cancelled successfully' };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to cancel schedule',
      };
    }
  }

  // ── Get Schedule Menu Selections ────────────────────────────────────────────

  async getMenuSelections(id: number, orgId: number) {
    try {
      const result = await this.db.query<{
        id: number;
        menu_item_id: number;
        category: string;
        menu_item_name: string;
        image_url: string | null;
      }>(
        `SELECT ss.id, ss.menu_item_id, ss.category, mi.name AS menu_item_name, mi.image_url
         FROM catering_schedule_selections ss
         JOIN catering_menu_items mi ON mi.id = ss.menu_item_id
         JOIN catering_schedules s ON s.id = ss.schedule_id
         WHERE ss.schedule_id = $1 AND s.org_id = $2
         ORDER BY ss.category ASC, mi.name ASC`,
        [id, orgId],
      );
      return { success: true, data: result.rows.map(r => ({
        menuItemId: Number(r.menu_item_id),
        menuItemName: r.menu_item_name,
        category: r.category,
        imageUrl: r.image_url,
      })) };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load menu selections' };
    }
  }

  // ── Update Schedule Details ────────────────────────────────────────────────

  async updateDetails(id: number, orgId: number, dto: {
    customerName?: string;
    contactNumber?: string;
    venue?: string;
    eventDate?: string;
    eventTime?: string;
    pax?: number;
    paymentMethod?: string;
    discountAmount?: number;
    discountType?: string;
    notes?: string;
    paymentReference?: string;
    chequeIssuedBy?: string;
    chequePostDated?: string;
    chequeAmount?: number;
    isFloatingSales?: boolean;
  }) {
    try {
      const scheduleResult = await this.db.query<{ id: number; status: string }>(
        `SELECT id, status FROM catering_schedules WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      if (scheduleResult.rowCount === 0) {
        return { success: false, message: 'Schedule not found' };
      }
      if (scheduleResult.rows[0].status !== 'pending') {
        return { success: false, message: 'Only pending schedules can be edited' };
      }

      const sets: string[] = [];
      const params: unknown[] = [];

      const push = (col: string, val: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };

      if (dto.customerName !== undefined) push('customer_name', dto.customerName);
      if (dto.contactNumber !== undefined) push('contact_number', dto.contactNumber);
      if (dto.venue !== undefined) push('venue', dto.venue);
      if (dto.eventDate !== undefined) push('event_date', dto.eventDate);
      if (dto.eventTime !== undefined) push('event_time', dto.eventTime || null);
      if (dto.pax !== undefined) push('pax', dto.pax);
      if (dto.paymentMethod !== undefined) push('payment_method', dto.paymentMethod || null);
      if (dto.discountAmount !== undefined) push('discount_amount', dto.discountAmount);
      if (dto.discountType !== undefined) push('discount_type', dto.discountType || 'fixed');
      if (dto.notes !== undefined) push('notes', dto.notes || null);
      if (dto.paymentReference !== undefined) push('payment_reference', dto.paymentReference || null);
      if (dto.chequeIssuedBy !== undefined) push('cheque_issued_by', dto.chequeIssuedBy || null);
      if (dto.chequePostDated !== undefined) push('cheque_post_dated', dto.chequePostDated || null);
      if (dto.chequeAmount !== undefined) push('cheque_amount', dto.chequeAmount || null);
      if (dto.isFloatingSales !== undefined) push('is_floating_sales', dto.isFloatingSales ?? false);

      if (sets.length === 0) {
        return { success: false, message: 'No changes provided' };
      }

      sets.push('updated_at = NOW()');
      params.push(id, orgId);

      await this.db.query(
        `UPDATE catering_schedules SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND org_id = $${params.length}`,
        params,
      );

      return { success: true, message: 'Schedule updated successfully' };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update schedule' };
    }
  }

  // ── Update Schedule Package ───────────────────────────────────────────────

  async updatePackage(id: number, orgId: number, packageId: number) {
    try {
      const scheduleResult = await this.db.query<{ id: number; status: string }>(
        `SELECT id, status FROM catering_schedules WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );

      if (scheduleResult.rowCount === 0) {
        return { success: false, message: 'Schedule not found' };
      }

      if (scheduleResult.rows[0].status !== 'pending') {
        return { success: false, message: 'Only pending schedules can be updated' };
      }

      // Verify new package exists
      const pkgResult = await this.db.query<{ id: number }>(
        `SELECT id FROM catering_packages WHERE id = $1 AND org_id = $2`,
        [packageId, orgId],
      );

      if (pkgResult.rowCount === 0) {
        return { success: false, message: 'Package not found' };
      }

      await this.db.query(
        `UPDATE catering_schedules SET package_id = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [packageId, id, orgId],
      );

      return { success: true, message: 'Package updated successfully' };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to update package',
      };
    }
  }
}
