# Requirements Document

## Introduction

This feature consolidates and cleans up the SQL migration files in `backend/sql/supabase/` following the HVAC removal. The goal is to remove orphaned migration files that reference non-existent HVAC tables, create a single coherent migration representing the current CBIS database schema, and fix the `dashboard.service.ts` which still contains runtime SQL queries against removed HVAC tables (tblserial_numbers, tblpurchase_orders, tblsales_order, tblproducts, tblcapacity, tblbrands, tblvendors, tbltransaction_product_items, tblso_payments).

## Glossary

- **CBIS**: Centralized Business Information System — the automotive-focused platform replacing the former HVAC system
- **Migration_Directory**: The directory `backend/sql/supabase/` containing all SQL migration files
- **HVAC_Tables**: The removed database tables: tblserial_numbers, tblpurchase_orders, tblsales_order, tblproducts, tblcapacity, tblbrands, tblvendors, tbltransaction_product_items, tblso_payments, tblpo_payments, tblbranches, tblinstallation, tblprocessflow, tblso_material_items, tblcapacity_netprice_history
- **Retained_Tables**: The active database tables that remain in the CBIS system: tblrbac, tblusers, tblcustomer, tblsettings, auth_permission_keys, auth_role_permissions, auth_user_permission_overrides, auth_user_roles, auth_menus, tblquotation, tblquotation_items, tblmaterials, tblmaterial_price_history, tbltransaction_material_items, tblproject_details, tblservice_details, tblconcern_details, tbltransfer_details, tblexpense_details, tblcustomer_payments, tblstatement_of_account, tblcheque_voucher, tblgeneral_journal, tbljournal_entry_lines, tbltax_2307, tblaudit_log, tblaudit_logs, tblorganizations, tblorg_settings, tblorg_menus, tblmaterial_items, tblproduct_capacity_material_map, tblmaterial_stock_balance, tblmaterial_stock_movement, tblaccount_titles, tblcheque_vouchers, tblcheque_voucher_deposits, tblcheque_voucher_invoices, tblcheque_voucher_account_titles, tblaccounting_report_print_settings, tblprojects, tblpo_payments
- **Orphaned_Migration**: A migration file whose primary purpose is to modify or reference HVAC_Tables that no longer exist
- **Dashboard_Service**: The file `backend/src/dashboard/dashboard.service.ts` containing runtime SQL queries
- **Consolidated_Migration**: A single SQL file representing the complete current database schema for a fresh CBIS deployment

## Requirements

### Requirement 1: Remove Orphaned Migration Files

**User Story:** As a developer, I want orphaned migration files that exclusively reference removed HVAC tables to be deleted, so that the migration directory only contains relevant and executable migrations.

#### Acceptance Criteria

1. WHEN the cleanup is performed, THE Migration_Directory SHALL NOT contain the file `20260318_backfill_branchid.sql` (references tblpurchase_orders and tblsales_order exclusively)
2. WHEN the cleanup is performed, THE Migration_Directory SHALL NOT contain the file `20260309_quotation_quote_no_auto.sql` (duplicated content already in 20260308_quotation_feature.sql and all_migrations_combined.sql)
3. WHEN the cleanup is performed, THE Migration_Directory SHALL NOT contain the file `run_phase1_migration.js` (contains hardcoded database credentials and is a one-time execution script)
4. WHEN the cleanup is performed, THE Migration_Directory SHALL NOT contain the file `all_migrations_combined.sql` (superseded by the new Consolidated_Migration)

### Requirement 2: Clean Up Migration Files with HVAC Remnants

**User Story:** As a developer, I want migration files that contain a mix of valid and HVAC-specific content to be cleaned of HVAC references, so that all remaining migrations are self-consistent and executable.

#### Acceptance Criteria

1. WHEN the cleanup is performed, THE file `20260310_material_inventory_enhancement.sql` SHALL NOT contain references to tblpurchase_orders, tblsales_order, tblso_payments, or tblbrands in active code or comments that imply those tables exist
2. WHEN the cleanup is performed, THE file `20260310_material_inventory_enhancement.sql` SHALL retain all Retained_Tables definitions (tblmaterials, tblmaterial_price_history, tbltransaction_material_items, tblproject_details, tblservice_details, tblconcern_details, tbltransfer_details, tblexpense_details, tblcustomer_payments, tblstatement_of_account, tblcheque_voucher, tblgeneral_journal, tbljournal_entry_lines, tbltax_2307, tblaudit_log)
3. WHEN the cleanup is performed, THE file `20260310_material_inventory_enhancement.sql` SHALL NOT contain orphaned trigger functions that reference removed tables (update_material_stock_on_po_approval, update_customer_balance_on_sales, update_customer_balance_on_so_payment)
4. WHEN the cleanup is performed, THE file `20260401_project_master_table.sql` SHALL NOT contain the ALTER TABLE statement adding project_id to tblsales_order (table no longer exists)
5. WHEN the cleanup is performed, THE file `20260317_po_payment_bank_cheque_fields.sql` SHALL remain unchanged (tblpo_payments is a Retained_Table)

### Requirement 3: Create Consolidated Database Schema Migration

**User Story:** As a developer, I want a single consolidated migration file that represents the complete current CBIS database schema, so that new deployments can be initialized with one idempotent script.

#### Acceptance Criteria

1. THE Consolidated_Migration SHALL be created at the path `backend/sql/supabase/00_cbis_full_schema.sql`
2. THE Consolidated_Migration SHALL contain CREATE TABLE IF NOT EXISTS statements for all Retained_Tables
3. THE Consolidated_Migration SHALL contain all indexes, constraints, triggers, and functions required by the Retained_Tables
4. THE Consolidated_Migration SHALL contain seed data for default roles (superadmin, platform_admin, org_admin, org_staff), the default organization (Car Expert Auto Repair), default menus, and default permission keys
5. THE Consolidated_Migration SHALL be idempotent (safe to run multiple times without errors or duplicate data)
6. THE Consolidated_Migration SHALL NOT contain any references to HVAC_Tables
7. THE Consolidated_Migration SHALL include the tblorganizations, tblorg_settings, and tblorg_menus tables from the CBIS Phase 1 foundation

### Requirement 4: Fix Dashboard Service HVAC Table References

**User Story:** As a developer, I want the Dashboard_Service to stop querying removed HVAC tables at runtime, so that the dashboard endpoint does not produce SQL errors against non-existent tables.

#### Acceptance Criteria

1. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tblserial_numbers
2. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tblpurchase_orders
3. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tblsales_order
4. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tblproducts
5. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tblcapacity
6. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tblbrands
7. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tblvendors
8. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tbltransaction_product_items
9. WHEN the cleanup is performed, THE Dashboard_Service SHALL NOT contain SQL queries referencing tblso_payments
10. WHEN the cleanup is performed, THE Dashboard_Service SHALL retain the `getPlatformStats()` method (queries tblorganizations and tblusers which are Retained_Tables)
11. WHEN the cleanup is performed, THE Dashboard_Service SHALL replace the `getOverview()` method with a stub that returns a success response with empty/placeholder dashboard data
12. WHEN the cleanup is performed, THE Dashboard_Service SHALL replace the `getSalesDetail()` method with a stub that returns a success response with an empty items array
13. WHEN the cleanup is performed, THE Dashboard_Service SHALL remove or stub all private helper methods that exclusively support HVAC-based queries (getSalesDashboardBaseCte, insertSalesPaymentRecord, updateSalesOrderStatusForSettlement, loadSalesSettlementState, getSalesSettlementAuditSnapshot, getSettledSalesPredicate, getRecordedSalesPredicate, getRecordedSalesAmountExpression, getOpenBalancePredicate)

### Requirement 5: Maintain Backend Compilation

**User Story:** As a developer, I want the backend to compile successfully after all cleanup changes, so that the application remains deployable.

#### Acceptance Criteria

1. WHEN all cleanup changes are applied, THE backend SHALL compile without TypeScript errors using `npm run build`
2. WHEN all cleanup changes are applied, THE Dashboard_Service SHALL export the same public method signatures (getPlatformStats, getOverview, getSalesDetail) to avoid breaking the dashboard controller
