import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  // ── Dashboard Metrics ─────────────────────────────────────────────────────

  async getMetrics(orgId: number) {
    try {
      // Query pending count
      const pendingResult = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM catering_schedules WHERE org_id = $1 AND status = 'pending'`,
        [orgId],
      );

      // Query in_progress count
      const inProgressResult = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM catering_schedules WHERE org_id = $1 AND status = 'in_progress'`,
        [orgId],
      );

      // Query total sales (sum of pax * price_per_head for completed schedules)
      const salesResult = await this.db.query<{ total: string }>(
        `SELECT COALESCE(SUM(s.pax * p.price_per_head), 0) AS total
         FROM catering_schedules s
         JOIN catering_packages p ON s.package_id = p.id
         WHERE s.org_id = $1 AND s.status = 'completed'`,
        [orgId],
      );

      // Query total expenses (sum of expense amounts for completed schedules)
      const expensesResult = await this.db.query<{ total: string }>(
        `SELECT COALESCE(SUM(e.amount), 0) AS total
         FROM catering_expenses e
         JOIN catering_schedules s ON e.schedule_id = s.id
         WHERE s.org_id = $1 AND s.status = 'completed'`,
        [orgId],
      );

      return {
        success: true,
        data: {
          pendingCount: parseInt(pendingResult.rows[0].count, 10),
          inProgressCount: parseInt(inProgressResult.rows[0].count, 10),
          totalSales: parseFloat(
            parseFloat(salesResult.rows[0].total).toFixed(2),
          ),
          totalExpenses: parseFloat(
            parseFloat(expensesResult.rows[0].total).toFixed(2),
          ),
        },
      };
    } catch (e) {
      return {
        success: false,
        message:
          e instanceof Error ? e.message : 'Failed to load dashboard metrics',
      };
    }
  }

  // ── Feedback List ─────────────────────────────────────────────────────────

  async getFeedbackList(orgId: number, page: number = 1) {
    try {
      const pageSize = 50;
      const offset = (page - 1) * pageSize;

      // Query total count and average rating
      const statsResult = await this.db.query<{
        count: string;
        avg_rating: string;
      }>(
        `SELECT COUNT(*) AS count, COALESCE(AVG(f.rating), 0) AS avg_rating
         FROM catering_feedback f
         JOIN catering_schedules s ON f.schedule_id = s.id
         WHERE s.org_id = $1`,
        [orgId],
      );

      const total = parseInt(statsResult.rows[0].count, 10);
      const averageRating =
        total === 0
          ? 0
          : parseFloat(parseFloat(statsResult.rows[0].avg_rating).toFixed(1));

      // If no records, return early with empty response
      if (total === 0) {
        return {
          success: true,
          data: {
            items: [],
            averageRating: 0,
            total: 0,
            page,
            pageSize,
          },
        };
      }

      // Query paginated feedback items
      const itemsResult = await this.db.query<{
        id: number;
        rating: number;
        review: string | null;
        feedback_type: string;
        created_at: string;
        customer_name: string;
        event_date: string;
      }>(
        `SELECT f.id, f.rating, f.review, f.feedback_type, f.created_at,
                s.customer_name, s.event_date
         FROM catering_feedback f
         JOIN catering_schedules s ON f.schedule_id = s.id
         WHERE s.org_id = $1
         ORDER BY f.created_at DESC
         LIMIT $2 OFFSET $3`,
        [orgId, pageSize, offset],
      );

      const items = itemsResult.rows.map((row) => ({
        id: row.id,
        customerName: row.customer_name,
        rating: row.rating,
        review: row.review,
        feedbackType: row.feedback_type,
        submittedAt: row.created_at,
        eventDate: row.event_date,
      }));

      return {
        success: true,
        data: {
          items,
          averageRating,
          total,
          page,
          pageSize,
        },
      };
    } catch (e) {
      return {
        success: false,
        message:
          e instanceof Error ? e.message : 'Failed to load feedback list',
      };
    }
  }
}
