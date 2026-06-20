# Design Document: SQL Supabase Cleanup

## Overview

This feature performs a targeted cleanup of the `backend/sql/supabase/` migration directory and the `dashboard.service.ts` file following the removal of the HVAC system. The CBIS platform has transitioned from an HVAC-focused system to an automotive-focused platform, but several migration files and runtime queries still reference removed HVAC tables (tblserial_numbers, tblpurchase_orders, tblsales_order, tblproducts, tblcapacity, tblbrands, tblvendors, tbltransaction_product_items, tblso_payments, etc.).

The cleanup involves four coordinated activities:
1. **Delete** orphaned migration files that exclusively reference removed tables
2. **Edit** migration files that mix valid and HVAC-specific content
3. **Create** a single consolidated schema migration for fresh deployments
4. **Refactor** the dashboard service to remove HVAC table queries and replace them with stubs

## Architecture

The changes are purely structural — no new runtime components, services, or modules are introduced. The architecture remains unchanged:

```
┌─────────────────────────────────────────────────────┐
│  NestJS Backend                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │ DashboardController                            │  │
│  │   GET /dashboard/platform-stats  ──────────┐  │  │
│  │   GET /dashboard/overview  ────────────────┐│  │  │
│  │   GET /dashboard/sales-detail  ────────────┤│  │  │
│  │   GET /dashboard/operations-detail  ───────┤│  │  │
│  │   POST /dashboard/settle-sales-order  ─────┤│  │  │
│  │   POST /dashboard/verify-receivable  ──────┤│  │  │
│  └────────────────────────────────────────────┤│──┘  │
│                                               ││     │
│  ┌───────────────────────────────────────────┐││     │
│  │ DashboardService                          │││     │
│  │   getPlatformStats() ← RETAINED (queries  │◄┘     │
│  │                         tblorganizations,  │      │
│  │                         tblusers)          │      │
│  │   getOverview() ← STUBBED                 │◄─────│
│  │   getSalesDetail() ← STUBBED              │      │
│  │   getOperationsDetail() ← STUBBED         │      │
│  │   settleSalesOrder() ← STUBBED            │      │
│  │   verifySalesReceivable() ← STUBBED       │      │
│  └───────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  backend/sql/supabase/                               │
│                                                      │
│  00_cbis_full_schema.sql  ← NEW consolidated file    │
│  20260307_rbac_normalization.sql  ← unchanged        │
│  20260308_quotation_feature.sql  ← unchanged         │
│  20260309_material_inventory_ledger.sql ← unchanged  │
│  20260310_material_inventory_enhancement.sql ← EDIT  │
│  20260317_po_payment_bank_cheque_fields.sql ← unch.  │
│  20260318_quotation_terms_conditions.sql ← unchanged │
│  20260318_settings_report_assets.sql ← unchanged     │
│  20260320_quotation_expiry.sql ← unchanged           │
│  20260322_business_owner_accounting_rbac.sql ← unch. │
│  20260323_accounting_cheque_voucher_live.sql ← unch. │
│  20260323_audit_logs.sql ← unchanged                 │
│  20260323_cheque_voucher_prepared_by.sql ← unchanged │
│  20260327_* ← unchanged                             │
│  20260331_concern_status_constraint_update.sql ← un. │
│  20260401_project_master_table.sql ← EDIT            │
│  20260418_projects_rbac_permissions.sql ← unchanged  │
│  20260419_full_init_with_rbac_and_superadmin.sql ← u.│
│  phase1_cbis_foundation.sql ← unchanged              │
│                                                      │
│  DELETED:                                            │
│  - 20260318_backfill_branchid.sql                    │
│  - 20260309_quotation_quote_no_auto.sql              │
│  - run_phase1_migration.js                           │
│  - all_migrations_combined.sql                       │
└─────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. File Deletion (Requirement 1)

Four files are deleted outright:

| File | Reason |
|------|--------|
| `20260318_backfill_branchid.sql` | Exclusively references tblpurchase_orders and tblsales_order |
| `20260309_quotation_quote_no_auto.sql` | Duplicate of logic already in 20260308_quotation_feature.sql |
| `run_phase1_migration.js` | One-time script with hardcoded credentials |
| `all_migrations_combined.sql` | Superseded by new 00_cbis_full_schema.sql |

### 2. Migration File Edits (Requirement 2)

#### 2a. `20260310_material_inventory_enhancement.sql`

**Remove:**
- Section 1 comments about tblbrands (already marked removed, but clean up residual text)
- Section 4 comments about tblpurchase_orders (already marked removed)
- Section 18 comments about tblso_payments (already marked removed)
- Orphaned trigger functions:
  - `update_material_stock_on_po_approval()` — references tblpurchase_orders
  - `update_customer_balance_on_sales()` — references tblsales_order
  - `update_customer_balance_on_so_payment()` — references tblso_payments
- The `recalc_customer_balance()` function body that references removed tables (retain the function signature with a no-op body or remove entirely)
- All commented-out trigger creation statements for removed tables

**Retain:**
- All CREATE TABLE statements for retained tables (tblmaterials, tblmaterial_price_history, tbltransaction_material_items, tblproject_details, tblservice_details, tblconcern_details, tbltransfer_details, tblexpense_details, tblcustomer_payments, tblstatement_of_account, tblcheque_voucher, tblgeneral_journal, tbljournal_entry_lines, tbltax_2307, tblaudit_log)
- All indexes and constraints for retained tables
- The `update_customer_balance_on_customer_payment()` function and its trigger on tblcustomer_payments (this references only tblcustomer_payments which is retained)
- Customer enhancement columns (ALTER TABLE tblcustomer)

#### 2b. `20260401_project_master_table.sql`

**Remove:**
- The `ALTER TABLE public.tblsales_order ADD COLUMN IF NOT EXISTS project_id ...` statement (tblsales_order no longer exists)
- The `CREATE INDEX IF NOT EXISTS idx_tblsales_order_project_id ...` statement

**Retain:**
- The `CREATE TABLE IF NOT EXISTS public.tblprojects` statement and all its indexes
- The timestamp trigger setup for tblprojects
- The table comment

### 3. Consolidated Schema Migration (Requirement 3)

A new file `backend/sql/supabase/00_cbis_full_schema.sql` is created containing the complete current CBIS schema. This file is idempotent (uses `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, etc.).

**Structure of 00_cbis_full_schema.sql:**

```sql
-- =============================================================================
-- CBIS Full Schema Migration
-- Centralized Business Information System - Complete Database Schema
-- Idempotent: safe to run multiple times
-- =============================================================================

BEGIN;

-- Section 1: Core Tables (RBAC & Users)
--   tblrbac, tblusers, auth_permission_keys, auth_role_permissions,
--   auth_user_permission_overrides, auth_user_roles, auth_menus

-- Section 2: Organization Tables (Multi-tenant)
--   tblorganizations, tblorg_settings, tblorg_menus

-- Section 3: Customer Management
--   tblcustomer (with enhancement columns)

-- Section 4: Quotation Feature
--   tblquotation, tblquotation_items

-- Section 5: Material Inventory
--   tblmaterials, tblmaterial_price_history, tbltransaction_material_items

-- Section 6: Project & Service Management
--   tblprojects, tblproject_details, tblservice_details,
--   tblconcern_details, tbltransfer_details, tblexpense_details

-- Section 7: Customer Payments & SOA
--   tblcustomer_payments, tblstatement_of_account

-- Section 8: Accounting
--   tblcheque_voucher, tblgeneral_journal, tbljournal_entry_lines,
--   tbltax_2307, tblpo_payments

-- Section 9: Audit & Settings
--   tblaudit_log, tblaudit_logs, tblsettings,
--   tblaccounting_report_print_settings

-- Section 10: Functions & Triggers
--   set_current_timestamp_updated_at()
--   tblquotation_set_quote_no()
--   update_customer_balance_on_customer_payment()

-- Section 11: Indexes

-- Section 12: Seed Data
--   Default roles (superadmin, platform_admin, org_admin, org_staff)
--   Default organization (Car Expert Auto Repair)
--   Default menus
--   Default permission keys
--   Default superadmin user

COMMIT;
```

**Design decisions:**
- The file uses `00_` prefix to sort first alphabetically, indicating it's the base schema
- All statements use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` for idempotency
- Seed data uses `ON CONFLICT DO NOTHING` to avoid duplicates
- Sequences are reset using `SELECT setval(...)` after seed inserts
- No references to any HVAC tables appear anywhere in the file

### 4. Dashboard Service Refactoring (Requirement 4)

The `dashboard.service.ts` file is rewritten to:

**Retain as-is:**
- `getPlatformStats()` — queries only tblorganizations and tblusers (both retained)
- Type definitions that are still used (AuditActorContext for the controller interface)
- Private utility methods: `toNumber()`, `formatInteger()`, `formatCurrency()`, `formatPercent()`, `formatActivityTime()`

**Replace with stubs:**

```typescript
async getOverview(branchId?: number): Promise<DashboardResponse> {
  return {
    success: true,
    item: {
      generatedAt: new Date().toISOString(),
      topKpis: [],
      operations: [],
      salesSummary: [],
      topCustomers: [],
      topCapacities: [],
      marginByBrand: [],
      marginByVendor: [],
      activityFeed: [],
      todayFocus: 'Dashboard data sources are being migrated',
    },
  };
}

async getSalesDetail(
  mode: DashboardSalesDetailMode,
  branchId?: number,
): Promise<{ success: boolean; items: unknown[] }> {
  return { success: true, items: [] };
}

async getOperationsDetail(
  mode: DashboardOperationDetailMode,
  branchId?: number,
): Promise<{ success: boolean; items: unknown[] }> {
  return { success: true, items: [] };
}

async settleSalesOrder(
  payload: {
    salesOrderId?: number;
    mode?: DashboardSettlementMode;
    amount?: number;
    bankAmount?: number;
    chequeAmount?: number;
    bankName?: string | null;
    checkNo?: string | null;
    postDated?: string | null;
  },
  branchId?: number,
  auditActor?: AuditActorContext,
): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: 'Sales settlement is temporarily unavailable during migration',
  };
}

async verifySalesReceivable(
  payload: { paymentId?: number; method?: DashboardReceivableVerificationMode },
  branchId?: number,
): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: 'Receivable verification is temporarily unavailable during migration',
  };
}
```

**Remove entirely:**
- `getSalesDashboardBaseCte()` — builds CTE referencing tblso_payments, tblsales_order
- `insertSalesPaymentRecord()` — inserts into tblso_payments
- `updateSalesOrderStatusForSettlement()` — updates tblsales_order
- `loadSalesSettlementState()` — queries tblso_payments, tblsales_order
- `getSalesSettlementAuditSnapshot()` — queries tblso_payments, tblsales_order
- `getSettledSalesPredicate()` — builds SQL predicates for HVAC queries
- `getRecordedSalesPredicate()` — builds SQL predicates for HVAC queries
- `getRecordedSalesAmountExpression()` — builds SQL expressions for HVAC queries
- `getOpenBalancePredicate()` — builds SQL predicates for HVAC queries
- `buildDelta()` — only used by getOverview's HVAC queries
- `normalizeStatus()` — only used by HVAC settlement logic
- `getTableColumns()` — only used by HVAC payment insertion
- `pickColumn()` — only used by HVAC payment insertion
- `toIsoDateOrNull()` — only used by HVAC settlement logic

**Remove type definitions no longer needed:**
- `CountRow`, `SalesRow`, `GrossMarginRow`, `ReceivableRow`, `TopCustomerRow`, `TopCapacityRow`, `MarginRow`, `ActivityRow`, `SalesFinancialSummaryRow`, `SalesSettlementStateRow`

**Retain type definitions (used by stub signatures or controller):**
- `AuditActorContext`, `Trend`, `KpiCard`, `OpsLevel`, `OpsItem`, `MarginItem`, `ActivityItem`, `DashboardResponse`, `DashboardSalesDetailMode`, `DashboardOperationDetailMode`, `DashboardSettlementMode`, `DashboardReceivableVerificationMode`

## Data Models

No data model changes are introduced. The retained tables remain as defined in the existing migrations. The consolidated schema file documents the current state of all retained tables without modification.

**Retained table summary (grouped by domain):**

| Domain | Tables |
|--------|--------|
| Auth/RBAC | tblrbac, tblusers, auth_permission_keys, auth_role_permissions, auth_user_permission_overrides, auth_user_roles, auth_menus |
| Organizations | tblorganizations, tblorg_settings, tblorg_menus |
| Customers | tblcustomer, tblcustomer_payments, tblstatement_of_account |
| Quotations | tblquotation, tblquotation_items |
| Materials | tblmaterials, tblmaterial_price_history, tbltransaction_material_items |
| Projects/Services | tblprojects, tblproject_details, tblservice_details, tblconcern_details, tbltransfer_details, tblexpense_details |
| Accounting | tblcheque_voucher, tblgeneral_journal, tbljournal_entry_lines, tbltax_2307, tblpo_payments, tblaccount_titles, tblcheque_vouchers, tblcheque_voucher_deposits, tblcheque_voucher_invoices, tblcheque_voucher_account_titles, tblaccounting_report_print_settings |
| Audit/Settings | tblaudit_log, tblaudit_logs, tblsettings |
| Material Stock | tblmaterial_items, tblproduct_capacity_material_map, tblmaterial_stock_balance, tblmaterial_stock_movement |

## Error Handling

### Dashboard Service Stubs

- `getOverview()` returns `{ success: true, item: { ... empty arrays ... } }` — no error thrown
- `getSalesDetail()` returns `{ success: true, items: [] }` — no error thrown
- `getOperationsDetail()` returns `{ success: true, items: [] }` — no error thrown
- `settleSalesOrder()` returns `{ success: false, message: '...' }` — graceful refusal, no exception
- `verifySalesReceivable()` returns `{ success: false, message: '...' }` — graceful refusal, no exception

This approach ensures:
1. The frontend receives valid JSON responses (no 500 errors)
2. The controller does not need modification
3. The API contract is preserved (same response shape)

### Migration File Safety

- The consolidated schema uses `IF NOT EXISTS` and `ON CONFLICT DO NOTHING` throughout
- Running it against an existing database with data is safe (no data loss)
- Running it against a fresh database creates the complete schema

## Testing Strategy

### Why Property-Based Testing Does Not Apply

This feature is a code cleanup and refactoring task. The acceptance criteria are about:
- File existence/absence (binary checks)
- String content absence (specific table names should not appear)
- TypeScript compilation success (pass/fail)
- Method signature preservation (structural check)

There are no pure functions with variable inputs, no parsers, no serializers, and no business logic transformations being introduced. All criteria are best verified with example-based checks.

### Verification Approach

**1. File Deletion Verification (Requirement 1)**
- Confirm the four orphaned files no longer exist in `backend/sql/supabase/`
- Unit test: assert file paths do not resolve

**2. Migration Content Verification (Requirement 2)**
- Grep/search the edited migration files for HVAC table names
- Confirm retained table definitions are still present
- Run the edited SQL files against a fresh PostgreSQL instance (integration test)

**3. Consolidated Schema Verification (Requirement 3)**
- Confirm `00_cbis_full_schema.sql` exists
- Confirm it contains CREATE TABLE statements for all retained tables
- Confirm no HVAC table names appear
- Run the file against a fresh PostgreSQL instance to verify it executes without errors (integration test)
- Run it twice to verify idempotency (integration test)

**4. Dashboard Service Verification (Requirement 4)**
- Grep the refactored file for HVAC table names (should find none)
- Confirm `getPlatformStats()` is unchanged
- Confirm stub methods return expected shapes
- TypeScript compilation (`npm run build`) passes

**5. Backend Compilation (Requirement 5)**
- Run `npm run build` in the backend directory
- Confirm zero TypeScript errors
- Confirm the dashboard controller can still reference all public methods

### Test Commands

```bash
# Primary verification: backend compiles
cd backend && npm run build

# Content verification: no HVAC references in dashboard service
grep -c "tblserial_numbers\|tblpurchase_orders\|tblsales_order\|tblproducts\|tblcapacity\|tblbrands\|tblvendors\|tbltransaction_product_items\|tblso_payments" src/dashboard/dashboard.service.ts
# Expected: 0

# File deletion verification
ls backend/sql/supabase/20260318_backfill_branchid.sql 2>&1  # should not exist
ls backend/sql/supabase/20260309_quotation_quote_no_auto.sql 2>&1  # should not exist
ls backend/sql/supabase/run_phase1_migration.js 2>&1  # should not exist
ls backend/sql/supabase/all_migrations_combined.sql 2>&1  # should not exist

# Consolidated schema exists
ls backend/sql/supabase/00_cbis_full_schema.sql  # should exist
```
