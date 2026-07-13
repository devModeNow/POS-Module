import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

/** Minutes since last heartbeat to count as online */
const ONLINE_WITHIN_MINUTES = 5;

@Injectable()
export class PosChatService {
  constructor(private readonly db: DatabaseService) {}

  private schemaReady = false;

  private readonly userNameSql = `COALESCE(
    NULLIF(TRIM(COALESCE(
      to_jsonb(u)->>'fullname',
      to_jsonb(u)->>'fullName',
      to_jsonb(u)->>'full_name'
    )), ''),
    u.username
  )`;

  private readonly roleJoinSql = `LEFT JOIN tblrbac r ON r.id::text = COALESCE(
    to_jsonb(u)->>'roleId',
    to_jsonb(u)->>'roleid',
    to_jsonb(u)->>'role_id'
  )`;

  private readonly orgMatchSql = `(
    u.org_id = $1
    OR NULLIF(to_jsonb(u)->>'org_id', '')::bigint = $1
    OR NULLIF(to_jsonb(u)->>'orgId', '')::bigint = $1
  )`;

  private readonly activeUserSql = `
    COALESCE(LOWER(NULLIF(COALESCE(to_jsonb(u)->>'is_deleted', to_jsonb(u)->>'isDeleted'), '')), 'false')
      NOT IN ('true', '1', 't', 'yes')
    AND COALESCE(NULLIF(COALESCE(to_jsonb(u)->>'status', ''), ''), '1')::int != 0
  `;

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblpos_chat_messages (
        id            BIGSERIAL PRIMARY KEY,
        org_id        BIGINT NOT NULL,
        sender_id     BIGINT NOT NULL,
        recipient_id  BIGINT,
        message       TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pos_chat_org_created ON public.tblpos_chat_messages (org_id, created_at DESC);
    `);
    await this.db.query(`
      ALTER TABLE public.tblpos_chat_messages
        ADD COLUMN IF NOT EXISTS recipient_id BIGINT
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblpos_staff_presence (
        user_id    BIGINT NOT NULL,
        org_id     BIGINT NOT NULL,
        last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, org_id)
      )
    `);
    this.schemaReady = true;
  }

  async listChatUsers(orgId: number, currentUserId: number) {
    if (!orgId) {
      return { success: false, message: 'Organization context is required' };
    }
    try {
      await this.ensureSchema();
      const result = await this.db.query<{
        id: number;
        name: string;
        roleName: string | null;
        isOnline: boolean;
        lastSeen: string | null;
      }>(
        `SELECT u.id,
                ${this.userNameSql} AS name,
                COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
                CASE
                  WHEN p.last_seen IS NOT NULL
                    AND p.last_seen >= NOW() - ($3 || ' minutes')::interval
                  THEN TRUE
                  ELSE FALSE
                END AS "isOnline",
                p.last_seen AS "lastSeen"
         FROM tblusers u
         ${this.roleJoinSql}
         LEFT JOIN tblpos_staff_presence p
           ON p.user_id = u.id AND p.org_id = $1
         WHERE ${this.orgMatchSql}
           AND u.id <> $2
           AND ${this.activeUserSql}
         ORDER BY "isOnline" DESC, name ASC`,
        [orgId, currentUserId, ONLINE_WITHIN_MINUTES],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load chat users' };
    }
  }

  async listMessages(
    orgId: number,
    userId: number,
    sinceId = 0,
    mode: 'team' | 'private' = 'team',
    recipientId?: number,
    limit = 100,
  ) {
    if (!orgId || !userId) {
      return { success: false, message: 'Invalid session' };
    }
    try {
      await this.ensureSchema();

      if (mode === 'private') {
        const peer = Number(recipientId ?? 0);
        if (!peer) return { success: false, message: 'Recipient is required for private chat' };
        const result = await this.db.query<{
          id: number;
          senderId: number;
          recipientId: number | null;
          senderName: string;
          roleName: string | null;
          message: string;
          createdAt: string;
        }>(
          `SELECT m.id,
                  m.sender_id AS "senderId",
                  m.recipient_id AS "recipientId",
                  ${this.userNameSql} AS "senderName",
                  COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
                  m.message,
                  m.created_at AS "createdAt"
           FROM tblpos_chat_messages m
           INNER JOIN tblusers u ON u.id = m.sender_id
           ${this.roleJoinSql}
           WHERE m.org_id = $1
             AND m.id > $4
             AND (
               (m.sender_id = $2 AND m.recipient_id = $3)
               OR (m.sender_id = $3 AND m.recipient_id = $2)
             )
           ORDER BY m.id ASC
           LIMIT $5`,
          [orgId, userId, peer, sinceId, limit],
        );
        return { success: true, data: result.rows };
      }

      const result = await this.db.query<{
        id: number;
        senderId: number;
        recipientId: number | null;
        senderName: string;
        roleName: string | null;
        message: string;
        createdAt: string;
      }>(
        `SELECT m.id,
                m.sender_id AS "senderId",
                m.recipient_id AS "recipientId",
                ${this.userNameSql} AS "senderName",
                COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
                m.message,
                m.created_at AS "createdAt"
         FROM tblpos_chat_messages m
         INNER JOIN tblusers u ON u.id = m.sender_id
         ${this.roleJoinSql}
         WHERE m.org_id = $1
           AND m.id > $2
           AND m.recipient_id IS NULL
         ORDER BY m.id ASC
         LIMIT $3`,
        [orgId, sinceId, limit],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load chat messages' };
    }
  }

  async sendMessage(orgId: number, senderId: number, message: string, recipientId?: number | null) {
    const text = String(message ?? '').trim();
    if (!text) return { success: false, message: 'Message is required' };
    if (!orgId || !senderId) {
      return { success: false, message: 'Invalid session — please sign in again' };
    }
    const peer = recipientId != null && recipientId > 0 ? recipientId : null;
    try {
      await this.ensureSchema();
      const result = await this.db.query<{ id: number; createdAt: string }>(
        `INSERT INTO tblpos_chat_messages (org_id, sender_id, recipient_id, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at AS "createdAt"`,
        [orgId, senderId, peer, text],
      );
      return { success: true, data: result.rows[0], recipientId: peer };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to send message' };
    }
  }
}
