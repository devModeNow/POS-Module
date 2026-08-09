import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class PosStaffService {
  constructor(private readonly db: DatabaseService) {}

  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblpos_staff_presence (
        user_id    BIGINT NOT NULL,
        org_id     BIGINT NOT NULL,
        last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, org_id)
      )
    `);
  }

  async heartbeat(orgId: number, userId: number) {
    if (!orgId || !userId) return { success: false, message: 'Invalid session' };
    try {
      await this.ensureSchema();
      await this.db.query(
        `INSERT INTO tblpos_staff_presence (user_id, org_id, last_seen)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, org_id) DO UPDATE SET last_seen = NOW()`,
        [userId, orgId],
      );
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Heartbeat failed' };
    }
  }

  async listOnDuty(orgId: number, withinMinutes = 30) {
    try {
      await this.ensureSchema();
      const result = await this.db.query<{
        userId: number;
        username: string;
        fullname: string | null;
        roleName: string | null;
        lastSeen: string;
        profilePicture: string | null;
      }>(
        `SELECT p.user_id AS "userId",
                u.username,
                COALESCE(to_jsonb(u)->>'fullname', u.username) AS fullname,
                r."roleName" AS "roleName",
                p.last_seen AS "lastSeen",
                NULLIF(TRIM(COALESCE(
                  to_jsonb(u)->>'profile_picture',
                  to_jsonb(u)->>'profilePicture',
                  ''
                )), '') AS "profilePicture"
         FROM tblpos_staff_presence p
         INNER JOIN tblusers u ON u.id = p.user_id
         LEFT JOIN tblrbac r ON r.id = COALESCE(
           NULLIF(to_jsonb(u)->>'roleId', '')::bigint,
           NULLIF(to_jsonb(u)->>'role_id', '')::bigint
         )
         WHERE p.org_id = $1
           AND p.last_seen >= NOW() - ($2 || ' minutes')::interval
           AND LOWER(COALESCE(r."roleName", to_jsonb(r)->>'rolename', '')) LIKE '%cashier%'
         ORDER BY p.last_seen DESC`,
        [orgId, withinMinutes],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load staff' };
    }
  }

  /** All active cashiers in the org (for report filters). */
  async listCashiers(orgId: number) {
    if (!orgId) return { success: false, message: 'Organization context is required' };
    try {
      const result = await this.db.query<{
        userId: number;
        username: string;
        fullname: string;
        roleName: string | null;
      }>(
        `SELECT u.id AS "userId",
                u.username,
                COALESCE(to_jsonb(u)->>'fullname', u.username) AS fullname,
                COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName"
         FROM tblusers u
         LEFT JOIN tblrbac r ON r.id::text = COALESCE(
           to_jsonb(u)->>'roleId',
           to_jsonb(u)->>'roleid',
           to_jsonb(u)->>'role_id'
         )
         WHERE (
             u.org_id = $1
             OR NULLIF(to_jsonb(u)->>'org_id', '')::bigint = $1
             OR NULLIF(to_jsonb(u)->>'orgId', '')::bigint = $1
           )
           AND COALESCE(
                 NULLIF(LOWER(to_jsonb(u)->>'isActive'), ''),
                 NULLIF(LOWER(to_jsonb(u)->>'is_active'), ''),
                 'true'
               ) IN ('true', '1', 't', 'yes')
           AND LOWER(COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename', '')) LIKE '%cashier%'
         ORDER BY fullname ASC, u.username ASC`,
        [orgId],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load cashiers',
      };
    }
  }
}
