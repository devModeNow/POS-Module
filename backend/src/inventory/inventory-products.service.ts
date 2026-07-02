import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import sharp from 'sharp';

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const THUMB_SIZE = 400;

export type VariantUnitRow = {
  unitType: string;
  sellingPrice: number;
  salePrice: number | null;
  isManualEntry: boolean;
};

export type VariantRow = {
  id: number;
  productId: number;
  productName: string;
  category: string | null;
  brand: string | null;
  variantName: string;
  stockQty: number;
  stockWarning: number;
  costPrice: number;
  sellingPrice: number;
  salePrice: number | null;
  unitType: string | null;
  marginPercent: number | null;
  imageUrl: string | null;
  productImageUrl: string | null;
};

export type ProductRow = {
  id: number;
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  variantCount: number;
  minPrice: number;
  maxPrice: number;
  totalStock: number;
  hasSale: boolean;
};

@Injectable()
export class InventoryProductsService {
  constructor(private readonly db: DatabaseService) {}

  private formatSaveError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('idx_inv_products_org_name')) {
      return 'A product with this name already exists. Edit the existing product from the inventory list to add more variants.';
    }
    if (msg.includes('idx_inv_variants_product_name')) {
      return 'Each variant must have a unique name under the same product.';
    }
    if (msg.includes('idx_variant_units_variant_type')) {
      return 'Each unit type must be unique within a variant.';
    }
    if (msg.includes('numeric field overflow')) {
      return 'One of the price or margin values is too large. Check cost, selling, and sale prices.';
    }
    return msg || 'Failed to save product';
  }

  private toFiniteNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private computeMarginPercent(cost: number, selling: number): number | null {
    if (cost <= 0 || selling <= 0) return null;
    const margin = ((selling - cost) / cost) * 100;
    if (!Number.isFinite(margin)) return null;
    const clamped = Math.max(-99999999.99, Math.min(99999999.99, margin));
    return Math.round(clamped * 100) / 100;
  }

  private normalizeUnits(
    v: {
      unitType?: string;
      sellingPrice?: number;
      salePrice?: number | null;
      units?: Array<{
        unitType?: string;
        sellingPrice?: number;
        salePrice?: number | null;
        isManualEntry?: boolean;
      }>;
    },
  ): VariantUnitRow[] {
    const raw = v.units?.length
      ? v.units
      : [{
          unitType: v.unitType ?? 'piece',
          sellingPrice: v.sellingPrice ?? 0,
          salePrice: v.salePrice ?? null,
          isManualEntry: v.unitType === 'manual',
        }];
    return raw
      .map((u) => {
        const rawType = String(u.unitType ?? 'piece').trim();
        const unitType = rawType.toLowerCase() === 'manual' ? 'grams' : rawType;
        return {
          unitType,
          sellingPrice: Number(u.sellingPrice ?? 0),
          salePrice: u.salePrice != null ? Number(u.salePrice) : null,
          isManualEntry: Boolean(u.isManualEntry),
        };
      })
      .filter((u) => u.unitType.length > 0);
  }

  private async loadUnitsMap(variantIds: number[], activeOnly = true) {
    const map = new Map<number, VariantUnitRow[]>();
    if (!variantIds.length) return map;
    const activeClause = activeOnly ? 'AND is_active = TRUE' : '';
    const result = await this.db.query<{
      variantId: number;
      unitType: string;
      sellingPrice: string;
      salePrice: string | null;
      isManualEntry: boolean;
    }>(
      `SELECT variant_id AS "variantId", unit_type AS "unitType",
              selling_price AS "sellingPrice", sale_price AS "salePrice",
              is_manual_entry AS "isManualEntry"
       FROM tblinventory_variant_units
       WHERE variant_id = ANY($1::bigint[]) ${activeClause}
       ORDER BY sort_order ASC, unit_type ASC`,
      [variantIds],
    );
    for (const row of result.rows) {
      const list = map.get(row.variantId) ?? [];
      list.push({
        unitType: row.unitType,
        sellingPrice: Number(row.sellingPrice ?? 0),
        salePrice: row.salePrice != null ? Number(row.salePrice) : null,
        isManualEntry: row.isManualEntry,
      });
      map.set(row.variantId, list);
    }
    return map;
  }

  private attachUnits<T extends { id: number }>(rows: T[], unitsMap: Map<number, VariantUnitRow[]>) {
    return rows.map((row) => ({
      ...row,
      units: unitsMap.get(row.id) ?? [],
    }));
  }

  private async saveVariantUnits(
    client: { query: DatabaseService['query'] },
    orgId: number,
    variantId: number,
    units: VariantUnitRow[],
  ) {
    if (!units.length) {
      throw new Error('Each variant needs at least one unit type.');
    }
    const kept: string[] = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM tblinventory_variant_units
         WHERE variant_id = $1 AND lower(unit_type) = lower($2)
         LIMIT 1`,
        [variantId, u.unitType],
      );
      if (existing.rowCount) {
        await client.query(
          `UPDATE tblinventory_variant_units
           SET selling_price = $1, sale_price = $2, is_manual_entry = $3,
               sort_order = $4, is_active = TRUE, updated_at = NOW()
           WHERE id = $5`,
          [u.sellingPrice, u.salePrice, u.isManualEntry, i + 1, existing.rows[0].id],
        );
      } else {
        await client.query(
          `INSERT INTO tblinventory_variant_units
             (org_id, variant_id, unit_type, selling_price, sale_price, is_manual_entry, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [orgId, variantId, u.unitType, u.sellingPrice, u.salePrice, u.isManualEntry, i + 1],
        );
      }
      kept.push(u.unitType.toLowerCase());
    }
    await client.query(
      `UPDATE tblinventory_variant_units SET is_active = FALSE, updated_at = NOW()
       WHERE variant_id = $1 AND org_id = $2 AND lower(unit_type) != ALL($3::text[])`,
      [variantId, orgId, kept],
    );
  }

  private async processImage(file: Express.Multer.File): Promise<string> {
    if (!file?.buffer || file.size <= 0) throw new Error('Image file is required');
    if (!String(file.mimetype ?? '').startsWith('image/')) throw new Error('Only image files are allowed');
    if (file.size > MAX_IMAGE_SIZE) throw new Error('Image must be under 2MB');
    const resizedBuffer = await sharp(file.buffer)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
    return `data:image/webp;base64,${resizedBuffer.toString('base64')}`;
  }

  private validateVariantNames(
    variants: Array<{ variantName: string }>,
  ): string | null {
    const seen = new Set<string>();
    for (const v of variants) {
      const key = String(v.variantName ?? '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        return 'Each variant must have a unique name. Duplicate variant names are not allowed.';
      }
      seen.add(key);
    }
    return null;
  }

  async listProducts(orgId: number, search?: string, category?: string, deletedOnly = false) {
    try {
      const params: unknown[] = [orgId];
      let extra = '';
      const productActive = deletedOnly ? 'FALSE' : 'TRUE';
      const variantActive = deletedOnly ? 'FALSE' : 'TRUE';
      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        extra += ` AND (LOWER(p.name) LIKE LOWER($${idx}) OR LOWER(COALESCE(p.category,'')) LIKE LOWER($${idx}))`;
      }
      if (category?.trim()) {
        params.push(category.trim());
        extra += ` AND LOWER(TRIM(p.category)) = LOWER(TRIM($${params.length}))`;
      }

      const result = await this.db.query<{
        id: number;
        name: string;
        category: string | null;
        brand: string | null;
        description: string | null;
        imageUrl: string | null;
        variantCount: string;
        minPrice: string;
        maxPrice: string;
        totalStock: string;
        hasSale: boolean;
        isActive: boolean;
      }>(
        `SELECT p.id,
                p.name,
                p.category,
                p.brand,
                p.description,
                p.image_url AS "imageUrl",
                COUNT(v.id)::text AS "variantCount",
                COALESCE(MIN(v.selling_price), 0)::text AS "minPrice",
                COALESCE(MAX(v.selling_price), 0)::text AS "maxPrice",
                COALESCE(SUM(v.stock_qty), 0)::text AS "totalStock",
                BOOL_OR(v.sale_price IS NOT NULL AND v.sale_price > 0 AND v.sale_price < v.selling_price) AS "hasSale",
                p.is_active AS "isActive"
         FROM tblinventory_products p
         LEFT JOIN tblinventory_variants v ON v.product_id = p.id AND v.is_active = ${variantActive}
         WHERE p.org_id = $1 AND p.is_active = ${productActive} ${extra}
         GROUP BY p.id
         ORDER BY p.category ASC NULLS LAST, p.name ASC`,
        params,
      );

      return {
        success: true,
        data: result.rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          brand: r.brand,
          description: r.description,
          imageUrl: r.imageUrl,
          variantCount: Number(r.variantCount),
          minPrice: Number(r.minPrice),
          maxPrice: Number(r.maxPrice),
          totalStock: Number(r.totalStock),
          hasSale: r.hasSale,
          isActive: r.isActive,
        })),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load products' };
    }
  }

  async listVariantsByProduct(productId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT v.id,
                v.product_id AS "productId",
                p.name AS "productName",
                p.category,
                p.brand,
                v.variant_name AS "variantName",
                v.stock_qty AS "stockQty",
                v.stock_warning AS "stockWarning",
                v.cost_price AS "costPrice",
                v.selling_price AS "sellingPrice",
                v.sale_price AS "salePrice",
                v.unit_type AS "unitType",
                v.margin_percent AS "marginPercent",
                v.image_url AS "imageUrl",
                p.image_url AS "productImageUrl"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.product_id = $1 AND v.org_id = $2 AND v.is_active = TRUE AND p.is_active = TRUE
         ORDER BY v.sort_order ASC, v.variant_name ASC`,
        [productId, orgId],
      );
      const rows = result.rows.map((r: Record<string, unknown>) => ({
        ...r,
        costPrice: Number(r['costPrice'] ?? 0),
        sellingPrice: Number(r['sellingPrice'] ?? 0),
        salePrice: r['salePrice'] != null ? Number(r['salePrice']) : null,
        marginPercent: r['marginPercent'] != null ? Number(r['marginPercent']) : null,
        imageUrl: r['imageUrl'] ?? null,
      })) as Array<{ id: number } & Record<string, unknown>>;
      const unitsMap = await this.loadUnitsMap(rows.map((r) => r.id));
      return {
        success: true,
        data: this.attachUnits(rows, unitsMap),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load variants' };
    }
  }

  async listAllVariants(orgId: number, search?: string, category?: string, deletedOnly = false) {
    try {
      const params: unknown[] = [orgId];
      let extra = '';
      const variantActive = deletedOnly ? 'FALSE' : 'TRUE';
      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        extra += ` AND (LOWER(p.name) LIKE LOWER($${idx}) OR LOWER(v.variant_name) LIKE LOWER($${idx}) OR LOWER(COALESCE(p.category,'')) LIKE LOWER($${idx}))`;
      }
      if (category?.trim()) {
        params.push(category.trim());
        extra += ` AND LOWER(TRIM(p.category)) = LOWER(TRIM($${params.length}))`;
      }

      const result = await this.db.query(
        `SELECT v.id,
                v.product_id AS "productId",
                p.name AS "productName",
                p.category,
                p.brand,
                v.variant_name AS "variantName",
                v.stock_qty AS "stockQty",
                v.stock_warning AS "stockWarning",
                v.cost_price AS "costPrice",
                v.selling_price AS "sellingPrice",
                v.sale_price AS "salePrice",
                v.unit_type AS "unitType",
                v.margin_percent AS "marginPercent",
                v.image_url AS "imageUrl",
                p.image_url AS "productImageUrl",
                v.is_active AS "isActive"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.org_id = $1 AND v.is_active = ${variantActive} ${extra}
         ORDER BY p.category ASC NULLS LAST, p.name ASC, v.sort_order ASC`,
        params,
      );

      const rows = result.rows.map((r: Record<string, unknown>) => ({
        ...r,
        costPrice: Number(r['costPrice'] ?? 0),
        sellingPrice: Number(r['sellingPrice'] ?? 0),
        salePrice: r['salePrice'] != null ? Number(r['salePrice']) : null,
        marginPercent: r['marginPercent'] != null ? Number(r['marginPercent']) : null,
        imageUrl: r['imageUrl'] ?? r['productImageUrl'] ?? null,
      })) as Array<{ id: number } & Record<string, unknown>>;
      const unitsMap = await this.loadUnitsMap(rows.map((r) => r.id), !deletedOnly);

      return {
        success: true,
        data: this.attachUnits(rows, unitsMap),
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load variants' };
    }
  }

  async getProductWithVariants(productId: number, orgId: number) {
    try {
      const product = await this.db.query(
        `SELECT id, name, category, brand, description, image_url AS "imageUrl"
         FROM tblinventory_products WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [productId, orgId],
      );
      if (product.rowCount === 0) return { success: false, message: 'Product not found' };
      const variants = await this.listVariantsByProduct(productId, orgId);
      return { success: true, data: { ...product.rows[0], variants: variants.data ?? [] } };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load product' };
    }
  }

  async saveProduct(
    orgId: number,
    dto: {
      id?: number;
      name: string;
      category?: string;
      brand?: string;
      description?: string;
      variants: Array<{
        id?: number;
        variantName: string;
        stockQty?: number;
        stockWarning?: number;
        costPrice?: number;
        sellingPrice?: number;
        salePrice?: number | null;
        unitType?: string;
        marginPercent?: number | null;
        units?: Array<{
          unitType?: string;
          sellingPrice?: number;
          salePrice?: number | null;
          isManualEntry?: boolean;
        }>;
      }>;
    },
  ) {
    const name = String(dto.name ?? '').trim();
    if (!name) return { success: false, message: 'Product name is required' };
    if (!dto.variants?.length) return { success: false, message: 'At least one variant is required' };

    const variantNameError = this.validateVariantNames(dto.variants);
    if (variantNameError) return { success: false, message: variantNameError };

    try {
      let productId = dto.id;
      await this.db.withTransaction(async (client) => {
        if (productId) {
          const conflict = await client.query<{ id: number }>(
            `SELECT id FROM tblinventory_products
             WHERE org_id = $1 AND lower(name) = lower($2) AND id != $3 AND is_active = TRUE
             LIMIT 1`,
            [orgId, name, productId],
          );
          if (conflict.rowCount) {
            throw new Error(
              `A product named "${name}" already exists. Choose a different product name or edit the existing product.`,
            );
          }
          await client.query(
            `UPDATE tblinventory_products
             SET name = $1, category = $2, brand = $3, description = $4, updated_at = NOW()
             WHERE id = $5 AND org_id = $6`,
            [name, dto.category ?? null, dto.brand ?? null, dto.description ?? null, productId, orgId],
          );
        } else {
          const existing = await client.query<{ id: number }>(
            `SELECT id FROM tblinventory_products
             WHERE org_id = $1 AND lower(name) = lower($2) AND is_active = TRUE
             LIMIT 1`,
            [orgId, name],
          );
          if (existing.rowCount) {
            throw new Error(
              `A product named "${name}" already exists. Edit it from the inventory list to add more variants.`,
            );
          }

          const inactive = await client.query<{ id: number }>(
            `SELECT id FROM tblinventory_products
             WHERE org_id = $1 AND lower(name) = lower($2) AND is_active = FALSE
             LIMIT 1`,
            [orgId, name],
          );
          if (inactive.rowCount) {
            productId = inactive.rows[0].id;
            await client.query(
              `UPDATE tblinventory_products
               SET name = $1, category = $2, brand = $3, description = $4,
                   is_active = TRUE, updated_at = NOW()
               WHERE id = $5 AND org_id = $6`,
              [name, dto.category ?? null, dto.brand ?? null, dto.description ?? null, productId, orgId],
            );
          } else {
            const ins = await client.query<{ id: number }>(
              `INSERT INTO tblinventory_products (org_id, name, category, brand, description)
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [orgId, name, dto.category ?? null, dto.brand ?? null, dto.description ?? null],
            );
            productId = ins.rows[0].id;
          }
        }

        const keptIds: number[] = [];
        for (let i = 0; i < dto.variants.length; i++) {
          const v = dto.variants[i];
          const vName = String(v.variantName ?? '').trim();
          if (!vName) continue;
          const units = this.normalizeUnits(v);
          const primary = units[0];
          const stockQty = this.toFiniteNumber(v.stockQty, 0);
          const stockWarning = this.toFiniteNumber(v.stockWarning, 0);
          const costPrice = this.toFiniteNumber(v.costPrice, 0);
          const sellingPrice = this.toFiniteNumber(primary?.sellingPrice, 0);
          const salePrice = this.toOptionalNumber(primary?.salePrice);
          const marginPercent = this.computeMarginPercent(costPrice, sellingPrice);

          let variantId: number;
          if (v.id) {
            variantId = v.id;
            await client.query(
              `UPDATE tblinventory_variants
               SET variant_name = $1, stock_qty = $2, stock_warning = $3,
                   cost_price = $4, selling_price = $5, sale_price = $6,
                   unit_type = $7, margin_percent = $8, sort_order = $9, updated_at = NOW()
               WHERE id = $10 AND org_id = $11 AND product_id = $12`,
              [
                vName, stockQty, stockWarning,
                costPrice, sellingPrice, salePrice,
                primary?.unitType ?? null, marginPercent, i + 1,
                variantId, orgId, productId,
              ],
            );
            keptIds.push(variantId);
          } else {
            const ins = await client.query<{ id: number }>(
              `INSERT INTO tblinventory_variants
                 (org_id, product_id, variant_name, stock_qty, stock_warning,
                  cost_price, selling_price, sale_price, unit_type, margin_percent, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
              [
                orgId, productId, vName, stockQty, stockWarning,
                costPrice, sellingPrice, salePrice,
                primary?.unitType ?? null, marginPercent, i + 1,
              ],
            );
            variantId = ins.rows[0].id;
            keptIds.push(variantId);
          }
          await this.saveVariantUnits(client, orgId, variantId, units);
        }

        if (keptIds.length) {
          await client.query(
            `UPDATE tblinventory_variants SET is_active = FALSE, updated_at = NOW()
             WHERE product_id = $1 AND org_id = $2 AND id != ALL($3::bigint[])`,
            [productId, orgId, keptIds],
          );
        }
      });

      return { success: true, id: productId };
    } catch (e) {
      return { success: false, message: this.formatSaveError(e) };
    }
  }

  async deleteVariant(variantId: number, orgId: number) {
    try {
      await this.db.withTransaction(async (client) => {
        await client.query(
          `UPDATE tblinventory_variant_units SET is_active = FALSE, updated_at = NOW()
           WHERE variant_id = $1 AND org_id = $2`,
          [variantId, orgId],
        );
        const result = await client.query(
          `UPDATE tblinventory_variants SET is_active = FALSE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 RETURNING id`,
          [variantId, orgId],
        );
        if (result.rowCount === 0) {
          throw new Error('Variant not found');
        }
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to delete variant' };
    }
  }

  async deleteProduct(productId: number, orgId: number) {
    try {
      await this.db.withTransaction(async (client) => {
        await client.query(
          `UPDATE tblinventory_variant_units SET is_active = FALSE, updated_at = NOW()
           WHERE org_id = $2 AND variant_id IN (
             SELECT id FROM tblinventory_variants WHERE product_id = $1 AND org_id = $2
           )`,
          [productId, orgId],
        );
        await client.query(
          `UPDATE tblinventory_variants SET is_active = FALSE, updated_at = NOW()
           WHERE product_id = $1 AND org_id = $2`,
          [productId, orgId],
        );
        const result = await client.query(
          `UPDATE tblinventory_products SET is_active = FALSE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 RETURNING id`,
          [productId, orgId],
        );
        if (result.rowCount === 0) throw new Error('Product not found');
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to delete product' };
    }
  }

  async restoreProduct(productId: number, orgId: number) {
    try {
      await this.db.withTransaction(async (client) => {
        const product = await client.query<{ id: number }>(
          `UPDATE tblinventory_products SET is_active = TRUE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 AND is_active = FALSE
           RETURNING id`,
          [productId, orgId],
        );
        if (product.rowCount === 0) throw new Error('Deleted product not found');

        await client.query(
          `UPDATE tblinventory_variants SET is_active = TRUE, updated_at = NOW()
           WHERE product_id = $1 AND org_id = $2`,
          [productId, orgId],
        );
        await client.query(
          `UPDATE tblinventory_variant_units SET is_active = TRUE, updated_at = NOW()
           WHERE org_id = $2 AND variant_id IN (
             SELECT id FROM tblinventory_variants WHERE product_id = $1 AND org_id = $2
           )`,
          [productId, orgId],
        );
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to restore product' };
    }
  }

  async updateVariant(
    variantId: number,
    orgId: number,
    dto: {
      variantName: string;
      stockQty?: number;
      stockWarning?: number;
      costPrice?: number;
      sellingPrice?: number;
      salePrice?: number | null;
      unitType?: string;
      units?: Array<{
        unitType?: string;
        sellingPrice?: number;
        salePrice?: number | null;
        isManualEntry?: boolean;
      }>;
    },
  ) {
    const vName = String(dto.variantName ?? '').trim();
    if (!vName) return { success: false, message: 'Variant name is required' };

    try {
      await this.db.withTransaction(async (client) => {
        const existing = await client.query<{ productId: number }>(
          `SELECT product_id AS "productId"
           FROM tblinventory_variants
           WHERE id = $1 AND org_id = $2 AND is_active = TRUE
           LIMIT 1`,
          [variantId, orgId],
        );
        if (existing.rowCount === 0) throw new Error('Variant not found');

        const productId = existing.rows[0].productId;
        const duplicate = await client.query<{ id: number }>(
          `SELECT id FROM tblinventory_variants
           WHERE product_id = $1 AND org_id = $2 AND lower(variant_name) = lower($3)
             AND id != $4 AND is_active = TRUE
           LIMIT 1`,
          [productId, orgId, vName, variantId],
        );
        if (duplicate.rowCount) {
          throw new Error('Each variant must have a unique name under the same product.');
        }

        const units = this.normalizeUnits(dto);
        const primary = units[0];
        const stockQty = this.toFiniteNumber(dto.stockQty, 0);
        const stockWarning = this.toFiniteNumber(dto.stockWarning, 0);
        const costPrice = this.toFiniteNumber(dto.costPrice, 0);
        const sellingPrice = this.toFiniteNumber(primary?.sellingPrice ?? dto.sellingPrice, 0);
        const salePrice = this.toOptionalNumber(primary?.salePrice ?? dto.salePrice);
        const marginPercent = this.computeMarginPercent(costPrice, sellingPrice);

        await client.query(
          `UPDATE tblinventory_variants
           SET variant_name = $1, stock_qty = $2, stock_warning = $3,
               cost_price = $4, selling_price = $5, sale_price = $6,
               unit_type = $7, margin_percent = $8, updated_at = NOW()
           WHERE id = $9 AND org_id = $10`,
          [
            vName, stockQty, stockWarning,
            costPrice, sellingPrice, salePrice,
            primary?.unitType ?? null, marginPercent,
            variantId, orgId,
          ],
        );
        await this.saveVariantUnits(client, orgId, variantId, units);
      });
      return { success: true, id: variantId };
    } catch (e) {
      return { success: false, message: this.formatSaveError(e) };
    }
  }

  async restoreVariant(variantId: number, orgId: number) {
    try {
      await this.db.withTransaction(async (client) => {
        const variant = await client.query<{ productId: number }>(
          `UPDATE tblinventory_variants SET is_active = TRUE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 AND is_active = FALSE
           RETURNING product_id AS "productId"`,
          [variantId, orgId],
        );
        if (variant.rowCount === 0) throw new Error('Deleted variant not found');

        await client.query(
          `UPDATE tblinventory_variant_units SET is_active = TRUE, updated_at = NOW()
           WHERE variant_id = $1 AND org_id = $2`,
          [variantId, orgId],
        );
        await client.query(
          `UPDATE tblinventory_products SET is_active = TRUE, updated_at = NOW()
           WHERE id = $1 AND org_id = $2 AND is_active = FALSE`,
          [variant.rows[0].productId, orgId],
        );
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to restore variant' };
    }
  }

  async uploadProductImageFile(productId: number, orgId: number, file: Express.Multer.File) {
    try {
      if (!file?.buffer?.length) {
        return { success: false, message: 'Image file is required' };
      }
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM tblinventory_products WHERE id = $1 AND org_id = $2 AND is_active = TRUE`,
        [productId, orgId],
      );
      if (existing.rowCount === 0) return { success: false, message: 'Product not found' };
      const dataUrl = await this.processImage(file);
      await this.db.query(
        `UPDATE tblinventory_products SET image_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [dataUrl, productId, orgId],
      );
      return { success: true, data: { imageUrl: dataUrl } };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to upload image' };
    }
  }

  async removeProductImageFile(productId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `UPDATE tblinventory_products SET image_url = NULL, updated_at = NOW()
         WHERE id = $1 AND org_id = $2 RETURNING id`,
        [productId, orgId],
      );
      if (result.rowCount === 0) return { success: false, message: 'Product not found' };
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to remove image' };
    }
  }

  async uploadVariantImageFile(variantId: number, orgId: number, file: Express.Multer.File) {
    try {
      if (!file?.buffer?.length) {
        return { success: false, message: 'Image file is required' };
      }
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM tblinventory_variants WHERE id = $1 AND org_id = $2 AND is_active = TRUE`,
        [variantId, orgId],
      );
      if (existing.rowCount === 0) return { success: false, message: 'Variant not found' };
      const dataUrl = await this.processImage(file);
      await this.db.query(
        `UPDATE tblinventory_variants SET image_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [dataUrl, variantId, orgId],
      );
      return { success: true, data: { imageUrl: dataUrl } };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to upload image' };
    }
  }

  async removeVariantImageFile(variantId: number, orgId: number) {
    try {
      const result = await this.db.query(
        `UPDATE tblinventory_variants SET image_url = NULL, updated_at = NOW()
         WHERE id = $1 AND org_id = $2 RETURNING id`,
        [variantId, orgId],
      );
      if (result.rowCount === 0) return { success: false, message: 'Variant not found' };
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to remove image' };
    }
  }
}
