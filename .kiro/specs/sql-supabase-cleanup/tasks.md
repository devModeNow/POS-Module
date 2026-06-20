# Implementation Plan: SQL Supabase Cleanup

## Overview

This plan implements the HVAC cleanup across four coordinated activities: deleting orphaned migration files, editing migrations with mixed content, creating a consolidated schema migration, and refactoring the dashboard service. Tasks are ordered to handle deletions and edits first, then the consolidated schema (which references the cleaned state), and finally the dashboard service refactoring. A final verification step ensures the backend compiles cleanly.

## Tasks

- [x] 1. Delete orphaned migration files
  - Delete `backend/sql/supabase/20260318_backfill_branchid.sql` (exclusively references tblpurchase_orders and tblsales_order)
  - Delete `backend/sql/supabase/20260309_quotation_quote_no_auto.sql` (duplicate of logic in 20260308_quotation_feature.sql)
  - Delete `backend/sql/supabase/run_phase1_migration.js` (one-time script with hardcoded credentials)
  - Delete `backend/sql/supabase/all_migrations_combined.sql` (superseded by new consolidated migration)
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Clean migration files with HVAC remnants
  - [x] 2.1 Edit `20260310_material_inventory_enhancement.sql` to remove HVAC references
    - Remove comments/sections referencing tblbrands, tblpurchase_orders, tblso_payments as removed tables
    - Remove orphaned trigger functions: `update_material_stock_on_po_approval()`, `update_customer_balance_on_sales()`, `update_customer_balance_on_so_payment()`
    - Remove `recalc_customer_balance()` function body that references removed tables (or remove entirely)
    - Remove all commented-out trigger creation statements for removed tables
    - Retain all CREATE TABLE statements for retained tables (tblmaterials, tblmaterial_price_history, tbltransaction_material_items, tblproject_details, tblservice_details, tblconcern_details, tbltransfer_details, tblexpense_details, tblcustomer_payments, tblstatement_of_account, tblcheque_voucher, tblgeneral_journal, tbljournal_entry_lines, tbltax_2307, tblaudit_log)
    - Retain `update_customer_balance_on_customer_payment()` function and its trigger
    - Retain customer enhancement columns (ALTER TABLE tblcustomer)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Edit `20260401_project_master_table.sql` to remove HVAC references
    - Remove the `ALTER TABLE public.tblsales_order ADD COLUMN IF NOT EXISTS project_id ...` statement
    - Remove the `CREATE INDEX IF NOT EXISTS idx_tblsales_order_project_id ...` statement
    - Retain the CREATE TABLE for tblprojects, its indexes, timestamp trigger, and table comment
    - _Requirements: 2.4_

- [x] 3. Checkpoint - Verify migration cleanup
  - Ensure all four orphaned files are deleted
  - Grep edited migration files for HVAC table names (tblpurchase_orders, tblsales_order, tblso_payments, tblbrands) to confirm removal
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Create consolidated schema migration
  - [x] 4.1 Create `backend/sql/supabase/00_cbis_full_schema.sql` with Sections 1-6
    - Wrap entire file in BEGIN/COMMIT transaction
    - Section 1: Core Tables (tblrbac, tblusers, auth_permission_keys, auth_role_permissions, auth_user_permission_overrides, auth_user_roles, auth_menus)
    - Section 2: Organization Tables (tblorganizations, tblorg_settings, tblorg_menus)
    - Section 3: Customer Management (tblcustomer with enhancement columns)
    - Section 4: Quotation Feature (tblquotation, tblquotation_items)
    - Section 5: Material Inventory (tblmaterials, tblmaterial_price_history, tbltransaction_material_items)
    - Section 6: Project & Service Management (tblprojects, tblproject_details, tblservice_details, tblconcern_details, tbltransfer_details, tblexpense_details)
    - Use `CREATE TABLE IF NOT EXISTS` for all tables
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7_

  - [x] 4.2 Add Sections 7-12 to `00_cbis_full_schema.sql`
    - Section 7: Customer Payments & SOA (tblcustomer_payments, tblstatement_of_account)
    - Section 8: Accounting (tblcheque_voucher, tblgeneral_journal, tbljournal_entry_lines, tbltax_2307, tblpo_payments, tblaccount_titles, tblcheque_vouchers, tblcheque_voucher_deposits, tblcheque_voucher_invoices, tblcheque_voucher_account_titles, tblaccounting_report_print_settings)
    - Section 9: Audit & Settings (tblaudit_log, tblaudit_logs, tblsettings)
    - Section 10: Functions & Triggers (set_current_timestamp_updated_at, tblquotation_set_quote_no, update_customer_balance_on_customer_payment)
    - Section 11: Indexes for all retained tables
    - Section 12: Seed Data (default roles, default organization "Car Expert Auto Repair", default menus, default permission keys, default superadmin user) using `ON CONFLICT DO NOTHING`
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 5. Checkpoint - Verify consolidated schema
  - Confirm `00_cbis_full_schema.sql` exists and contains CREATE TABLE statements for all retained tables
  - Grep the file for HVAC table names to confirm none are present
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Refactor dashboard service to remove HVAC queries
  - [x] 6.1 Remove unused type definitions and HVAC helper methods from `dashboard.service.ts`
    - Remove type definitions: `CountRow`, `SalesRow`, `GrossMarginRow`, `ReceivableRow`, `TopCustomerRow`, `TopCapacityRow`, `MarginRow`, `ActivityRow`, `SalesFinancialSummaryRow`, `SalesSettlementStateRow`
    - Remove private helper methods: `getSalesDashboardBaseCte()`, `insertSalesPaymentRecord()`, `updateSalesOrderStatusForSettlement()`, `loadSalesSettlementState()`, `getSalesSettlementAuditSnapshot()`, `getSettledSalesPredicate()`, `getRecordedSalesAmountExpression()`, `getRecordedSalesPredicate()`, `getOpenBalancePredicate()`, `buildDelta()`, `normalizeStatus()`, `getTableColumns()`, `pickColumn()`, `toIsoDateOrNull()`
    - Retain type definitions: `AuditActorContext`, `Trend`, `KpiCard`, `OpsLevel`, `OpsItem`, `MarginItem`, `ActivityItem`, `DashboardResponse`, `DashboardSalesDetailMode`, `DashboardOperationDetailMode`, `DashboardSettlementMode`, `DashboardReceivableVerificationMode`
    - Retain utility methods: `toNumber()`, `formatInteger()`, `formatCurrency()`, `formatPercent()`, `formatActivityTime()`
    - _Requirements: 4.13_

  - [x] 6.2 Replace `getOverview()` with a stub returning empty dashboard data
    - Return `{ success: true, item: { generatedAt, topKpis: [], operations: [], salesSummary: [], topCustomers: [], topCapacities: [], marginByBrand: [], marginByVendor: [], activityFeed: [], todayFocus: 'Dashboard data sources are being migrated' } }`
    - _Requirements: 4.11_

  - [x] 6.3 Replace `getSalesDetail()` with a stub returning empty items
    - Return `{ success: true, items: [] }`
    - _Requirements: 4.12_

  - [x] 6.4 Replace `getOperationsDetail()` with a stub returning empty items
    - Return `{ success: true, items: [] }`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 6.5 Replace `settleSalesOrder()` with a stub returning graceful refusal
    - Return `{ success: false, message: 'Sales settlement is temporarily unavailable during migration' }`
    - _Requirements: 4.1, 4.2, 4.3, 4.9_

  - [x] 6.6 Replace `verifySalesReceivable()` with a stub returning graceful refusal
    - Return `{ success: false, message: 'Receivable verification is temporarily unavailable during migration' }`
    - _Requirements: 4.1, 4.2, 4.3, 4.9_

  - [x] 6.7 Retain `getPlatformStats()` unchanged
    - Verify it only queries tblorganizations and tblusers (both retained tables)
    - Ensure no modifications are made to this method
    - _Requirements: 4.10_

- [x] 7. Final checkpoint - Verify backend compilation and HVAC removal
  - Run `npm run build` in the backend directory and confirm zero TypeScript errors
  - Grep `dashboard.service.ts` for HVAC table names (tblserial_numbers, tblpurchase_orders, tblsales_order, tblproducts, tblcapacity, tblbrands, tblvendors, tbltransaction_product_items, tblso_payments) — expected count: 0
  - Confirm `getPlatformStats`, `getOverview`, `getSalesDetail` public method signatures are preserved
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 5.1, 5.2_

## Notes

- No property-based tests are included — this is a cleanup/refactoring task with binary pass/fail verification criteria
- The consolidated schema file (`00_cbis_full_schema.sql`) must be assembled from existing migration files to ensure accuracy
- Dashboard service stubs preserve the API contract so the controller and frontend continue to function without errors
- Checkpoints ensure incremental validation between major phases
- Each task references specific requirements for traceability
