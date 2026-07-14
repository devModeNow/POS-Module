import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import sharp from 'sharp';

/** Minutes since last heartbeat / chat activity to count as online */
const ONLINE_WITHIN_MINUTES = 15;

const MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;
const MAX_ATTACHMENT_DIMENSION = 1600;

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

  private readonly profilePictureSql = `NULLIF(TRIM(COALESCE(
    to_jsonb(u)->>'profile_picture',
    to_jsonb(u)->>'profilePicture',
    ''
  )), '')`;

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
      ALTER TABLE public.tblpos_chat_messages
        ADD COLUMN IF NOT EXISTS attachment_url TEXT,
        ADD COLUMN IF NOT EXISTS attachment_type TEXT
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

  private async touchPresence(orgId: number, userId: number): Promise<void> {
    if (!orgId || !userId) return;
    await this.ensureSchema();
    await this.db.query(
      `INSERT INTO tblpos_staff_presence (user_id, org_id, last_seen)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, org_id) DO UPDATE SET last_seen = NOW()`,
      [userId, orgId],
    );
  }

  private async processAttachment(file: Express.Multer.File): Promise<{ url: string; type: string }> {
    if (!file?.buffer || file.size <= 0) throw new Error('Image file is required');
    if (!String(file.mimetype ?? '').startsWith('image/')) throw new Error('Only image files are allowed');
    if (file.size > MAX_ATTACHMENT_SIZE) throw new Error('Image must be under 8MB');
    const resizedBuffer = await sharp(file.buffer)
      .resize(MAX_ATTACHMENT_DIMENSION, MAX_ATTACHMENT_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    return { url: `data:image/webp;base64,${resizedBuffer.toString('base64')}`, type: 'image/webp' };
  }

  async listChatUsers(orgId: number, currentUserId: number) {
    if (!orgId) {
      return { success: false, message: 'Organization context is required' };
    }
    try {
      await this.ensureSchema();
      await this.touchPresence(orgId, currentUserId);
      const result = await this.db.query<{
        id: number;
        name: string;
        roleName: string | null;
        profilePicture: string | null;
        isOnline: boolean;
        lastSeen: string | null;
      }>(
        `SELECT u.id,
                ${this.userNameSql} AS name,
                COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
                ${this.profilePictureSql} AS "profilePicture",
                CASE
                  WHEN p.last_seen IS NOT NULL
                    AND p.last_seen >= NOW() - ($3 || ' minutes')::interval
                  THEN TRUE
                  ELSE FALSE
                END AS "isOnline",
                p.last_seen AS "lastSeen"
         FROM tblusers u
         ${this.roleJoinSql}
         LEFT JOIN (
           SELECT user_id, MAX(last_seen) AS last_seen
           FROM tblpos_staff_presence
           WHERE org_id = $1
           GROUP BY user_id
         ) p ON p.user_id = u.id
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
      await this.touchPresence(orgId, userId);

      if (mode === 'private') {
        const peer = Number(recipientId) || 0;
        if (!peer) return { success: false, message: 'Select a user for private chat' };
        const result = await this.db.query<{
          id: number;
          senderId: number;
          recipientId: number | null;
          senderName: string;
          roleName: string | null;
          senderProfilePicture: string | null;
          message: string;
          attachmentUrl: string | null;
          attachmentType: string | null;
          createdAt: string;
        }>(
          `SELECT m.id,
                  m.sender_id AS "senderId",
                  m.recipient_id AS "recipientId",
                  ${this.userNameSql} AS "senderName",
                  COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
                  ${this.profilePictureSql} AS "senderProfilePicture",
                  m.message,
                  m.attachment_url AS "attachmentUrl",
                  m.attachment_type AS "attachmentType",
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
        senderProfilePicture: string | null;
        message: string;
        attachmentUrl: string | null;
        attachmentType: string | null;
        createdAt: string;
      }>(
        `SELECT m.id,
                m.sender_id AS "senderId",
                m.recipient_id AS "recipientId",
                ${this.userNameSql} AS "senderName",
                COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
                ${this.profilePictureSql} AS "senderProfilePicture",
                m.message,
                m.attachment_url AS "attachmentUrl",
                m.attachment_type AS "attachmentType",
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

  private async getMessageById(orgId: number, messageId: number, _viewerId: number) {
    const result = await this.db.query<{
      id: number;
      senderId: number;
      recipientId: number | null;
      senderName: string;
      roleName: string | null;
      senderProfilePicture: string | null;
      message: string;
      attachmentUrl: string | null;
      attachmentType: string | null;
      createdAt: string;
    }>(
      `SELECT m.id,
              m.sender_id AS "senderId",
              m.recipient_id AS "recipientId",
              ${this.userNameSql} AS "senderName",
              COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
              ${this.profilePictureSql} AS "senderProfilePicture",
              m.message,
              m.attachment_url AS "attachmentUrl",
              m.attachment_type AS "attachmentType",
              m.created_at AS "createdAt"
       FROM tblpos_chat_messages m
       INNER JOIN tblusers u ON u.id = m.sender_id
       ${this.roleJoinSql}
       WHERE m.org_id = $1 AND m.id = $2`,
      [orgId, messageId],
    );
    return result.rows[0] ?? null;
  }

  async sendMessage(
    orgId: number,
    senderId: number,
    message: string,
    recipientId?: number | null,
    file?: Express.Multer.File,
  ) {
    const text = String(message ?? '').trim();
    if (!orgId || !senderId) {
      return { success: false, message: 'Invalid session — please sign in again' };
    }

    let attachmentUrl: string | null = null;
    let attachmentType: string | null = null;
    if (file) {
      try {
        const processed = await this.processAttachment(file);
        attachmentUrl = processed.url;
        attachmentType = processed.type;
      } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Failed to process image' };
      }
    }

    if (!text && !attachmentUrl) return { success: false, message: 'Message is required' };

    const peer = recipientId != null && recipientId > 0 ? recipientId : null;
    try {
      await this.ensureSchema();
      await this.touchPresence(orgId, senderId);
      const result = await this.db.query<{ id: number; createdAt: string }>(
        `INSERT INTO tblpos_chat_messages (org_id, sender_id, recipient_id, message, attachment_url, attachment_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at AS "createdAt"`,
        [orgId, senderId, peer, text, attachmentUrl, attachmentType],
      );
      const inserted = result.rows[0];
      const full = inserted ? await this.getMessageById(orgId, inserted.id, senderId) : null;
      return { success: true, data: full ?? inserted, recipientId: peer };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to send message' };
    }
  }
}
