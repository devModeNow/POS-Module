# Requirements Document

## Introduction

This document defines the requirements for removing all HVAC (Heating, Ventilation, and Air Conditioning) related processes, database artifacts, code references, and branding from the CBIS (Centralized Business Information System) codebase. The system was originally built as an HVAC Warehouse and Sales Management System and is being refocused exclusively on automotive repair services. All HVAC-specific database tables, SQL migrations, naming conventions, and UI references must be removed or replaced with automotive-appropriate alternatives.

## Glossary

- **CBIS**: Centralized Business Information System — the target platform focused on automotive repair services
- **HVAC_Migration**: The SQL migration file `20250308_hvac_inventory.sql` containing HVAC-specific table definitions (tblproducts, tblcapacity, tblbrands, tblvendors, tblpurchase_orders, tblsales_order, tblinstallation, tblprocessflow, tblserial_numbers, tblso_material_items, tblso_payments, tblpo_payments, tbltransaction_product_items, tblcapacity_netprice_history)
- **Combined_Migration**: The file `all_migrations_combined.sql` which aggregates all migrations including HVAC content
- **Cleanup_Scope**: All files, references, table definitions, comments, and naming that are specific to HVAC operations and not reused by the current automotive-focused modules
- **Automotive_Inventory**: The current inventory system using `tblinventory`, `tblpurchases`, `tblpo_items`, and `tblsuppliers` tables that serve the automotive repair workflow

## Requirements

### Requirement 1: Remove HVAC SQL Migration File

**User Story:** As a developer, I want the HVAC-specific SQL migration file removed from the codebase, so that the project no longer contains database schemas for HVAC inventory management.

#### Acceptance Criteria

1. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include deletion of the file `backend/sql/supabase/20250308_hvac_inventory.sql`
2. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal of all HVAC-originated table definitions (tblproducts, tblcapacity, tblbrands, tblvendors, tblpurchase_orders, tblsales_order, tblinstallation, tblprocessflow, tblserial_numbers, tblso_material_items, tblso_payments, tblpo_payments, tbltransaction_product_items, tblcapacity_netprice_history) from `all_migrations_combined.sql`
3. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal of the HVAC section markers and comments (e.g., "BEGIN FILE: 20250308_hvac_inventory.sql", "END FILE: 20250308_hvac_inventory.sql") from `all_migrations_combined.sql`

### Requirement 2: Remove HVAC References from Combined Migration

**User Story:** As a developer, I want the combined migration file cleaned of HVAC-specific table references, so that only automotive-relevant schemas remain.

#### Acceptance Criteria

1. WHEN the cleanup is executed, THE Combined_Migration SHALL retain all tables and indexes used by the current automotive modules (tblinventory, tblpurchases, tblpo_items, tblsuppliers, tblorganizations, tblquotation, tbljob_orders, tblcustomers)
2. WHEN the cleanup is executed, THE Combined_Migration SHALL remove comments referencing HVAC products (e.g., "AC unit products")
3. WHEN the cleanup is executed, THE Combined_Migration SHALL remove indexes that reference removed HVAC tables (e.g., idx_netprice_history_lookup, idx_tblpurchase_orders_po_type, idx_tblsales_order_created_by, idx_tblpurchase_orders_created_by)
4. WHEN the cleanup is executed, THE Combined_Migration SHALL remove foreign key references from retained tables that point to removed HVAC tables

### Requirement 3: Remove HVAC References from Other SQL Migrations

**User Story:** As a developer, I want all SQL migration files that exclusively modify HVAC tables removed or cleaned, so that no orphaned migration logic remains.

#### Acceptance Criteria

1. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal or cleanup of `backend/sql/supabase/20260313_serial_defect_return_fields.sql` which modifies the HVAC-specific tblserial_numbers table
2. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal or cleanup of `backend/sql/supabase/20260329_add_previousSalesId_to_serial_numbers.sql` which modifies the HVAC-specific tblserial_numbers table
3. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal of the HVAC comment header from `backend/sql/supabase/20260310_material_inventory_enhancement.sql`
4. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal or cleanup of `backend/sql/supabase/20260312_sales_order_project_fields.sql` if it exclusively references HVAC tables
5. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal or cleanup of `backend/sql/supabase/20260329_hybrid_transfer_link_so_po.sql` if it exclusively references HVAC tables

### Requirement 4: Remove HVAC Branding from Backend

**User Story:** As a developer, I want all HVAC naming and branding removed from the backend, so that the system identifies as an automotive repair platform.

#### Acceptance Criteria

1. WHEN the cleanup is executed, THE CBIS SHALL replace the startup message in `backend/src/main.ts` from "Starting HVAC Backend..." to "Starting CBIS Backend..."
2. WHEN the cleanup is executed, THE CBIS SHALL replace the database name reference in `backend/.env.example` from "hvac_warehouse" to "cbis"
3. WHEN the cleanup is executed, THE CBIS SHALL remove or replace all HVAC naming in `backend/.env.example` DB_NAME field

### Requirement 5: Remove HVAC Branding from Frontend

**User Story:** As a developer, I want all HVAC naming and branding removed from the frontend, so that users see automotive-appropriate labels.

#### Acceptance Criteria

1. WHEN the cleanup is executed, THE CBIS SHALL replace the default browser tab title in `frontend/src/app/shared/services/app-title.strategy.ts` from "HVAC Warehouse and Sales" to "CBIS"
2. WHEN the cleanup is executed, THE CBIS SHALL replace the dashboard header text in `frontend/src/app/pages/dashboard/ecommerce/ecommerce.component.html` from "HVAC Operations Command" to "Operations Command"
3. WHEN the cleanup is executed, THE CBIS SHALL rename or remove the HVAC-specific DR template reference (`DefaultHVAC-DR.pdf`) in `frontend/src/app/pages/settings/settings.component.ts`

### Requirement 6: Remove HVAC References from Documentation

**User Story:** As a developer, I want project documentation updated to reflect the automotive focus, so that new contributors understand the system purpose.

#### Acceptance Criteria

1. WHEN the cleanup is executed, THE CBIS SHALL replace the project title in `COPILOT.md` from "HVAC Warehouse and Sales Management System" to "CBIS - Automotive Repair Management System"
2. WHEN the cleanup is executed, THE CBIS SHALL replace HVAC backend URL examples in `DEPLOYMENT.md` from "hvac-backend.onrender.com" to "cbis-backend.onrender.com"

### Requirement 7: Remove HVAC-Specific Full Init Migration

**User Story:** As a developer, I want the full initialization migration cleaned of HVAC table definitions, so that fresh database setups only create automotive-relevant tables.

#### Acceptance Criteria

1. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal of HVAC-specific table definitions (tblbranches, tblbrands, tblproducts, tblcapacity, tblvendors, tblpurchase_orders, tblinstallation, tblprocessflow, tblserial_numbers, tblsales_order, tblso_material_items, tblso_payments, tblpo_payments, tbltransaction_product_items, tblcapacity_netprice_history) from `backend/sql/supabase/20260419_full_init_with_rbac_and_superadmin.sql`
2. WHEN the cleanup is executed, THE Cleanup_Scope SHALL include removal of foreign key constraints referencing removed HVAC tables (e.g., tblusers.branchId referencing tblbranches) from the full init migration
3. IF a retained table (e.g., tblusers) has a column referencing a removed HVAC table, THEN THE Cleanup_Scope SHALL remove that column and its constraint from the retained table definition

### Requirement 8: Preserve Automotive Inventory System Integrity

**User Story:** As a developer, I want the current automotive inventory system to remain fully functional after HVAC removal, so that no regressions are introduced.

#### Acceptance Criteria

1. THE Automotive_Inventory tables (tblinventory, tblpurchases, tblpo_items, tblsuppliers) SHALL remain unchanged after the cleanup
2. THE CBIS backend inventory service (`backend/src/inventory/inventory.service.ts`) SHALL continue to function without modification
3. THE CBIS frontend inventory module SHALL continue to function without modification
4. IF any migration file contains both HVAC-specific and automotive-relevant content, THEN THE Cleanup_Scope SHALL preserve the automotive-relevant content while removing only the HVAC-specific content
