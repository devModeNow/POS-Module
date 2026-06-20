import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import sharp from 'sharp';

const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB upload limit
const THUMB_SIZE = 200; // 200x200 pixels

@Injectable()
export class MenuService {
  constructor(private readonly db: DatabaseService) {}

  // ── Menu Items ────────────────────────────────────────────────────────────

  async createMenuItem(orgId: number, dto: { name: string; category: string }) {
    try {
      const result = await this.db.query<{
        id: number;
        org_id: number;
        name: string;
        category: string;
        image_url: string | null;
        created_at: string;
        updated_at: string | null;
      }>(
        `INSERT INTO catering_menu_items (org_id, name, category)
         VALUES ($1, $2, $3)
         RETURNING id, org_id, name, category, image_url, created_at, updated_at`,
        [orgId, dto.name, dto.category],
      );
      const row = result.rows[0];
      return {
        success: true,
        data: {
          id: row.id,
          orgId: row.org_id,
          name: row.name,
          category: row.category,
          imageUrl: row.image_url,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to create menu item',
      };
    }
  }

  async listMenuItems(orgId: number) {
    try {
      const result = await this.db.query<{
        id: number;
        org_id: number;
        name: string;
        category: string;
        image_url: string | null;
        created_at: string;
        updated_at: string | null;
      }>(
        `SELECT id, org_id, name, category, image_url, created_at, updated_at
         FROM catering_menu_items
         WHERE org_id = $1
         ORDER BY category ASC, name ASC`,
        [orgId],
      );

      // Group items by category
      const grouped: Record<string, Array<{
        id: number;
        orgId: number;
        name: string;
        category: string;
        imageUrl: string | null;
        createdAt: string;
        updatedAt: string | null;
      }>> = {};

      for (const row of result.rows) {
        if (!grouped[row.category]) {
          grouped[row.category] = [];
        }
        grouped[row.category].push({
          id: row.id,
          orgId: row.org_id,
          name: row.name,
          category: row.category,
          imageUrl: row.image_url,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }

      return { success: true, data: grouped };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to list menu items',
      };
    }
  }

  async updateMenuItem(
    id: number,
    orgId: number,
    dto: { name?: string; category?: string },
  ) {
    try {
      const sets: string[] = [];
      const params: unknown[] = [];

      if (dto.name !== undefined) {
        params.push(dto.name);
        sets.push(`name = $${params.length}`);
      }
      if (dto.category !== undefined) {
        params.push(dto.category);
        sets.push(`category = $${params.length}`);
      }

      if (sets.length === 0) {
        return { success: false, message: 'No fields to update' };
      }

      sets.push(`updated_at = NOW()`);
      params.push(id, orgId);

      const result = await this.db.query(
        `UPDATE catering_menu_items
         SET ${sets.join(', ')}
         WHERE id = $${params.length - 1} AND org_id = $${params.length}
         RETURNING id, org_id, name, category, created_at, updated_at`,
        params,
      );

      if (result.rowCount === 0) {
        return { success: false, message: 'Menu item not found' };
      }

      const row = result.rows[0] as any;
      return {
        success: true,
        data: {
          id: row.id,
          orgId: row.org_id,
          name: row.name,
          category: row.category,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to update menu item',
      };
    }
  }

  async deleteMenuItem(id: number, orgId: number) {
    try {
      // Check if item is referenced by any package belonging to this org
      const refCheck = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM catering_package_items pi
         INNER JOIN catering_packages p ON p.id = pi.package_id
         WHERE pi.menu_item_id = $1 AND p.org_id = $2`,
        [id, orgId],
      );

      if (Number(refCheck.rows[0].count) > 0) {
        return {
          success: false,
          message:
            'Menu item cannot be deleted while referenced by a package',
        };
      }

      const result = await this.db.query(
        `DELETE FROM catering_menu_items WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );

      if (result.rowCount === 0) {
        return { success: false, message: 'Menu item not found' };
      }

      return { success: true, message: 'Menu item deleted successfully' };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to delete menu item',
      };
    }
  }

  // ── Packages ──────────────────────────────────────────────────────────────

  async createPackage(
    orgId: number,
    dto: {
      name: string;
      pricePerHead: number;
      minPax: number;
      items: Array<{ menuItemId: number; selectionLimit: number }>;
    },
  ) {
    try {
      // Validate all menu item IDs exist and belong to this org
      const menuItemIds = dto.items.map((i) => Number(i.menuItemId));
      const numericOrgId = Number(orgId);
      const itemCheck = await this.db.query<{ id: number }>(
        `SELECT id FROM catering_menu_items
         WHERE id = ANY($1::bigint[]) AND org_id = $2`,
        [menuItemIds, numericOrgId],
      );

      const foundIds = new Set(itemCheck.rows.map((r) => Number(r.id)));
      const invalidIds = menuItemIds.filter((mid) => !foundIds.has(Number(mid)));
      if (invalidIds.length > 0) {
        return {
          success: false,
          message: `Invalid menu item IDs: ${invalidIds.join(', ')}. Items must exist and belong to your organization.`,
        };
      }

      let packageId: number | undefined;

      await this.db.withTransaction(async (client) => {
        // Insert the package
        const pkgResult = await client.query<{
          id: number;
          org_id: number;
          name: string;
          price_per_head: string;
          min_pax: number;
          created_at: string;
          updated_at: string | null;
        }>(
          `INSERT INTO catering_packages (org_id, name, price_per_head, min_pax)
           VALUES ($1, $2, $3, $4)
           RETURNING id, org_id, name, price_per_head, min_pax, created_at, updated_at`,
          [orgId, dto.name, dto.pricePerHead, dto.minPax],
        );
        packageId = pkgResult.rows[0].id;

        // Insert package items
        for (const item of dto.items) {
          await client.query(
            `INSERT INTO catering_package_items (package_id, menu_item_id, selection_limit)
             VALUES ($1, $2, $3)`,
            [packageId, item.menuItemId, item.selectionLimit],
          );
        }
      });

      // Fetch the created package with items
      const pkg = await this.getPackageById(packageId!, orgId);
      return { success: true, data: pkg };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to create package',
      };
    }
  }

  async listPackages(orgId: number) {
    try {
      const packages = await this.fetchPackagesForOrg(orgId);
      return { success: true, data: packages };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to list packages',
      };
    }
  }

  async listPackagesPublic(orgId: number) {
    try {
      const packages = await this.fetchPackagesForOrg(orgId);
      return { success: true, data: packages };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to list packages',
      };
    }
  }

  async updatePackage(
    id: number,
    orgId: number,
    dto: {
      name?: string;
      pricePerHead?: number;
      minPax?: number;
      items?: Array<{ menuItemId: number; selectionLimit: number }>;
    },
  ) {
    try {
      // Verify package exists and belongs to org
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM catering_packages WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      if (existing.rowCount === 0) {
        return { success: false, message: 'Package not found' };
      }

      // If items are provided, validate them
      if (dto.items && dto.items.length > 0) {
        const menuItemIds = dto.items.map((i) => Number(i.menuItemId));
        const numericOrgId = Number(orgId);
        const itemCheck = await this.db.query<{ id: number }>(
          `SELECT id FROM catering_menu_items
           WHERE id = ANY($1::bigint[]) AND org_id = $2`,
          [menuItemIds, numericOrgId],
        );
        const foundIds = new Set(itemCheck.rows.map((r) => Number(r.id)));
        const invalidIds = menuItemIds.filter((mid) => !foundIds.has(Number(mid)));
        if (invalidIds.length > 0) {
          return {
            success: false,
            message: `Invalid menu item IDs: ${invalidIds.join(', ')}. Items must exist and belong to your organization.`,
          };
        }
      }

      await this.db.withTransaction(async (client) => {
        // Update package fields
        const sets: string[] = [];
        const params: unknown[] = [];

        if (dto.name !== undefined) {
          params.push(dto.name);
          sets.push(`name = $${params.length}`);
        }
        if (dto.pricePerHead !== undefined) {
          params.push(dto.pricePerHead);
          sets.push(`price_per_head = $${params.length}`);
        }
        if (dto.minPax !== undefined) {
          params.push(dto.minPax);
          sets.push(`min_pax = $${params.length}`);
        }

        if (sets.length > 0) {
          sets.push(`updated_at = NOW()`);
          params.push(id, orgId);
          await client.query(
            `UPDATE catering_packages
             SET ${sets.join(', ')}
             WHERE id = $${params.length - 1} AND org_id = $${params.length}`,
            params,
          );
        }

        // Re-create package items if items array provided
        if (dto.items) {
          await client.query(
            `DELETE FROM catering_package_items WHERE package_id = $1`,
            [id],
          );
          for (const item of dto.items) {
            await client.query(
              `INSERT INTO catering_package_items (package_id, menu_item_id, selection_limit)
               VALUES ($1, $2, $3)`,
              [id, item.menuItemId, item.selectionLimit],
            );
          }
        }
      });

      const pkg = await this.getPackageById(id, orgId);
      return { success: true, data: pkg, message: 'Package updated successfully' };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to update package',
      };
    }
  }

  async deletePackage(id: number, orgId: number) {
    try {
      // Verify package exists and belongs to org
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM catering_packages WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      if (existing.rowCount === 0) {
        return { success: false, message: 'Package not found' };
      }

      // Check if package is referenced by active schedules (pending or in_progress)
      const scheduleCheck = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM catering_schedules
         WHERE package_id = $1 AND org_id = $2 AND status IN ('pending', 'in_progress')`,
        [id, orgId],
      );

      if (Number(scheduleCheck.rows[0].count) > 0) {
        return {
          success: false,
          message:
            'Package cannot be deleted while referenced by active schedules',
        };
      }

      await this.db.query(
        `DELETE FROM catering_packages WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );

      return { success: true, message: 'Package deleted successfully' };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to delete package',
      };
    }
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async fetchPackagesForOrg(orgId: number) {
    const pkgResult = await this.db.query<{
      id: number;
      org_id: number;
      name: string;
      price_per_head: string;
      min_pax: number;
      image_url: string | null;
      is_best_seller: boolean;
      promo_text: string | null;
      avg_rating: string | null;
      rating_count: string;
      created_at: string;
      updated_at: string | null;
    }>(
      `SELECT p.id, p.org_id, p.name, p.price_per_head, p.min_pax,
              p.image_url, p.is_best_seller, p.promo_text,
              p.created_at, p.updated_at,
              COALESCE(AVG(f.rating)::text, NULL) AS avg_rating,
              COUNT(f.id)::text AS rating_count
       FROM catering_packages p
       LEFT JOIN catering_schedules s ON s.package_id = p.id AND s.status = 'completed'
       LEFT JOIN catering_feedback f ON f.schedule_id = s.id
       WHERE p.org_id = $1
       GROUP BY p.id
       ORDER BY p.is_best_seller DESC, p.name ASC`,
      [orgId],
    );

    if (pkgResult.rows.length === 0) {
      return [];
    }

    const packageIds = pkgResult.rows.map((p) => p.id);

    // Fetch all package items with menu item details
    const itemsResult = await this.db.query<{
      package_id: number;
      menu_item_id: number;
      selection_limit: number;
      menu_item_name: string;
      category: string;
      image_url: string | null;
      is_top_pick: boolean;
    }>(
      `SELECT pi.package_id, pi.menu_item_id, pi.selection_limit,
              mi.name AS menu_item_name, mi.category, mi.image_url, mi.is_top_pick
       FROM catering_package_items pi
       INNER JOIN catering_menu_items mi ON mi.id = pi.menu_item_id
       WHERE pi.package_id = ANY($1)
       ORDER BY mi.category ASC, mi.name ASC`,
      [packageIds],
    );

    // Group items by package_id
    const itemsByPackage: Record<number, Array<{
      menuItemId: number;
      menuItemName: string;
      category: string;
      selectionLimit: number;
      imageUrl: string | null;
      isTopPick: boolean;
    }>> = {};

    for (const item of itemsResult.rows) {
      if (!itemsByPackage[item.package_id]) {
        itemsByPackage[item.package_id] = [];
      }
      itemsByPackage[item.package_id].push({
        menuItemId: item.menu_item_id,
        menuItemName: item.menu_item_name,
        category: item.category,
        selectionLimit: item.selection_limit,
        imageUrl: item.image_url,
        isTopPick: item.is_top_pick ?? false,
      });
    }

    return pkgResult.rows.map((pkg) => ({
      id: pkg.id,
      orgId: pkg.org_id,
      name: pkg.name,
      pricePerHead: Number(pkg.price_per_head),
      minPax: pkg.min_pax,
      imageUrl: pkg.image_url,
      isBestSeller: pkg.is_best_seller ?? false,
      promoText: pkg.promo_text,
      avgRating: pkg.avg_rating ? parseFloat(parseFloat(pkg.avg_rating).toFixed(1)) : null,
      ratingCount: parseInt(pkg.rating_count, 10),
      items: itemsByPackage[Number(pkg.id)] || [],
      createdAt: pkg.created_at,
      updatedAt: pkg.updated_at,
    }));
  }

  // ── Menu Item Image Upload ────────────────────────────────────────────────

  async uploadMenuItemImage(id: number, orgId: number, file: Express.Multer.File) {
    if (!file?.buffer || file.size <= 0) {
      return { success: false, message: 'Image file is required' };
    }

    if (!String(file.mimetype ?? '').startsWith('image/')) {
      return { success: false, message: 'Only image files are allowed' };
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return { success: false, message: 'Image must be under 2MB' };
    }

    try {
      // Verify item exists and belongs to org
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM catering_menu_items WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      if (existing.rowCount === 0) {
        return { success: false, message: 'Menu item not found' };
      }

      // Resize to 200x200 thumbnail and convert to WebP for smaller size
      const resizedBuffer = await sharp(file.buffer)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
        .webp({ quality: 75 })
        .toBuffer();

      const dataUrl = `data:image/webp;base64,${resizedBuffer.toString('base64')}`;

      await this.db.query(
        `UPDATE catering_menu_items SET image_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [dataUrl, id, orgId],
      );

      return { success: true, data: { imageUrl: dataUrl } };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to upload image',
      };
    }
  }

  async removeMenuItemImage(id: number, orgId: number) {
    try {
      const result = await this.db.query(
        `UPDATE catering_menu_items SET image_url = NULL, updated_at = NOW() WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      if (result.rowCount === 0) {
        return { success: false, message: 'Menu item not found' };
      }
      return { success: true, message: 'Image removed' };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to remove image',
      };
    }
  }

  async uploadPackageImage(id: number, orgId: number, file: Express.Multer.File) {
    if (!file?.buffer || file.size <= 0) {
      return { success: false, message: 'Image file is required' };
    }
    if (!String(file.mimetype ?? '').startsWith('image/')) {
      return { success: false, message: 'Only image files are allowed' };
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return { success: false, message: 'Image must be under 2MB' };
    }
    try {
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM catering_packages WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      if (existing.rowCount === 0) {
        return { success: false, message: 'Package not found' };
      }
      const resizedBuffer = await sharp(file.buffer)
        .resize(400, 300, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();
      const dataUrl = `data:image/webp;base64,${resizedBuffer.toString('base64')}`;
      await this.db.query(
        `UPDATE catering_packages SET image_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [dataUrl, id, orgId],
      );
      return { success: true, data: { imageUrl: dataUrl } };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to upload image',
      };
    }
  }

  private async getPackageById(id: number, orgId: number) {
    const pkgResult = await this.db.query<{
      id: number;
      org_id: number;
      name: string;
      price_per_head: string;
      min_pax: number;
      created_at: string;
      updated_at: string | null;
    }>(
      `SELECT id, org_id, name, price_per_head, min_pax, created_at, updated_at
       FROM catering_packages
       WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );

    if (pkgResult.rowCount === 0) return null;

    const pkg = pkgResult.rows[0];

    const itemsResult = await this.db.query<{
      menu_item_id: number;
      selection_limit: number;
      menu_item_name: string;
      category: string;
    }>(
      `SELECT pi.menu_item_id, pi.selection_limit,
              mi.name AS menu_item_name, mi.category
       FROM catering_package_items pi
       INNER JOIN catering_menu_items mi ON mi.id = pi.menu_item_id
       WHERE pi.package_id = $1
       ORDER BY mi.category ASC, mi.name ASC`,
      [id],
    );

    return {
      id: pkg.id,
      orgId: pkg.org_id,
      name: pkg.name,
      pricePerHead: Number(pkg.price_per_head),
      minPax: pkg.min_pax,
      items: itemsResult.rows.map((item) => ({
        menuItemId: item.menu_item_id,
        menuItemName: item.menu_item_name,
        category: item.category,
        selectionLimit: item.selection_limit,
      })),
      createdAt: pkg.created_at,
      updatedAt: pkg.updated_at,
    };
  }
}
