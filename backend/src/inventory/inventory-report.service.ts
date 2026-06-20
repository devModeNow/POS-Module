import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import * as ExcelJS from 'exceljs';

export interface MonthlyReportRow {
  productId: number;
  productName: string;
  unitCost: number;
  srp: number;
  beginningBalance: number;
  dailySales: Record<string, number>;
  totalSales: number;
  totalPurchase: number;
  endingInventory: number;
  actualCount: number | null;
  inventoryShortage: number | null;
  remark: 'GOOD' | 'BAD' | null;
}

@Injectable()
export class InventoryReportService {
  constructor(private readonly db: DatabaseService) {}

  async saveActualCount(orgId: number, userId: number, dto: { productId: number; month: string; count: number }) {
    try {
      // Validate count is a non-negative integer
      if (!Number.isInteger(dto.count) || dto.count < 0) {
        return { success: false, message: 'Count must be a non-negative integer' };
      }

      // Convert YYYY-MM to first day of month (e.g., '2026-03-01')
      const monthDate = `${dto.month}-01`;

      const sql = `
        INSERT INTO tblinventory_actual_counts (org_id, inventory_id, month, actual_count, updated_by, updated_at)
        VALUES ($1, $2, $3::date, $4, $5, NOW())
        ON CONFLICT (org_id, inventory_id, month)
        DO UPDATE SET actual_count = $4, updated_by = $5, updated_at = NOW()
      `;

      await this.db.query(sql, [orgId, dto.productId, monthDate, dto.count, userId]);

      return { success: true };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to save actual count' };
    }
  }

  async generateMonthlyReport(orgId: number, month: string, category?: string) {
    try {
      // Parse month string (YYYY-MM) into date range
      const monthStart = `${month}-01`;
      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr, 10);
      const monthNum = parseInt(monthStr, 10);
      // Calculate the last day of the month
      const daysInMonth = new Date(year, monthNum, 0).getDate();
      const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;

      // 1. Get all products for the org (optionally filtered by category)
      const productConditions: string[] = ['i.org_id = $1'];
      const productParams: unknown[] = [orgId];

      if (category?.trim()) {
        productParams.push(category.trim());
        productConditions.push(`LOWER(i.category) = LOWER($${productParams.length})`);
      }

      const productsSql = `
        SELECT i.id, i.part_name AS "partName", i.cost_price AS "costPrice",
               i.selling_price AS "sellingPrice", i.stock_qty AS "stockQty"
        FROM tblinventory i
        WHERE ${productConditions.join(' AND ')}
        ORDER BY i.part_name ASC
      `;
      const productsResult = await this.db.query(productsSql, productParams);
      const products = productsResult.rows as Array<{
        id: number;
        partName: string;
        costPrice: number;
        sellingPrice: number;
        stockQty: number;
      }>;

      if (products.length === 0) {
        return { success: true, data: [] };
      }

      const productIds = products.map((p) => p.id);

      // 2. Get total purchases (from received POs) for each product in the month
      const purchasesSql = `
        SELECT pi.inventory_id AS "inventoryId",
               COALESCE(SUM(pi.quantity), 0)::int AS "totalPurchase"
        FROM tblpo_items pi
        JOIN tblpurchases po ON po.id = pi.purchase_id
        WHERE po.org_id = $1
          AND po.status = 'received'
          AND po.order_date >= $2::date
          AND po.order_date <= $3::date
          AND pi.inventory_id = ANY($4::bigint[])
        GROUP BY pi.inventory_id
      `;
      const purchasesResult = await this.db.query(purchasesSql, [orgId, monthStart, monthEnd, productIds]);
      const purchaseMap = new Map<number, number>();
      for (const row of purchasesResult.rows as Array<{ inventoryId: number; totalPurchase: number }>) {
        purchaseMap.set(row.inventoryId, Number(row.totalPurchase));
      }

      // 3. Get daily sales for each product in the month
      const salesSql = `
        SELECT st.inventory_id AS "inventoryId",
               EXTRACT(DAY FROM st.sale_date)::int AS "day",
               COALESCE(SUM(st.quantity_sold), 0)::int AS "qty"
        FROM tblsales_transactions st
        WHERE st.org_id = $1
          AND st.sale_date >= $2::date
          AND st.sale_date <= $3::date
          AND st.inventory_id = ANY($4::bigint[])
        GROUP BY st.inventory_id, EXTRACT(DAY FROM st.sale_date)
      `;
      const salesResult = await this.db.query(salesSql, [orgId, monthStart, monthEnd, productIds]);
      // Map: productId -> { day: qty }
      const salesMap = new Map<number, Map<number, number>>();
      for (const row of salesResult.rows as Array<{ inventoryId: number; day: number; qty: number }>) {
        if (!salesMap.has(row.inventoryId)) {
          salesMap.set(row.inventoryId, new Map());
        }
        salesMap.get(row.inventoryId)!.set(row.day, Number(row.qty));
      }

      // 4. Get actual counts for each product in the month
      const actualCountSql = `
        SELECT ac.inventory_id AS "inventoryId",
               ac.actual_count AS "actualCount"
        FROM tblinventory_actual_counts ac
        WHERE ac.org_id = $1
          AND ac.month = $2::date
          AND ac.inventory_id = ANY($3::bigint[])
      `;
      const actualCountResult = await this.db.query(actualCountSql, [orgId, monthStart, productIds]);
      const actualCountMap = new Map<number, number>();
      for (const row of actualCountResult.rows as Array<{ inventoryId: number; actualCount: number }>) {
        actualCountMap.set(row.inventoryId, Number(row.actualCount));
      }

      // 5. Build report rows
      const reportData: MonthlyReportRow[] = products.map((product) => {
        const totalPurchase = purchaseMap.get(product.id) ?? 0;
        const dailySalesForProduct = salesMap.get(product.id) ?? new Map<number, number>();

        // Calculate total sales as sum of daily quantities
        let totalSales = 0;
        for (const qty of dailySalesForProduct.values()) {
          totalSales += qty;
        }

        // Beginning_Balance = current_stock - purchases_this_month + sales_this_month
        const currentStock = Number(product.stockQty);
        const beginningBalance = currentStock - totalPurchase + totalSales;

        // Ending_Inventory = Beginning_Balance + Total_Purchase - Total_Sales
        const endingInventory = beginningBalance + totalPurchase - totalSales;

        // Build daily sales object with all days of the month
        const dailySales: Record<string, number> = {};
        for (let day = 1; day <= daysInMonth; day++) {
          dailySales[String(day)] = dailySalesForProduct.get(day) ?? 0;
        }

        // Actual count and shortage
        const actualCount = actualCountMap.has(product.id)
          ? actualCountMap.get(product.id)!
          : null;

        let inventoryShortage: number | null = null;
        let remark: 'GOOD' | 'BAD' | null = null;

        if (actualCount !== null) {
          inventoryShortage = endingInventory - actualCount;
          remark = inventoryShortage === 0 ? 'GOOD' : 'BAD';
        }

        return {
          productId: product.id,
          productName: product.partName,
          unitCost: Number(product.costPrice),
          srp: Number(product.sellingPrice),
          beginningBalance,
          dailySales,
          totalSales,
          totalPurchase,
          endingInventory,
          actualCount,
          inventoryShortage,
          remark,
        };
      });

      return { success: true, data: reportData };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to generate monthly report' };
    }
  }

  async exportMonthlyReport(orgId: number, month: string, category?: string): Promise<{ success: boolean; buffer?: Buffer; message?: string }> {
    // Generate the report data first
    const result = await this.generateMonthlyReport(orgId, month, category);

    if (!result.success || !result.data) {
      return { success: false, message: result.message ?? 'Failed to generate report data' };
    }

    try {
      const reportData = result.data;

      // Determine days in month
      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr, 10);
      const monthNum = parseInt(monthStr, 10);
      const daysInMonth = new Date(year, monthNum, 0).getDate();

      // Create workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Monthly Inventory Report');

      // Build header columns
      const columns: Partial<ExcelJS.Column>[] = [
        { header: 'Product Name', key: 'productName', width: 25 },
        { header: 'Unit Cost', key: 'unitCost', width: 12 },
        { header: 'SRP', key: 'srp', width: 12 },
        { header: 'Beginning Balance', key: 'beginningBalance', width: 18 },
      ];

      // Add one column per day
      for (let day = 1; day <= daysInMonth; day++) {
        columns.push({ header: `Day ${day}`, key: `day_${day}`, width: 8 });
      }

      // Add summary columns
      columns.push(
        { header: 'Total Sales', key: 'totalSales', width: 12 },
        { header: 'Total Purchase', key: 'totalPurchase', width: 14 },
        { header: 'Ending Inventory', key: 'endingInventory', width: 16 },
        { header: 'Actual Count', key: 'actualCount', width: 13 },
        { header: 'Inventory Shortage', key: 'inventoryShortage', width: 18 },
        { header: 'Remarks', key: 'remarks', width: 10 },
      );

      worksheet.columns = columns;

      // Style header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };

      // Add data rows
      for (const row of reportData) {
        const rowData: Record<string, unknown> = {
          productName: row.productName,
          unitCost: row.unitCost,
          srp: row.srp,
          beginningBalance: row.beginningBalance,
          totalSales: row.totalSales,
          totalPurchase: row.totalPurchase,
          endingInventory: row.endingInventory,
          actualCount: row.actualCount ?? '',
          inventoryShortage: row.inventoryShortage ?? '',
          remarks: row.remark ?? '',
        };

        // Add daily sales values
        for (let day = 1; day <= daysInMonth; day++) {
          rowData[`day_${day}`] = row.dailySales[String(day)] ?? 0;
        }

        worksheet.addRow(rowData);
      }

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();

      return { success: true, buffer: Buffer.from(buffer) };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : 'Failed to export report to Excel' };
    }
  }
}
