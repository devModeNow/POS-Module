import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from 'src/database/database.service';
import { CreateFeedbackDto } from '../dto/create-feedback.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  private getFrontendUrl(): string {
    const corsOrigins = this.configService.get<string>('CORS_ORIGINS', 'http://localhost:4200');
    // Use the first origin as the frontend URL
    return corsOrigins.split(',')[0].trim();
  }

  // ── Submit Scheduling Feedback ────────────────────────────────────────────

  async submitSchedulingFeedback(scheduleId: number, dto: CreateFeedbackDto) {
    try {
      // Validate schedule exists
      const scheduleResult = await this.db.query<{ id: number }>(
        `SELECT id FROM catering_schedules WHERE id = $1`,
        [scheduleId],
      );

      if (scheduleResult.rowCount === 0) {
        return { success: false, message: 'Schedule not found' };
      }

      // Check no prior scheduling feedback exists
      const existingFeedback = await this.db.query<{ id: number }>(
        `SELECT id FROM catering_feedback WHERE schedule_id = $1 AND feedback_type = 'scheduling_experience'`,
        [scheduleId],
      );

      if (existingFeedback.rowCount && existingFeedback.rowCount > 0) {
        return {
          success: false,
          message: 'Feedback has already been submitted for this schedule',
        };
      }

      // Store feedback with type 'scheduling_experience'
      await this.db.query(
        `INSERT INTO catering_feedback (schedule_id, feedback_type, rating, review)
         VALUES ($1, 'scheduling_experience', $2, $3)`,
        [scheduleId, dto.rating, dto.comment || null],
      );

      return { success: true, message: 'Feedback submitted successfully' };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to submit feedback',
      };
    }
  }

  // ── Generate Rating Link ──────────────────────────────────────────────────

  async generateRatingLink(scheduleId: number, orgId: number) {
    try {
      // Validate schedule exists and belongs to org
      const scheduleResult = await this.db.query<{
        id: number;
        status: string;
      }>(
        `SELECT id, status FROM catering_schedules WHERE id = $1 AND org_id = $2`,
        [scheduleId, orgId],
      );

      if (scheduleResult.rowCount === 0) {
        return { success: false, message: 'Schedule not found' };
      }

      const schedule = scheduleResult.rows[0];

      // Validate status is 'completed'
      if (schedule.status !== 'completed') {
        return {
          success: false,
          message: 'Rating links can only be generated for completed schedules',
        };
      }

      // Generate UUID v4 token
      const token = randomUUID();

      // Calculate expiration: NOW() + 30 days
      // Insert a placeholder feedback row with the link token
      // rating = 5 (valid placeholder, will be updated on submission)
      // review = NULL indicates not yet submitted
      // link_expires_at being NOT NULL indicates the link is active
      await this.db.query(
        `INSERT INTO catering_feedback (schedule_id, feedback_type, rating, link_token, link_expires_at)
         VALUES ($1, 'satisfaction_rating', 5, $2, NOW() + INTERVAL '30 days')`,
        [scheduleId, token],
      );

      // Build the rating link URL
      const frontendUrl = this.getFrontendUrl();
      const url = `${frontendUrl}/catering/rate/${token}`;

      return {
        success: true,
        data: { url, token },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to generate rating link',
      };
    }
  }

  // ── Validate Rating Link ──────────────────────────────────────────────────

  async validateRatingLink(token: string) {
    try {
      const result = await this.db.query<{
        id: number;
        schedule_id: number;
        link_expires_at: string | null;
        review: string | null;
      }>(
        `SELECT id, schedule_id, link_expires_at, review FROM catering_feedback WHERE link_token = $1`,
        [token],
      );

      if (result.rowCount === 0) {
        return { success: false, message: 'Rating link is invalid' };
      }

      const feedback = result.rows[0];

      // link_expires_at IS NULL means the link has been used
      if (feedback.link_expires_at === null) {
        return {
          success: false,
          message: 'Feedback has already been submitted',
        };
      }

      // Check if link has expired
      const expiresAt = new Date(feedback.link_expires_at);
      if (expiresAt < new Date()) {
        return { success: false, message: 'Rating link has expired' };
      }

      return {
        success: true,
        data: { scheduleId: feedback.schedule_id },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to validate rating link',
      };
    }
  }

  // ── Submit Rating ─────────────────────────────────────────────────────────

  async submitRating(token: string, dto: CreateFeedbackDto) {
    try {
      // Validate the token first
      const validation = await this.validateRatingLink(token);
      if (!validation.success) {
        return validation;
      }

      // Update the feedback row with the actual rating and review, mark as used
      await this.db.query(
        `UPDATE catering_feedback
         SET rating = $1, review = $2, link_expires_at = NULL
         WHERE link_token = $3`,
        [dto.rating, dto.comment || null, token],
      );

      return { success: true, message: 'Rating submitted successfully' };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to submit rating',
      };
    }
  }
}
