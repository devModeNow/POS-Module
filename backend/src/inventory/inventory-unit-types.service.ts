import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export type OrgUnitTypeRow = {
  id: number;
  code: string;
  label: string;
  isManualEntry: boolean;
  sortOrder: number;
  isActive: boolean;
};

@Injectable()
export class InventoryUnitTypesService implements OnModuleInit {
  private schemaReady = false;

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  /** Idempotent — creates tblorg_unit_types and seeds defaults for POS orgs. */
  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.tblorg_unit_types (
        id              BIGSERIAL PRIMARY KEY,
        org_id          BIGINT NOT NULL REFERENCES public.tblorganizations(id) ON DELETE CASCADE,
        code            TEXT NOT NULL,
        label           TEXT NOT NULL,
        is_manual_entry BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, code)
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_org_unit_types_org ON public.tblorg_unit_types(org_id)
    `);
    await this.db.query(`
      ALTER TABLE public.tblinventory_variant_units
        ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await this.db.query(`
      INSERT INTO public.tblorg_unit_types (org_id, code, label, is_manual_entry, sort_order)
      SELECT o.id, v.code, v.label, v.is_manual, v.ord
      FROM public.tblorganizations o
      CROSS JOIN (
        VALUES
          ('piece',  'Piece',  FALSE, 1),
          ('pack',   'Pack',   FALSE, 2),
          ('kilo',   'Kilo',   FALSE, 3),
          ('sack',   'Sack',   FALSE, 4),
          ('grams',  'Grams',  FALSE, 5),
          ('liter',  'Liter',  FALSE, 6),
          ('box',    'Box',    FALSE, 7),
          ('bottle', 'Bottle', FALSE, 8),
          ('can',    'Can',    FALSE, 9),
          ('tray',   'Tray',   FALSE, 10)
      ) AS v(code, label, is_manual, ord)
      WHERE o.code IN ('point-of-sales', 'pos')
      ON CONFLICT (org_id, code) DO NOTHING
    `);
    this.schemaReady = true;
  }

  async list(orgId: number, includeInactive = false) {
    try {
      await this.ensureSchema();
      const activeClause = includeInactive ? '' : 'AND is_active = TRUE';
      const result = await this.db.query<{
        id: number;
        code: string;
        label: string;
        isManualEntry: boolean;
        sortOrder: number;
        isActive: boolean;
      }>(
        `SELECT id, code, label,
                is_manual_entry AS "isManualEntry",
                sort_order AS "sortOrder",
                is_active AS "isActive"
         FROM tblorg_unit_types
         WHERE org_id = $1 ${activeClause}
         ORDER BY sort_order ASC, label ASC`,
        [orgId],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to load unit types',
      };
    }
  }

  async create(orgId: number, dto: { code: string; label: string; isManualEntry?: boolean; sortOrder?: number }) {
    const code = this.normalizeCode(dto.code);
    const label = String(dto.label ?? '').trim();
    if (!code || !label) {
      return { success: false, message: 'Code and label are required.' };
    }
    try {
      await this.ensureSchema();

      const existing = await this.db.query<{ id: number; isActive: boolean; label: string }>(
        `SELECT id, is_active AS "isActive", label
         FROM tblorg_unit_types
         WHERE org_id = $1 AND lower(code) = $2
         LIMIT 1`,
        [orgId, code],
      );

      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.isActive) {
          return {
            success: false,
            message: `Unit type "${row.label}" already exists. Use a different code or reactivate the existing entry from the list.`,
          };
        }
        await this.db.query(
          `UPDATE tblorg_unit_types
           SET is_active = TRUE, label = $1, is_manual_entry = $2, updated_at = NOW()
           WHERE org_id = $3 AND id = $4`,
          [label, Boolean(dto.isManualEntry), orgId, row.id],
        );
        return {
          success: true,
          id: row.id,
          reactivated: true,
          message: `Unit type "${label}" was reactivated.`,
        };
      }

      const labelConflict = await this.db.query<{ label: string; code: string }>(
        `SELECT label, code
         FROM tblorg_unit_types
         WHERE org_id = $1 AND is_active = TRUE AND lower(trim(label)) = lower(trim($2))
         LIMIT 1`,
        [orgId, label],
      );
      if (labelConflict.rowCount) {
        const conflict = labelConflict.rows[0];
        return {
          success: false,
          message: `A unit type with label "${conflict.label}" already exists (code: ${conflict.code}).`,
        };
      }

      const sortOrder = Number.isFinite(Number(dto.sortOrder)) ? Number(dto.sortOrder) : 0;
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblorg_unit_types (org_id, code, label, is_manual_entry, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [orgId, code, label, Boolean(dto.isManualEntry), sortOrder],
      );
      return { success: true, id: result.rows[0]?.id, message: 'Unit type added.' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create unit type';
      if (msg.includes('tblorg_unit_types_org_id_code_key') || msg.includes('unique')) {
        return { success: false, message: 'A unit type with this code already exists.' };
      }
      return { success: false, message: msg };
    }
  }

  async update(orgId: number, id: number, dto: Partial<{ label: string; isManualEntry: boolean; sortOrder: number; isActive: boolean }>) {
    try {
      const fields: string[] = [];
      const params: unknown[] = [orgId, id];
      if (dto.label != null) {
        params.push(String(dto.label).trim());
        fields.push(`label = $${params.length}`);
      }
      if (dto.isManualEntry != null) {
        params.push(Boolean(dto.isManualEntry));
        fields.push(`is_manual_entry = $${params.length}`);
      }
      if (dto.sortOrder != null) {
        params.push(Number(dto.sortOrder));
        fields.push(`sort_order = $${params.length}`);
      }
      if (dto.isActive != null) {
        params.push(Boolean(dto.isActive));
        fields.push(`is_active = $${params.length}`);
      }
      if (!fields.length) {
        return { success: false, message: 'No fields to update.' };
      }
      fields.push('updated_at = NOW()');
      const result = await this.db.query(
        `UPDATE tblorg_unit_types SET ${fields.join(', ')}
         WHERE org_id = $1 AND id = $2`,
        params,
      );
      if (!result.rowCount) {
        return { success: false, message: 'Unit type not found.' };
      }
      return { success: true };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to update unit type',
      };
    }
  }

  async deactivate(orgId: number, id: number) {
    return this.update(orgId, id, { isActive: false });
  }

  async activate(orgId: number, id: number) {
    try {
      await this.ensureSchema();
      const existing = await this.db.query<{ code: string; label: string; isActive: boolean }>(
        `SELECT code, label, is_active AS "isActive"
         FROM tblorg_unit_types WHERE org_id = $1 AND id = $2 LIMIT 1`,
        [orgId, id],
      );
      if (!existing.rowCount) {
        return { success: false, message: 'Unit type not found.' };
      }
      const row = existing.rows[0];
      if (row.isActive) {
        return { success: true, message: `"${row.label}" is already active.` };
      }
      const conflict = await this.db.query(
        `SELECT id FROM tblorg_unit_types
         WHERE org_id = $1 AND is_active = TRUE AND lower(code) = lower($2) AND id != $3
         LIMIT 1`,
        [orgId, row.code, id],
      );
      if (conflict.rowCount) {
        return {
          success: false,
          message: `Cannot reactivate — an active unit type with code "${row.code}" already exists.`,
        };
      }
      return this.update(orgId, id, { isActive: true });
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to reactivate unit type',
      };
    }
  }

  private normalizeCode(raw: string): string {
    return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  }
}
