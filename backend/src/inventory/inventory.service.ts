import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { PaginatedQueryDto } from './dto/paginated-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import sharp from 'sharp';

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const THUMB_SIZE = 400;

@Injectable()
export class InventoryService {
  private poSchemaReady = false;

  constructor(private readonly db: DatabaseService) {}

  // ── Parts ────────────────────────────────────────────────────────────────

  async findAll(orgId: number, query: PaginatedQueryDto) {
    try {
      const { page, pageSize, search, status, deliveryDateFrom, deliveryDateTo, category } = query;
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['i.org_id = $1'];
      const params: unknown[] = [orgId];

      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        conditions.push(
          `(LOWER(i.part_name) LIKE LOWER($${idx}) OR LOWER(i.brand) LIKE LOWER($${idx}) OR LOWER(i.category) LIKE LOWER($${idx}))`,
        );
      }

      if (deliveryDateFrom) {
        params.push(deliveryDateFrom);
        conditions.push(
          `EXISTS (SELECT 1 FROM tblpo_items poi JOIN tblpurchases po ON po.id = poi.purchase_id WHERE poi.inventory_id = i.id AND po.order_date >= $${params.length})`,
        );
      }

      if (deliveryDateTo) {
        params.push(deliveryDateTo);
        conditions.push(
          `EXISTS (SELECT 1 FROM tblpo_items poi JOIN tblpurchases po ON po.id = poi.purchase_id WHERE poi.inventory_id = i.id AND po.order_date <= $${params.length})`,
        );
      }

      // Stock status filter applied as a direct condition on stock_qty vs stock_warning
      if (status === 'Good') {
        conditions.push('i.stock_qty > i.stock_warning');
      } else if (status === 'Warning') {
        conditions.push('i.stock_qty = i.stock_warning');
      } else if (status === 'Bad') {
        conditions.push('i.stock_qty < i.stock_warning');
      }

      if (category?.trim()) {
        params.push(category.trim());
        conditions.push(`LOWER(TRIM(i.category)) = LOWER(TRIM($${params.length}))`);
      }

      const whereClause = conditions.join(' AND ');

      params.push(pageSize);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const sql = `
        SELECT
          i.id,
          i.part_name AS "partName",
          i.category,
          i.brand,
          i.description,
          i.stock_qty AS "stockQty",
          i.stock_warning AS "stockWarning",
          i.cost_price AS "costPrice",
          i.selling_price AS "sellingPrice",
          i.sale_price AS "salePrice",
          i.max_discount_price AS "maxDiscountPrice",
          i.image_url AS "imageUrl",
          i.unit_type AS "unitType",
          i.margin_percent AS "marginPercent",
          i.updated_at AS "updatedAt",
          COALESCE(st.purchased_qty, 0)::int AS "purchasedQuantity",
          COALESCE(st.month_sales, 0)::numeric AS "monthSales",
          CASE
            WHEN i.stock_qty > i.stock_warning THEN 'Good'
            WHEN i.stock_qty = i.stock_warning THEN 'Warning'
            ELSE 'Bad'
          END AS "stockStatus",
          COUNT(*) OVER() AS "totalCount"
        FROM tblinventory i
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(s.quantity_sold), 0) AS purchased_qty,
            COALESCE(SUM(s.total_amount), 0) AS month_sales
          FROM tblsales_transactions s
          WHERE s.inventory_id = i.id
            AND s.sale_date >= DATE_TRUNC('month', CURRENT_DATE)
            AND s.sale_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
        ) st ON true
        WHERE ${whereClause}
        ORDER BY i.part_name ASC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const result = await this.db.query(sql, params);

      const totalCount = result.rows.length > 0 ? Number((result.rows[0] as Record<string, unknown>)['totalCount']) : 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      // Strip totalCount from each row
      const data = result.rows.map((row: Record<string, unknown>) => {
        const { totalCount: _tc, ...rest } = row;
        return rest;
      });

      // Calculate page totals from the current page results
      const totals = data.reduce(
        (acc, row: Record<string, unknown>) => {
          acc.quantity += Number(row['stockQty'] ?? 0);
          acc.cost += Number(row['costPrice'] ?? 0);
          acc.srp += Number(row['sellingPrice'] ?? 0);
          acc.purchasedQuantity += Number(row['purchasedQuantity'] ?? 0);
          acc.monthSales += Number(row['monthSales'] ?? 0);
          return acc;
        },
        { quantity: 0, cost: 0, srp: 0, purchasedQuantity: 0, monthSales: 0 },
      );

      return {
        success: true,
        data,
        pagination: {
          totalCount,
          currentPage: page,
          pageSize,
          totalPages,
        },
        totals,
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load inventory' };
    }
  }

  async findOne(id: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT id, part_name AS "partName", category, brand, description,
                stock_qty AS "stockQty", stock_warning AS "stockWarning",
                cost_price AS "costPrice", selling_price AS "sellingPrice",
                sale_price AS "salePrice",
                max_discount_price AS "maxDiscountPrice", image_url AS "imageUrl",
                unit_type AS "unitType", margin_percent AS "marginPercent",
                updated_at AS "updatedAt"
         FROM tblinventory WHERE id = $1 AND org_id = $2 LIMIT 1`, [id, orgId]);
      if (result.rowCount === 0) return { success: false, message: 'Item not found' };
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load item' };
    }
  }

  async create(orgId: number, dto: CreateProductDto) {
    const name = String(dto.partName ?? '').trim();
    if (!name) return { success: false, message: 'Part name is required' };
    try {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO tblinventory
           (org_id, part_name, category, brand, description, stock_qty, stock_warning,
            cost_price, selling_price, sale_price, max_discount_price, margin_percent, unit_type, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) RETURNING id`,
        [orgId, name, dto.category ?? null, dto.brand ?? null, dto.description ?? null,
         dto.stockQty ?? 0, dto.stockWarning ?? 0, dto.costPrice ?? 0,
         dto.sellingPrice ?? 0, dto.salePrice ?? null, dto.maxDiscountPrice ?? null,
         (dto as any).marginPercent ?? null, dto.unitType ?? null]);
      return { success: true, id: result.rows[0].id };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create item' };
    }
  }

  async bulkImport(orgId: number, items: Array<{ partName: string; brand?: string; category?: string; description?: string; stockQty?: number; stockWarning?: number; costPrice?: number; sellingPrice?: number; marginPercent?: number }>) {
    if (!items || items.length === 0) return { success: false, message: 'No items provided' };
    if (items.length > 500) return { success: false, message: 'Maximum 500 items per import' };

    let imported = 0;
    let updated = 0;
    const errors: string[] = [];

    try {
      await this.db.withTransaction(async (client) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const name = String(item.partName ?? '').trim();
          if (!name) { errors.push(`Row ${i + 1}: Part name is required`); continue; }

          // Check if item already exists by part_name (case-insensitive)
          const existing = await client.query<{ id: number }>(
            `SELECT id FROM tblinventory WHERE org_id = $1 AND LOWER(TRIM(part_name)) = LOWER($2) LIMIT 1`,
            [orgId, name],
          );

          if (existing.rowCount > 0) {
            // Update existing item
            await client.query(
              `UPDATE tblinventory SET
                brand = COALESCE(NULLIF($1, ''), brand),
                category = COALESCE(NULLIF($2, ''), category),
                description = COALESCE(NULLIF($3, ''), description),
                stock_qty = CASE WHEN $4::int > 0 THEN $4 ELSE stock_qty END,
                stock_warning = CASE WHEN $5::int > 0 THEN $5 ELSE stock_warning END,
                cost_price = CASE WHEN $6::numeric > 0 THEN $6 ELSE cost_price END,
                selling_price = CASE WHEN $7::numeric > 0 THEN $7 ELSE selling_price END,
                margin_percent = COALESCE($8, margin_percent),
                updated_at = NOW()
               WHERE id = $9`,
              [item.brand ?? '', item.category ?? '', item.description ?? '',
               item.stockQty ?? 0, item.stockWarning ?? 0, item.costPrice ?? 0,
               item.sellingPrice ?? 0, item.marginPercent ?? null, existing.rows[0].id]);
            updated++;
          } else {
            // Insert new item
            await client.query(
              `INSERT INTO tblinventory
                 (org_id, part_name, category, brand, description, stock_qty, stock_warning,
                  cost_price, selling_price, margin_percent, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
              [orgId, name, item.category ?? null, item.brand ?? null, item.description ?? null,
               item.stockQty ?? 0, item.stockWarning ?? 0, item.costPrice ?? 0,
               item.sellingPrice ?? 0, item.marginPercent ?? null]);
            imported++;
          }
        }
      });

      return { success: true, imported, updated, errors: errors.length > 0 ? errors : undefined };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to import items', imported, updated, errors };
    }
  }

  async update(id: number, orgId: number, dto: Record<string, unknown>) {
    try {
      const fieldMap: Record<string, string> = {
        partName: 'part_name', category: 'category', brand: 'brand',
        description: 'description', stockQty: 'stock_qty', stockWarning: 'stock_warning',
        costPrice: 'cost_price', sellingPrice: 'selling_price', salePrice: 'sale_price',
        maxDiscountPrice: 'max_discount_price', marginPercent: 'margin_percent',
        unitType: 'unit_type',
      };
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [key, col] of Object.entries(fieldMap)) {
        if (dto[key] === undefined) continue;
        vals.push(dto[key]);
        sets.push(`${col} = $${vals.length}`);
      }
      if (sets.length === 0) return { success: false, message: 'No changes provided' };
      sets.push('updated_at = NOW()');
      vals.push(id, orgId);
      await this.db.query(
        `UPDATE tblinventory SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND org_id = $${vals.length}`, vals);
      return this.findOne(id, orgId);
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update item' };
    }
  }

  async adjustStock(id: number, orgId: number, qty: number, notes?: string, userId?: number, userName?: string) {
    try {
      // Get current stock before adjustment
      const current = await this.db.query<{ stock_qty: number }>(
        `SELECT stock_qty FROM tblinventory WHERE id = $1 AND org_id = $2 LIMIT 1`, [id, orgId]);
      if (current.rowCount === 0) return { success: false, message: 'Item not found' };

      const qtyBefore = Number(current.rows[0].stock_qty);
      const qtyAfter = Math.max(qtyBefore + qty, 0);

      // Update stock
      await this.db.query(
        `UPDATE tblinventory SET stock_qty = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [qtyAfter, id, orgId]);

      // Record adjustment history
      await this.db.query(
        `INSERT INTO tblinventory_adjustments
           (org_id, inventory_id, adjustment_type, qty_before, qty_after, qty_change, notes, created_by, created_by_name)
         VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7, $8)`,
        [orgId, id, qtyBefore, qtyAfter, qty, notes ?? null, userId ?? null, userName ?? null]);

      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to adjust stock' };
    }
  }

  async getStockHistory(id: number, orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT id, adjustment_type AS "adjustmentType", qty_before AS "qtyBefore",
                qty_after AS "qtyAfter", qty_change AS "qtyChange",
                reference_type AS "referenceType", reference_id AS "referenceId",
                notes, created_by_name AS "createdByName", created_at AS "createdAt"
         FROM tblinventory_adjustments
         WHERE inventory_id = $1 AND org_id = $2
         ORDER BY created_at DESC LIMIT 50`,
        [id, orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load history' };
    }
  }

  async search(q: string, orgId: number) {
    try {
      const term = `%${q.trim()}%`;

      const legacyResult = await this.db.query(
        `SELECT id, part_name AS "partName", brand, category,
                stock_qty AS "stockQty", cost_price AS "costPrice",
                selling_price AS "sellingPrice", image_url AS "imageUrl"
         FROM tblinventory
         WHERE org_id = $1
           AND (LOWER(part_name) LIKE LOWER($2) OR LOWER(brand) LIKE LOWER($2))
         ORDER BY part_name ASC LIMIT 15`,
        [orgId, term]);

      const posResult = await this.db.query(
        `SELECT v.id AS "variantId", v.product_id AS "productId",
                p.name AS "productName", v.variant_name AS "variantName",
                p.brand, p.category,
                v.stock_qty AS "stockQty", v.cost_price AS "costPrice",
                v.selling_price AS "sellingPrice",
                COALESCE(v.image_url, p.image_url) AS "imageUrl"
         FROM tblinventory_variants v
         INNER JOIN tblinventory_products p ON p.id = v.product_id
         WHERE v.org_id = $1 AND v.is_active = TRUE AND p.is_active = TRUE
           AND (LOWER(p.name) LIKE LOWER($2) OR LOWER(v.variant_name) LIKE LOWER($2) OR LOWER(COALESCE(p.brand,'')) LIKE LOWER($2))
         ORDER BY p.name ASC, v.sort_order ASC LIMIT 15`,
        [orgId, term]);

      const legacyData = legacyResult.rows.map((row: Record<string, unknown>) => ({
        id: row['id'],
        partName: row['partName'],
        brand: row['brand'] ?? null,
        category: row['category'] ?? null,
        stockQty: Number(row['stockQty'] ?? 0),
        costPrice: Number(row['costPrice'] ?? 0),
        sellingPrice: Number(row['sellingPrice'] ?? 0),
        imageUrl: row['imageUrl'] ?? null,
        existsInInventory: true,
        variantId: null,
        productId: null,
        source: 'legacy' as const,
      }));

      const posData = posResult.rows.map((row: Record<string, unknown>) => {
        const productName = String(row['productName'] ?? '');
        const variantName = String(row['variantName'] ?? '').trim();
        const partName = variantName && variantName.toLowerCase() !== 'default'
          ? `${productName} — ${variantName}`
          : productName;
        return {
          id: 0,
          partName,
          brand: row['brand'] ?? null,
          category: row['category'] ?? null,
          stockQty: Number(row['stockQty'] ?? 0),
          costPrice: Number(row['costPrice'] ?? 0),
          sellingPrice: Number(row['sellingPrice'] ?? 0),
          imageUrl: row['imageUrl'] ?? null,
          existsInInventory: true,
          variantId: Number(row['variantId']),
          productId: Number(row['productId']),
          source: 'pos' as const,
        };
      });

      return { success: true, data: [...legacyData, ...posData].slice(0, 20) };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Search failed' };
    }
  }

  async getLowStock(orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT id, part_name AS "partName", category, brand,
                stock_qty AS "stockQty", stock_warning AS "stockWarning",
                selling_price AS "sellingPrice"
         FROM tblinventory
         WHERE org_id = $1 AND stock_qty <= stock_warning
         ORDER BY stock_qty ASC`, [orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load low stock' };
    }
  }

  // ── Purchase Orders ───────────────────────────────────────────────────────

  private async ensurePoSchema(): Promise<void> {
    if (this.poSchemaReady) return;
    await this.db.query(`ALTER TABLE tblpo_items ADD COLUMN IF NOT EXISTS variant_id BIGINT`);
    // Drop ALL status CHECKs first — updating to 'draft' while a legacy check is active fails.
    await this.db.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'public.tblpurchases'::regclass
            AND c.contype = 'c'
            AND a.attname = 'status'
        LOOP
          EXECUTE format('ALTER TABLE public.tblpurchases DROP CONSTRAINT IF EXISTS %I', r.conname);
        END LOOP;
      END $$
    `);
    await this.db.query(`
      UPDATE public.tblpurchases
      SET status = CASE lower(trim(COALESCE(status, '')))
        WHEN 'pending' THEN 'draft'
        WHEN 'completed' THEN 'received'
        WHEN 'complete' THEN 'received'
        WHEN 'canceled' THEN 'cancelled'
        WHEN 'draft' THEN 'draft'
        WHEN 'ordered' THEN 'ordered'
        WHEN 'received' THEN 'received'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'draft'
      END
      WHERE status IS NULL
         OR lower(trim(status)) NOT IN ('draft', 'ordered', 'received', 'cancelled')
    `);
    await this.db.query(`
      DO $$
      BEGIN
        ALTER TABLE public.tblpurchases
          ADD CONSTRAINT tblpurchases_status_check
          CHECK (status IN ('draft', 'ordered', 'received', 'cancelled'));
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await this.db.query(`ALTER TABLE public.tblpurchases ALTER COLUMN status SET DEFAULT 'draft'`);
    this.poSchemaReady = true;
  }

  /**
   * Creates a new product record for a PO line item that has neither an inventoryId
   * nor a variantId. If the org already manages POS products/variants, the new
   * product is created there so it becomes sellable at the register; otherwise it
   * falls back to the legacy tblinventory table.
   */
  private async createNewPoProduct(
    client: { query: DatabaseService['query'] },
    orgId: number,
    item: { itemName: string; brand?: string; category?: string; unitCost: number },
  ): Promise<{ inventoryId: number | null; variantId: number | null }> {
    const posCheck = await client.query<{ id: number }>(
      `SELECT id FROM tblinventory_products WHERE org_id = $1 AND is_active = TRUE LIMIT 1`,
      [orgId],
    );

    if (posCheck.rowCount > 0) {
      const product = await client.query<{ id: number }>(
        `INSERT INTO tblinventory_products (org_id, name, category, brand)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [orgId, item.itemName, item.category ?? null, item.brand ?? null],
      );
      const variant = await client.query<{ id: number }>(
        `INSERT INTO tblinventory_variants
           (org_id, product_id, variant_name, stock_qty, stock_warning, cost_price, selling_price)
         VALUES ($1,$2,'Default',0,0,$3,0) RETURNING id`,
        [orgId, product.rows[0].id, item.unitCost],
      );
      return { inventoryId: null, variantId: variant.rows[0].id };
    }

    const newProduct = await client.query<{ id: number }>(
      `INSERT INTO tblinventory
         (org_id, part_name, brand, category, stock_qty, stock_warning, cost_price, selling_price, updated_at)
       VALUES ($1,$2,$3,$4,0,0,$5,0,NOW()) RETURNING id`,
      [orgId, item.itemName, item.brand ?? null, item.category ?? null, item.unitCost],
    );
    return { inventoryId: newProduct.rows[0].id, variantId: null };
  }

  async findAllPO(orgId: number, status?: string) {
    try {
      const where = status ? 'AND p.status = $2' : '';
      const params: unknown[] = status ? [orgId, status] : [orgId];
      const result = await this.db.query(
        `SELECT p.id, p.po_number AS "poNumber",
                s.name AS "supplierName",
                p.order_date AS "orderDate",
                p.status,
                COALESCE(agg.total_quantity, 0)::int AS "totalQuantity",
                COALESCE(agg.total_cost, 0)::numeric AS "totalCost",
                p.created_at AS "createdAt",
                agg.product_names AS "productNames",
                agg.item_count AS "itemCount"
         FROM tblpurchases p
         LEFT JOIN tblsuppliers s ON s.id = p.supplier_id
         LEFT JOIN LATERAL (
           SELECT
             COALESCE(SUM(pi.quantity), 0) AS total_quantity,
             COALESCE(SUM(pi.total_cost), 0) AS total_cost,
             COUNT(pi.id)::int AS item_count,
             ARRAY(
               SELECT sub.item_name
               FROM tblpo_items sub
               WHERE sub.purchase_id = p.id
               ORDER BY sub.id ASC
               LIMIT 3
             ) AS product_names
           FROM tblpo_items pi
           WHERE pi.purchase_id = p.id
         ) agg ON true
         WHERE p.org_id = $1 ${where}
         ORDER BY p.created_at DESC`, params);

      const data = result.rows.map((row: Record<string, unknown>) => {
        const itemCount = Number(row['itemCount'] ?? 0);
        const productNames: string[] = (row['productNames'] as string[]) ?? [];
        return {
          id: row['id'],
          poNumber: row['poNumber'],
          supplierName: row['supplierName'],
          orderDate: row['orderDate'],
          status: row['status'],
          totalQuantity: Number(row['totalQuantity']),
          totalCost: Number(row['totalCost']),
          createdAt: row['createdAt'],
          itemCount,
          productNames: productNames.slice(0, 3),
          hasMore: itemCount > 3,
        };
      });

      return { success: true, data };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load purchase orders' };
    }
  }

  async findOnePO(id: number, orgId: number) {
    try {
      await this.ensurePoSchema();

      // Query PO header joined with supplier (includes org_id check)
      const po = await this.db.query(
        `SELECT p.id, p.po_number AS "poNumber",
                s.name AS "supplierName",
                p.order_date AS "orderDate",
                p.status,
                p.notes AS "comments",
                p.payment_type AS "paymentType",
                p.payment_date AS "paymentDate",
                p.payment_amount AS "paymentAmount",
                p.reference_number AS "referenceNumber",
                p.payment_notes AS "paymentNotes"
         FROM tblpurchases p
         LEFT JOIN tblsuppliers s ON s.id = p.supplier_id
         WHERE p.id = $1 AND p.org_id = $2 LIMIT 1`, [id, orgId]);

      if (po.rowCount === 0) return { success: false, message: 'Purchase order not found' };

      // Query all PO items with product name (legacy tblinventory or POS variant)
      const items = await this.db.query(
        `SELECT pi.id,
                pi.inventory_id AS "inventoryId",
                pi.variant_id AS "variantId",
                pi.item_name AS "itemName",
                COALESCE(
                  i.part_name,
                  CASE
                    WHEN vp.name IS NOT NULL AND v.variant_name IS NOT NULL AND lower(v.variant_name) <> 'default'
                      THEN vp.name || ' — ' || v.variant_name
                    ELSE vp.name
                  END,
                  pi.item_name
                ) AS "productName",
                COALESCE(i.brand, vp.brand, '') AS "brand",
                COALESCE(i.category, vp.category, '') AS "category",
                pi.quantity,
                pi.unit_cost AS "unitCost",
                pi.total_cost AS "lineTotal"
         FROM tblpo_items pi
         LEFT JOIN tblinventory i ON i.id = pi.inventory_id
         LEFT JOIN tblinventory_variants v ON v.id = pi.variant_id
         LEFT JOIN tblinventory_products vp ON vp.id = v.product_id
         WHERE pi.purchase_id = $1 ORDER BY pi.id ASC`, [id]);

      // Calculate aggregates from items
      let totalQuantity = 0;
      let totalCost = 0;
      const itemRows = items.rows.map((row: Record<string, unknown>) => {
        const quantity = Number(row['quantity'] ?? 0);
        const unitCost = Number(row['unitCost'] ?? 0);
        const lineTotal = Number(row['lineTotal'] ?? 0);
        totalQuantity += quantity;
        totalCost += lineTotal;
        return {
          id: row['id'],
          inventoryId: row['inventoryId'] ?? null,
          variantId: row['variantId'] ?? null,
          itemName: row['itemName'] ?? row['productName'] ?? '',
          productName: row['productName'],
          brand: row['brand'] ?? '',
          category: row['category'] ?? '',
          quantity,
          unitCost,
          lineTotal,
        };
      });

      const header = po.rows[0] as Record<string, unknown>;

      return {
        success: true,
        data: {
          id: header['id'],
          poNumber: header['poNumber'],
          supplierName: header['supplierName'],
          orderDate: header['orderDate'],
          status: header['status'],
          comments: header['comments'] ?? null,
          paymentType: header['paymentType'] ?? null,
          paymentDate: header['paymentDate'] ?? null,
          paymentAmount: Number(header['paymentAmount'] ?? 0),
          referenceNumber: header['referenceNumber'] ?? null,
          paymentNotes: header['paymentNotes'] ?? null,
          items: itemRows,
          totalQuantity,
          totalCost,
        },
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load purchase order' };
    }
  }

  async createPO(orgId: number, createdBy: number, dto: {
    supplierId?: number;
    paymentType?: string;
    paymentDate?: string;
    paymentAmount?: number;
    referenceNumber?: string;
    paymentNotes?: string;
    comments?: string;
    items?: Array<{
      inventoryId?: number;
      variantId?: number;
      itemName?: string;
      brand?: string;
      category?: string;
      quantity: number;
      unitCost: number;
    }>;
  }) {
    // Validation
    if (!dto.supplierId) {
      return { success: false, message: 'Supplier is required' };
    }
    if (!dto.items || dto.items.length === 0) {
      return { success: false, message: 'At least one item is required' };
    }
    for (const item of dto.items) {
      if (!item.quantity || item.quantity <= 0) {
        return { success: false, message: 'Each item must have a quantity greater than 0' };
      }
      if (item.unitCost === undefined || item.unitCost === null || item.unitCost < 0) {
        return { success: false, message: 'Each item must have a non-negative unit cost' };
      }
    }

    try {
      await this.ensurePoSchema();
      let poId: number;
      let poNumber: string;

      await this.db.withTransaction(async (client) => {
        // Auto-generate PO number: PO-{YYYYMMDD}-{sequence}
        const poNumResult = await client.query<{ po_number: string }>(
          `SELECT 'PO-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((COUNT(*) + 1)::TEXT, 4, '0') AS po_number
           FROM tblpurchases
           WHERE org_id = $1 AND DATE(created_at) = CURRENT_DATE`,
          [orgId],
        );
        poNumber = poNumResult.rows[0].po_number;

        // Insert PO header with payment fields and comments
        // Calculate total amount from items
        const totalAmount = (dto.items ?? []).reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);

        const po = await client.query<{ id: number }>(
          `INSERT INTO tblpurchases
             (org_id, supplier_id, po_number, status, notes, order_date, amount,
              payment_type, payment_date, payment_amount, reference_number, payment_notes,
              created_by, updated_at)
           VALUES ($1,$2,$3,'draft',$4,CURRENT_DATE,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING id`,
          [
            orgId,
            dto.supplierId,
            poNumber,
            dto.comments ?? null,
            totalAmount,
            dto.paymentType ?? null,
            dto.paymentDate ?? null,
            dto.paymentAmount ?? 0,
            dto.referenceNumber ?? null,
            dto.paymentNotes ?? null,
            createdBy,
          ],
        );
        poId = po.rows[0].id;

        // Insert PO items, handling new products
        for (const item of dto.items!) {
          let inventoryId = item.inventoryId ?? null;
          let variantId = item.variantId ?? null;

          // If neither an existing inventoryId nor variantId was given, create a new product
          if (!inventoryId && !variantId && item.itemName) {
            const created = await this.createNewPoProduct(client, orgId, {
              itemName: item.itemName,
              brand: item.brand,
              category: item.category,
              unitCost: item.unitCost,
            });
            inventoryId = created.inventoryId;
            variantId = created.variantId;
          }

          const totalCost = item.quantity * item.unitCost;
          await client.query(
            `INSERT INTO tblpo_items (purchase_id, inventory_id, variant_id, item_name, quantity, unit_cost, total_cost)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              poId,
              inventoryId,
              variantId,
              item.itemName ?? '',
              item.quantity,
              item.unitCost,
              totalCost,
            ],
          );
        }
      });

      return { success: true, id: poId!, poNumber: poNumber! };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create purchase order' };
    }
  }

  async updatePOStatus(id: number, orgId: number, status: string) {
    try {
      const result = await this.db.query(
        `UPDATE tblpurchases SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [status, id, orgId]);
      if (result.rowCount === 0) return { success: false, message: 'Purchase order not found' };
      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update PO status' };
    }
  }

  async updatePO(id: number, orgId: number, dto: { comments?: string; items?: Array<{ id?: number; inventoryId?: number | null; variantId?: number | null; itemName: string; brand?: string; category?: string; quantity: number; unitCost: number }> }) {
    try {
      await this.ensurePoSchema();

      // Verify PO exists, belongs to org, and is in draft status
      const poCheck = await this.db.query<{ status: string }>(
        `SELECT status FROM tblpurchases WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [id, orgId],
      );
      if (poCheck.rowCount === 0) return { success: false, message: 'Purchase order not found' };
      if (poCheck.rows[0].status !== 'draft') return { success: false, message: 'Only draft POs can be updated' };

      await this.db.withTransaction(async (client) => {
        // Update comments if provided
        if (dto.comments !== undefined) {
          await client.query(
            `UPDATE tblpurchases SET notes = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
            [dto.comments, id, orgId],
          );
        }

        // Replace items if provided
        if (dto.items) {
          // Delete existing items
          await client.query(`DELETE FROM tblpo_items WHERE purchase_id = $1`, [id]);

          // Insert new items
          let totalAmount = 0;
          for (const item of dto.items) {
            const totalCost = item.quantity * item.unitCost;
            totalAmount += totalCost;

            let inventoryId = item.inventoryId ?? null;
            let variantId = item.variantId ?? null;
            // Create new product if neither inventoryId nor variantId provided
            if (!inventoryId && !variantId && item.itemName) {
              const created = await this.createNewPoProduct(client, orgId, {
                itemName: item.itemName,
                brand: item.brand,
                category: item.category,
                unitCost: item.unitCost,
              });
              inventoryId = created.inventoryId;
              variantId = created.variantId;
            }

            await client.query(
              `INSERT INTO tblpo_items (purchase_id, inventory_id, variant_id, item_name, quantity, unit_cost, total_cost)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [id, inventoryId, variantId, item.itemName, item.quantity, item.unitCost, totalCost],
            );
          }

          // Update total amount on PO
          await client.query(
            `UPDATE tblpurchases SET amount = $1, updated_at = NOW() WHERE id = $2`,
            [totalAmount, id],
          );
        }
      });

      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to update purchase order' };
    }
  }

  async receivePO(id: number, orgId: number) {
    try {
      await this.ensurePoSchema();

      // Check PO exists and belongs to org
      const poResult = await this.db.query<{ status: string }>(
        `SELECT status FROM tblpurchases WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [id, orgId],
      );

      if (poResult.rowCount === 0) {
        return { success: false, message: 'Purchase order not found' };
      }

      // Check PO is not already received
      if (poResult.rows[0].status === 'received') {
        return { success: false, message: 'Purchase order has already been received' };
      }

      // Execute stock updates and status change within a single transaction
      await this.db.withTransaction(async (client) => {
        // Get all PO items with their inventory_id/variant_id and quantity
        const items = await client.query<{ inventory_id: number | null; variant_id: number | null; quantity: number }>(
          `SELECT pi.inventory_id, pi.variant_id, pi.quantity FROM tblpo_items pi WHERE pi.purchase_id = $1`,
          [id],
        );

        for (const item of items.rows) {
          // Legacy inventory: increase stock_qty (scoped to org for defense-in-depth)
          if (item.inventory_id) {
            const before = await client.query<{ stock_qty: number }>(
              `SELECT stock_qty FROM tblinventory WHERE id = $1`, [item.inventory_id]);
            const qtyBefore = Number(before.rows[0]?.stock_qty ?? 0);
            const qtyAfter = qtyBefore + item.quantity;

            await client.query(
              `UPDATE tblinventory SET stock_qty = stock_qty + $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
              [item.quantity, item.inventory_id, orgId],
            );

            // Record adjustment history linked to PO
            await client.query(
              `INSERT INTO tblinventory_adjustments
                 (org_id, inventory_id, adjustment_type, qty_before, qty_after, qty_change, reference_type, reference_id, notes)
               VALUES ($1, $2, 'po_receive', $3, $4, $5, 'purchase_order', $6, $7)`,
              [orgId, item.inventory_id, qtyBefore, qtyAfter, item.quantity, id, `PO received`],
            );
          }

          // POS variant: increase stock_qty so it becomes available to the register
          if (item.variant_id) {
            await client.query(
              `UPDATE tblinventory_variants SET stock_qty = stock_qty + $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
              [item.quantity, item.variant_id, orgId],
            );
          }
        }

        // Update PO status to 'received'
        await client.query(
          `UPDATE tblpurchases SET status = 'received', updated_at = NOW() WHERE id = $1 AND org_id = $2`,
          [id, orgId],
        );
      });

      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to receive PO' };
    }
  }

  async getSuppliers(orgId: number) {
    try {
      const result = await this.db.query(
        `SELECT id, name, contact_info AS "contactInfo", email, address
         FROM tblsuppliers WHERE org_id = $1 ORDER BY name ASC`, [orgId]);
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load suppliers' };
    }
  }

  async downloadInventoryCSV(orgId: number, query: PaginatedQueryDto) {
    try {
      const { search, status, deliveryDateFrom, deliveryDateTo } = query;

      const conditions: string[] = ['i.org_id = $1'];
      const params: unknown[] = [orgId];

      if (search?.trim()) {
        params.push(`%${search.trim()}%`);
        const idx = params.length;
        conditions.push(
          `(LOWER(i.part_name) LIKE LOWER($${idx}) OR LOWER(i.brand) LIKE LOWER($${idx}) OR LOWER(i.category) LIKE LOWER($${idx}))`,
        );
      }

      if (deliveryDateFrom) {
        params.push(deliveryDateFrom);
        conditions.push(
          `EXISTS (SELECT 1 FROM tblpo_items poi JOIN tblpurchases po ON po.id = poi.purchase_id WHERE poi.inventory_id = i.id AND po.order_date >= $${params.length})`,
        );
      }

      if (deliveryDateTo) {
        params.push(deliveryDateTo);
        conditions.push(
          `EXISTS (SELECT 1 FROM tblpo_items poi JOIN tblpurchases po ON po.id = poi.purchase_id WHERE poi.inventory_id = i.id AND po.order_date <= $${params.length})`,
        );
      }

      if (status === 'Good') {
        conditions.push('i.stock_qty > i.stock_warning');
      } else if (status === 'Warning') {
        conditions.push('i.stock_qty = i.stock_warning');
      } else if (status === 'Bad') {
        conditions.push('i.stock_qty < i.stock_warning');
      }

      const whereClause = conditions.join(' AND ');

      const sql = `
        SELECT
          i.part_name AS "partName",
          COALESCE(i.brand, '') AS "brand",
          COALESCE(i.category, '') AS "category",
          i.stock_qty AS "stockQty",
          i.cost_price AS "costPrice",
          i.selling_price AS "sellingPrice",
          COALESCE(st.purchased_qty, 0)::int AS "purchasedQuantity",
          COALESCE(st.month_sales, 0)::numeric AS "monthSales",
          CASE
            WHEN i.stock_qty > i.stock_warning THEN 'Good'
            WHEN i.stock_qty = i.stock_warning THEN 'Warning'
            ELSE 'Bad'
          END AS "stockStatus"
        FROM tblinventory i
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(s.quantity_sold), 0) AS purchased_qty,
            COALESCE(SUM(s.total_amount), 0) AS month_sales
          FROM tblsales_transactions s
          WHERE s.inventory_id = i.id
            AND s.sale_date >= DATE_TRUNC('month', CURRENT_DATE)
            AND s.sale_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
        ) st ON true
        WHERE ${whereClause}
        ORDER BY i.part_name ASC
      `;

      const result = await this.db.query(sql, params);

      // Build CSV
      const header = 'Product Name,Brand,Category,Quantity,Cost,SRP,Purchased_Quantity,Month_Sales,Stock_Status';
      const rows = result.rows.map((row: Record<string, unknown>) => {
        const fields = [
          this.escapeCsvField(String(row['partName'] ?? '')),
          this.escapeCsvField(String(row['brand'] ?? '')),
          this.escapeCsvField(String(row['category'] ?? '')),
          String(row['stockQty'] ?? 0),
          String(row['costPrice'] ?? 0),
          String(row['sellingPrice'] ?? 0),
          String(row['purchasedQuantity'] ?? 0),
          String(row['monthSales'] ?? 0),
          String(row['stockStatus'] ?? ''),
        ];
        return fields.join(',');
      });

      const csv = [header, ...rows].join('\n');
      return { success: true, csv };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to generate CSV' };
    }
  }

  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  async searchSuppliers(orgId: number, query: string) {
    try {
      const result = await this.db.query(
        `SELECT id, name, contact_info AS "contactInfo", email, address
         FROM tblsuppliers
         WHERE org_id = $1 AND LOWER(name) LIKE LOWER($2)
         ORDER BY name ASC
         LIMIT 20`,
        [orgId, `%${query.trim()}%`],
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Search failed' };
    }
  }

  async createSupplier(orgId: number, dto: { name: string; contactInfo?: string; email?: string; address?: string }) {
    const name = dto.name?.trim();
    if (!name) return { success: false, message: 'Supplier name is required' };
    try {
      const result = await this.db.query<{ id: number; name: string }>(
        `INSERT INTO tblsuppliers (org_id, name, contact_info, email, address)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name`,
        [orgId, name, dto.contactInfo ?? null, dto.email ?? null, dto.address ?? null],
      );
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create supplier' };
    }
  }

  // ── Brands ──────────────────────────────────────────────────────────────

  async getBrands(orgId: number, query?: string) {
    try {
      const params: unknown[] = [orgId];
      let where = 'org_id = $1';
      if (query?.trim()) {
        params.push(`%${query.trim()}%`);
        where += ` AND LOWER(name) LIKE LOWER($${params.length})`;
      }
      const result = await this.db.query(
        `SELECT id, name FROM tblinventory_brands WHERE ${where} ORDER BY name ASC LIMIT 50`,
        params,
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load brands' };
    }
  }

  async createBrand(orgId: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, message: 'Brand name is required' };
    try {
      const result = await this.db.query(
        `INSERT INTO tblinventory_brands (org_id, name)
         VALUES ($1, $2)
         ON CONFLICT (org_id, LOWER(name)) DO NOTHING
         RETURNING id, name`,
        [orgId, trimmed],
      );
      if (result.rowCount === 0) {
        // Already exists, fetch it
        const existing = await this.db.query(
          `SELECT id, name FROM tblinventory_brands WHERE org_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
          [orgId, trimmed],
        );
        return { success: true, data: existing.rows[0] };
      }
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create brand' };
    }
  }

  // ── Categories ──────────────────────────────────────────────────────────

  async getCategories(orgId: number, query?: string) {
    try {
      const params: unknown[] = [orgId];
      let where = 'org_id = $1';
      if (query?.trim()) {
        params.push(`%${query.trim()}%`);
        where += ` AND LOWER(name) LIKE LOWER($${params.length})`;
      }
      const result = await this.db.query(
        `SELECT id, name FROM tblinventory_categories WHERE ${where} ORDER BY name ASC LIMIT 50`,
        params,
      );
      return { success: true, data: result.rows };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to load categories' };
    }
  }

  async createCategory(orgId: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, message: 'Category name is required' };
    try {
      const result = await this.db.query(
        `INSERT INTO tblinventory_categories (org_id, name)
         VALUES ($1, $2)
         ON CONFLICT (org_id, LOWER(name)) DO NOTHING
         RETURNING id, name`,
        [orgId, trimmed],
      );
      if (result.rowCount === 0) {
        const existing = await this.db.query(
          `SELECT id, name FROM tblinventory_categories WHERE org_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
          [orgId, trimmed],
        );
        return { success: true, data: existing.rows[0] };
      }
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to create category' };
    }
  }

  async uploadProductImage(id: number, orgId: number, file: Express.Multer.File) {
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
        `SELECT id FROM tblinventory WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      if (existing.rowCount === 0) {
        return { success: false, message: 'Item not found' };
      }

      const resizedBuffer = await sharp(file.buffer)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();

      const dataUrl = `data:image/webp;base64,${resizedBuffer.toString('base64')}`;

      await this.db.query(
        `UPDATE tblinventory SET image_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
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

  async removeProductImage(id: number, orgId: number) {
    try {
      const result = await this.db.query(
        `UPDATE tblinventory SET image_url = NULL, updated_at = NOW()
         WHERE id = $1 AND org_id = $2 RETURNING id`,
        [id, orgId],
      );
      if (result.rowCount === 0) {
        return { success: false, message: 'Item not found' };
      }
      return { success: true };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to remove image',
      };
    }
  }
}
