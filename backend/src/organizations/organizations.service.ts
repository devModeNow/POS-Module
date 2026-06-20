import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export type OrgRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  address: string | null;
  contact: string | null;
  email: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrgDto = {
  code: string;
  name: string;
  description?: string | null;
  address?: string | null;
  contact?: string | null;
  email?: string | null;
};

export type UpdateOrgDto = Partial<CreateOrgDto> & { isActive?: boolean };

@Injectable()
export class OrganizationsService {
  constructor(private readonly db: DatabaseService) {}

  async findAllPublic() {
    try {
      const result = await this.db.query<{ id: number; code: string; name: string; logoUrl: string | null }>(
        `SELECT id, code, name, logo_url AS "logoUrl"
         FROM tblorganizations
         WHERE is_active = true
         ORDER BY id ASC`,
      );
      return { success: true, data: result.rows };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to load organizations' };
    }
  }

  async getOrgSettings(orgId: number) {
    try {
      const result = await this.db.query<{
        id: string; orgId: string; businessName: string | null;
        businessAddress: string | null; businessContact: string | null;
        businessEmail: string | null; businessOwner: string | null;
        businessType: string | null; logoLight: string | null; logoDark: string | null;
        websiteTabName: string | null; routingTabName: string | null;
        printPaperSize: string | null;
      }>(
        `SELECT
           s.id::text, s.org_id::text AS "orgId",
           s.business_name AS "businessName", s.business_address AS "businessAddress",
           s.business_contact AS "businessContact", s.business_email AS "businessEmail",
           s.business_owner AS "businessOwner",
           COALESCE(to_jsonb(s)->>'business_type', NULL) AS "businessType",
           s.logo_light AS "logoLight", s.logo_dark AS "logoDark",
           s.website_tab_name AS "websiteTabName", s.routing_tab_name AS "routingTabName",
           s.print_paper_size AS "printPaperSize"
         FROM tblorg_settings s WHERE s.org_id = $1 LIMIT 1`,
        [orgId],
      );
      return { success: true, data: result.rows[0] ?? null };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to load org settings' };
    }
  }

  async updateOrgSettings(orgId: number, payload: {
    businessName?: string | null; businessAddress?: string | null;
    businessContact?: string | null; businessEmail?: string | null;
    businessOwner?: string | null; businessType?: string | null;
    logoLight?: string | null; logoDark?: string | null;
    websiteTabName?: string | null; routingTabName?: string | null;
    printPaperSize?: string | null;
  }) {
    try {
      await this.db.query(
        `INSERT INTO tblorg_settings (org_id) VALUES ($1) ON CONFLICT (org_id) DO NOTHING`,
        [orgId],
      );

      const fieldMap: Record<string, string> = {
        businessName: 'business_name', businessAddress: 'business_address',
        businessContact: 'business_contact', businessEmail: 'business_email',
        businessOwner: 'business_owner', logoLight: 'logo_light',
        logoDark: 'logo_dark', websiteTabName: 'website_tab_name',
        routingTabName: 'routing_tab_name', printPaperSize: 'print_paper_size',
      };

      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [key, col] of Object.entries(fieldMap)) {
        if ((payload as Record<string, unknown>)[key] === undefined) continue;
        values.push((payload as Record<string, unknown>)[key] ?? null);
        sets.push(`"${col}" = $${values.length}`);
      }

      if (sets.length > 0) {
        sets.push(`"updated_at" = NOW()`);
        values.push(orgId);
        await this.db.query(
          `UPDATE tblorg_settings SET ${sets.join(', ')} WHERE org_id = $${values.length}`,
          values,
        );
      }
      return this.getOrgSettings(orgId);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to update org settings' };
    }
  }

  async uploadOrgLogo(orgId: number, mode: 'light' | 'dark', file: any) {
    if (!file?.buffer || file.size <= 0) return { success: false, message: 'File is required' };
    if (!String(file.mimetype ?? '').toLowerCase().startsWith('image/'))
      return { success: false, message: 'Only image files are allowed' };
    const dataUrl = `data:${file.mimetype};base64,${(file.buffer as Buffer).toString('base64')}`;
    return this.updateOrgSettings(orgId, mode === 'light' ? { logoLight: dataUrl } : { logoDark: dataUrl });
  }

  async findAll() {
    try {
      const result = await this.db.query<OrgRow>(
        `SELECT
           id,
           code,
           name,
           description,
           address,
           contact,
           email,
           logo_url    AS "logoUrl",
           is_active   AS "isActive",
           created_at  AS "createdAt",
           updated_at  AS "updatedAt"
         FROM tblorganizations
         ORDER BY id ASC`,
      );
      return { success: true, data: result.rows };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to load organizations' };
    }
  }

  async findOne(id: number) {
    try {
      const result = await this.db.query<OrgRow>(
        `SELECT
           id, code, name, description, address, contact, email,
           logo_url AS "logoUrl", is_active AS "isActive",
           created_at AS "createdAt", updated_at AS "updatedAt"
         FROM tblorganizations WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (result.rowCount === 0) return { success: false, message: 'Organization not found' };
      return { success: true, data: result.rows[0] };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to load organization' };
    }
  }

  async create(dto: CreateOrgDto, createdBy?: number) {
    const code = String(dto.code ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    const name = String(dto.name ?? '').trim();

    if (!code) return { success: false, message: 'Organization code is required' };
    if (!name)  return { success: false, message: 'Organization name is required' };
    if (!/^[a-z0-9-]+$/.test(code)) return { success: false, message: 'Code may only contain lowercase letters, numbers, and hyphens' };

    try {
      const exists = await this.db.query<{ id: number }>(
        `SELECT id FROM tblorganizations WHERE code = $1 LIMIT 1`, [code],
      );
      if (exists.rowCount > 0) return { success: false, message: 'Organization code already exists' };

      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblorganizations (code, name, description, address, contact, email, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [code, name, dto.description ?? null, dto.address ?? null, dto.contact ?? null, dto.email ?? null, createdBy ?? null],
      );

      return { success: true, id: result.rows[0].id };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to create organization' };
    }
  }

  async update(id: number, dto: UpdateOrgDto) {
    if (!Number.isFinite(id) || id <= 0) return { success: false, message: 'Invalid organization id' };

    const sets: string[] = [];
    const values: unknown[] = [];

    const push = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`"${col}" = $${values.length}`);
    };

    if (dto.code !== undefined) {
      const code = String(dto.code).trim().toLowerCase().replace(/\s+/g, '-');
      if (!/^[a-z0-9-]+$/.test(code)) return { success: false, message: 'Code may only contain lowercase letters, numbers, and hyphens' };
      push('code', code);
    }
    if (dto.name        !== undefined) push('name',        String(dto.name).trim());
    if (dto.description !== undefined) push('description', dto.description ?? null);
    if (dto.address     !== undefined) push('address',     dto.address ?? null);
    if (dto.contact     !== undefined) push('contact',     dto.contact ?? null);
    if (dto.email       !== undefined) push('email',       dto.email ?? null);
    if (dto.isActive    !== undefined) push('is_active',   dto.isActive);

    if (sets.length === 0) return { success: false, message: 'No changes provided' };

    push('updated_at', 'NOW()');
    // fix: updated_at is a function call, not a param
    sets[sets.length - 1] = '"updated_at" = NOW()';
    values.pop();

    try {
      values.push(id);
      const result = await this.db.query<{ id: number }>(
        `UPDATE tblorganizations SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`,
        values,
      );
      if (result.rowCount === 0) return { success: false, message: 'Organization not found' };
      return this.findOne(id);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to update organization' };
    }
  }

  async toggleActive(id: number, isActive: boolean) {
    return this.update(id, { isActive });
  }

  async getMenus(orgId: number) {
    try {
      const result = await this.db.query<{
        id: number; menuKey: string; menuLabel: string; menuIcon: string | null; menuOrder: number; isActive: boolean;
      }>(
        `SELECT id, menu_key AS "menuKey", menu_label AS "menuLabel",
                menu_icon AS "menuIcon", menu_order AS "menuOrder", is_active AS "isActive"
         FROM tblorg_menus
         WHERE org_id = $1
         ORDER BY menu_order ASC`,
        [orgId],
      );
      return { success: true, data: result.rows };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to load org menus' };
    }
  }
}
