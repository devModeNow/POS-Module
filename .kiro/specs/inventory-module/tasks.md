# Implementation Plan: Inventory Module

## Overview

This plan implements the full Inventory Module for the CBIS Car Expert platform. The module provides product CRUD with pagination, purchase order lifecycle management, monthly inventory reporting, and data export (CSV/Excel). Implementation builds on the existing NestJS skeleton (`inventory.controller.ts`, `inventory.service.ts`, `inventory.module.ts`) and uses raw SQL via `DatabaseService`.

Tasks are ordered so foundational work (database schema, module registration) comes first, then features build incrementally on each other.

## Tasks

- [x] 1. Database migration — create and formalize all tables
  - [x] 1.1 Create SQL migration file for all 6 tables
    - Create `backend/sql/supabase/20260420_inventory_module.sql`
    - Include `tblinventory` (formalize with `created_at`, indexes)
    - Include `tblsuppliers` (formalize with indexes)
    - Include `tblpurchases` (add payment fields: `payment_type`, `payment_date`, `payment_amount`, `reference_number`, `payment_notes`)
    - Include `tblpo_items` (formalize with indexes)
    - Include NEW `tblsales_transactions` table
    - Include NEW `tblinventory_actual_counts` table with UNIQUE constraint
    - Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for idempotency
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 2. Module setup — register services, controllers, DTOs
  - [x] 2.1 Create DTO classes with validation
    - Create `backend/src/inventory/dto/paginated-query.dto.ts` with `page`, `pageSize`, `search`, `status`, `deliveryDateFrom`, `deliveryDateTo`
    - Create `backend/src/inventory/dto/create-product.dto.ts` with `partName` (required), optional fields
    - Create `backend/src/inventory/dto/create-purchase-order.dto.ts` with `supplierId`, payment fields, `items` array
    - Create `backend/src/inventory/dto/purchase-order-item.dto.ts` with `inventoryId`, `itemName`, `brand`, `category`, `quantity`, `unitCost`
    - Create `backend/src/inventory/dto/actual-count.dto.ts` with `productId`, `month`, `count`
    - Create `backend/src/inventory/dto/monthly-report-query.dto.ts` with `month`, `category`
    - _Requirements: 1.1, 3.2, 5.1, 5.5, 11.2_

  - [x] 2.2 Create InventoryReportService and InventoryReportController
    - Create `backend/src/inventory/inventory-report.service.ts` with empty class injecting `DatabaseService`
    - Create `backend/src/inventory/inventory-report.controller.ts` with route prefix `/inventory/reports`, `@UseGuards(JwtAuthGuard)`
    - _Requirements: 10.1, 12.1_

  - [x] 2.3 Update InventoryModule to register new providers and controllers
    - Add `InventoryReportService` to providers
    - Add `InventoryReportController` to controllers
    - _Requirements: 10.1, 12.1_

- [x] 3. Implement product list with server-side pagination, filtering, and metrics
  - [x] 3.1 Refactor `findAll` in InventoryService to support pagination and metrics
    - Accept `PaginatedQueryDto` parameters (page, pageSize, search, status, deliveryDateFrom, deliveryDateTo)
    - Add `COUNT(*) OVER()` for total record count
    - Add `LIMIT/OFFSET` for pagination
    - Join `tblsales_transactions` to compute `Purchased_Quantity` and `Month_Sales` per product for the current month
    - Compute `Stock_Status` classification per product (Good/Warning/Bad)
    - Return pagination metadata: `totalCount`, `currentPage`, `pageSize`, `totalPages`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 3.2 Implement stock status filter and delivery date range filter
    - Add stock status filter (Good/Warning/Bad) using HAVING or WHERE on computed status
    - Add delivery date range filter joining `tblpurchases` and `tblpo_items`
    - Ensure AND logic when multiple filters are combined
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.3 Implement page totals summary
    - Calculate sum of quantity, cost, SRP, Purchased_Quantity, Month_Sales for the current page results
    - Return as `totals` object alongside `data` array
    - _Requirements: 1.5_

  - [ ]* 3.4 Write property tests for stock status classification
    - **Property 1: Stock status classification is correct**
    - **Validates: Requirements 1.4**

  - [ ]* 3.5 Write property tests for pagination slice correctness
    - **Property 2: Pagination returns correct slice**
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 3.6 Write property tests for page totals
    - **Property 3: Page totals equal sum of page items**
    - **Validates: Requirements 1.5**

  - [ ]* 3.7 Write property tests for search filter
    - **Property 4: Search filter returns only matching products**
    - **Validates: Requirements 2.1**

  - [ ]* 3.8 Write property tests for combined filters
    - **Property 5: Combined filters use AND logic**
    - **Validates: Requirements 2.4**

- [x] 4. Implement product creation with validation
  - [x] 4.1 Enhance `create` method in InventoryService
    - Use `CreateProductDto` with proper validation
    - Validate `partName` is non-empty after trim
    - Accept all optional fields (brand, category, description, stockQty, stockWarning, costPrice, sellingPrice, maxDiscountPrice)
    - Return `{ success: true, id }` on success
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 4.2 Write property tests for product creation round-trip
    - **Property 6: Product creation round-trip**
    - **Validates: Requirements 3.1, 3.3, 3.5**

  - [ ]* 4.3 Write property tests for whitespace name rejection
    - **Property 7: Empty/whitespace product names are rejected**
    - **Validates: Requirements 3.2, 3.4**

- [x] 5. Checkpoint — Verify product CRUD and pagination
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement supplier search endpoint
  - [x] 6.1 Add supplier search method to InventoryService
    - Create `searchSuppliers(orgId, query)` method
    - Filter suppliers by name (case-insensitive LIKE)
    - Limit results to 20
    - Return id, name, contactInfo, email, address
    - _Requirements: 8.1, 8.2_

  - [x] 6.2 Add supplier search route to InventoryController
    - Add `GET /inventory/suppliers/search` endpoint with `@Query('q')` parameter
    - Wire to `searchSuppliers` service method
    - _Requirements: 8.1_

  - [ ]* 6.3 Write property tests for supplier search
    - **Property 15: Supplier search returns matching results within limit**
    - **Validates: Requirements 8.1**

- [x] 7. Implement product smart search for purchase orders
  - [x] 7.1 Enhance product search method in InventoryService
    - Update `search` method to return brand, category, costPrice, sellingPrice, stockQty
    - Add `existsInInventory: true` flag to each result
    - Limit to 20 results
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 8. Implement Purchase Order creation with payment details
  - [x] 8.1 Enhance `createPO` method in InventoryService
    - Accept `CreatePurchaseOrderDto` with full validation
    - Validate `supplierId` is provided (return error if missing)
    - Validate `items` array has at least 1 element
    - Validate each item has `quantity > 0` and `unitCost >= 0`
    - Store payment fields (paymentType, paymentDate, paymentAmount, referenceNumber, paymentNotes)
    - Store comments/remarks
    - Auto-generate PO number: `PO-{YYYYMMDD}-{sequence}`
    - Calculate and store total_cost per item as quantity × unitCost
    - Handle new products: if `inventoryId` is null but `itemName`/`brand`/`category` provided, create new inventory record
    - Use transaction for atomicity
    - Return `{ success: true, id, poNumber }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_

  - [ ]* 8.2 Write property tests for PO total cost calculation
    - **Property 8: PO total cost equals sum of line items**
    - **Validates: Requirements 5.7**

- [x] 9. Implement Purchase Order list with product name truncation
  - [x] 9.1 Enhance `findAllPO` method in InventoryService
    - Return PO number, supplier name, order date, total ordered quantity, total cost, created date
    - Include first 3 product names from PO items
    - Add `hasMore` flag when PO has more than 3 items
    - Order by creation date descending
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 9.2 Write property tests for PO list product name truncation
    - **Property 10: PO list truncates product names at 3**
    - **Validates: Requirements 7.2, 7.3**

- [x] 10. Implement Purchase Order viewing
  - [x] 10.1 Enhance `findOnePO` method in InventoryService
    - Return full PO header: poNumber, supplierName, orderDate, status, comments
    - Return all PO items with: productName, quantity, unitCost, lineTotal
    - Return payment details: paymentType, paymentDate, paymentAmount, referenceNumber, paymentNotes
    - Return aggregates: totalQuantity, totalCost
    - Return not-found error for invalid/cross-org IDs
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 10.2 Write property tests for PO view round-trip
    - **Property 9: PO view returns complete data round-trip**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [x] 11. Implement Purchase Order receiving with stock update
  - [x] 11.1 Enhance `receivePO` method in InventoryService
    - Validate PO is not already received (return error if status is 'received')
    - Increase `stock_qty` for each linked inventory item by ordered quantity
    - Update PO status to 'received'
    - Execute within a single database transaction
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 11.2 Write property tests for PO receiving stock update
    - **Property 11: Receiving PO increases stock by ordered quantity**
    - **Validates: Requirements 13.1, 13.2**

- [x] 12. Checkpoint — Verify Purchase Order lifecycle
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement monthly inventory report generation
  - [x] 13.1 Implement `generateMonthlyReport` in InventoryReportService
    - Accept month (YYYY-MM) and optional category filter
    - Calculate Beginning_Balance per product: `current_stock - purchases_this_month + sales_this_month`
    - Query daily sales from `tblsales_transactions` grouped by day
    - Calculate Total_Sales as sum of daily quantities
    - Calculate Total_Purchase from received POs in the month
    - Calculate Ending_Inventory = Beginning_Balance + Total_Purchase - Total_Sales
    - Fetch Actual_Count from `tblinventory_actual_counts`
    - Calculate Inventory_Shortage = Ending_Inventory - Actual_Count
    - Assign Remark: "GOOD" if shortage == 0, "BAD" otherwise
    - Include product name, unit cost, SRP per row
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

  - [x] 13.2 Add `GET /inventory/reports/monthly` route in InventoryReportController
    - Accept `month` and `category` query parameters
    - Wire to `generateMonthlyReport` service method
    - _Requirements: 10.1_

  - [ ]* 13.3 Write property tests for monthly report ending inventory formula
    - **Property 12: Monthly report ending inventory formula**
    - **Validates: Requirements 10.6, 10.8, 10.9**

  - [ ]* 13.4 Write property tests for total sales calculation
    - **Property 13: Total sales equals sum of daily sales**
    - **Validates: Requirements 10.4**

- [x] 14. Implement actual count entry
  - [x] 14.1 Implement `saveActualCount` in InventoryReportService
    - Accept productId, month (YYYY-MM), count value
    - Validate count is a non-negative integer (return error if negative)
    - Upsert into `tblinventory_actual_counts` using ON CONFLICT (org_id, inventory_id, month)
    - Store `updated_by` from JWT user
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 14.2 Add `POST /inventory/reports/monthly/actual-count` route in InventoryReportController
    - Accept `ActualCountDto` body
    - Wire to `saveActualCount` service method
    - _Requirements: 11.1_

- [x] 15. Implement report export to Excel
  - [x] 15.1 Install exceljs dependency and implement Excel export
    - Add `exceljs` package to backend dependencies
    - Implement `exportMonthlyReport` in InventoryReportService
    - Generate Excel workbook with columns: product name, unit cost, SRP, Beginning_Balance, daily sales (one column per day), Total_Sales, Total_Purchase, Ending_Inventory, Actual_Count, Inventory_Shortage, Remarks
    - Return buffer with appropriate content-type (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 15.2 Add `GET /inventory/reports/monthly/export` route in InventoryReportController
    - Accept `month` and `category` query parameters
    - Set response headers for file download
    - Wire to `exportMonthlyReport` service method
    - _Requirements: 12.3_

- [x] 16. Checkpoint — Verify monthly report and export
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Implement inventory CSV download
  - [x] 17.1 Implement `downloadInventoryCSV` in InventoryService
    - Generate CSV with columns: product name, brand, category, quantity, cost, SRP, Purchased_Quantity, Month_Sales, Stock_Status
    - Apply current filter criteria (search, status, deliveryDate) to match displayed data
    - Return CSV string with appropriate content-type (`text/csv`)
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 17.2 Add `GET /inventory/download` route in InventoryController
    - Accept same filter query params as the list endpoint
    - Set response headers for file download (`Content-Disposition: attachment`)
    - Wire to `downloadInventoryCSV` service method
    - _Requirements: 4.3_

- [x] 18. Implement organization scoping verification
  - [x] 18.1 Audit all service methods for org_id scoping
    - Verify every query in InventoryService includes `org_id = $N` condition
    - Verify every query in InventoryReportService includes `org_id = $N` condition
    - Ensure cross-org access returns generic "not found" (never reveals existence)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [ ]* 18.2 Write property tests for organization scoping isolation
    - **Property 14: Organization scoping isolation**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**

- [x] 19. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use `fast-check` library and validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing skeleton files (`inventory.controller.ts`, `inventory.service.ts`, `inventory.module.ts`) will be expanded in-place rather than replaced
- All SQL uses parameterized queries via `DatabaseService.query()` for security
