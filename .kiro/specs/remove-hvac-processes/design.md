# Design Document

## Overview

This design describes the implementation approach for removing all HVAC-related processes, SQL files, branding, and code references from the CBIS codebase. The cleanup is a file deletion and text replacement operation with no new feature logic required.

## Architecture

This is a codebase cleanup operation. No new modules, services, or components are introduced. The work consists of:

1. **File deletions** — Removing HVAC-specific SQL migrations and data files
2. **File edits** — Removing HVAC table definitions from combined/shared SQL files
3. **Text replacements** — Updating branding strings from HVAC to CBIS/automotive
4. **Configuration updates** — Updating environment variables and deployment references

## Implementation Details

### 1. SQL Migration Cleanup

**Files to delete entirely:**
- `backend/sql/supabase/20250308_hvac_inventory.sql` — The original HVAC inventory schema
- `backend/sql/supabase/20260313_serial_defect_return_fields.sql` — Modifies HVAC-only tblserial_numbers
- `backend/sql/supabase/20260329_add_previousSalesId_to_serial_numbers.sql` — Modifies HVAC-only tblserial_numbers

**Files to edit (remove HVAC sections):**
- `backend/sql/supabase/all_migrations_combined.sql` — Remove all HVAC table definitions, their indexes, and section markers
- `backend/sql/supabase/20260419_full_init_with_rbac_and_superadmin.sql` — Remove HVAC table definitions and foreign key references to removed tables
- `backend/sql/supabase/20260312_sales_order_project_fields.sql` — Remove if exclusively HVAC; otherwise remove only HVAC-specific ALTER statements
- `backend/sql/supabase/20260329_hybrid_transfer_link_so_po.sql` — Remove if exclusively HVAC; otherwise remove only HVAC-specific ALTER statements
- `backend/sql/supabase/20260310_material_inventory_enhancement.sql` — Remove HVAC comment headers

**HVAC tables to remove (defined in 20250308_hvac_inventory.sql):**
- tblbranches, tblbrands, tblproducts, tblcapacity, tblcapacity_netprice_history
- tblvendors, tblpurchase_orders, tblsales_order, tblinstallation, tblprocessflow
- tblserial_numbers, tblso_material_items, tblso_payments, tblpo_payments
- tbltransaction_product_items

**Tables to retain (automotive inventory):**
- tblinventory, tblpurchases, tblpo_items, tblsuppliers
- tblorganizations, tblquotation, tbljob_orders, tblcustomers
- tblusers, tblrbac, tblsettings

**Retained table cleanup:**
- Remove `branchId` column and its foreign key from tblusers definition in full init migration (references removed tblbranches)

### 2. Frontend Data File Cleanup

**Files to delete:**
- `frontend/public/docs/DefaultHVAC-DR.pdf` — HVAC-specific delivery receipt template
- `frontend/public/docs/tblcapacity_rows.json` — HVAC capacity sample data
- `frontend/public/docs/tblproducts_rows.json` — HVAC products sample data
- `frontend/public/docs/sales_order_daily_release_migration_rules.md` — HVAC sales order migration docs
- `frontend/public/docs/sales_order_daily_release_migration_sample.csv` — HVAC sales order sample data
- `frontend/public/docs/AirSummitDR.pdf` — Air Summit (HVAC brand) delivery receipt

### 3. Frontend Branding Updates

**Text replacements:**
- `frontend/src/app/shared/services/app-title.strategy.ts`: Change `'HVAC Warehouse and Sales'` → `'CBIS'`
- `frontend/src/app/pages/dashboard/ecommerce/ecommerce.component.html`: Change `'HVAC Operations Command'` → `'Operations Command'`
- `frontend/src/app/pages/dashboard/ecommerce/ecommerce.component.html`: Change `'Warehouse + Sales Hybrid Dashboard'` → `'Business Operations Dashboard'`
- `frontend/src/app/pages/settings/settings.component.ts`: Update `defaultDrTemplatePdf` path from `'/docs/DefaultHVAC-DR.pdf'` to a generic path or remove the reference

### 4. Backend Branding Updates

**Text replacements:**
- `backend/src/main.ts`: Change `'Starting HVAC Backend...'` → `'Starting CBIS Backend...'`
- `backend/.env.example`: Change `hvac_warehouse` → `cbis` in DATABASE_URL and DB_NAME

### 5. Configuration and Deployment Updates

**Environment files:**
- `backend/.env`: Remove commented CORS line referencing `air-summit-hvac.vercel.app`
- `backend/.env.production`: Update CORS_ORIGINS from `air-summit-hvac.vercel.app` to the actual CBIS frontend URL (or remove if no longer deployed there)

**Documentation:**
- `COPILOT.md`: Change title from "HVAC Warehouse and Sales Management System" to "CBIS - Automotive Repair Management System"
- `DEPLOYMENT.md`: Replace `hvac-backend.onrender.com` with `cbis-backend.onrender.com`

### 6. Frontend API and Logo References

**Files to update:**
- `frontend/src/app/shared/services/api-client.ts`: Update fallback production URL from `air-summit-backend-ewbho.ondigitalocean.app` to the current CBIS backend URL
- `frontend/src/app/shared/layout/app-header/app-header.component.html`: Update logo image references from `air-summit-logo.png` to the CBIS logo (if available)
- `frontend/.env`: Update `NG_APP_API_BASE_URL` from air-summit URL to CBIS URL

## Risk Assessment

- **Low risk**: File deletions and text replacements are straightforward and reversible via git
- **Medium risk**: Editing `all_migrations_combined.sql` and `20260419_full_init_with_rbac_and_superadmin.sql` requires careful identification of HVAC vs automotive table boundaries
- **No runtime risk**: The HVAC tables are not referenced by any active backend module (app.module.ts shows no HVAC-related imports)

## Verification Strategy

1. After deletions, run `grep -r "hvac\|HVAC\|tblcapacity\|tblproducts\|tblbrands\|tblvendors\|tblinstallation\|tblprocessflow" .` to confirm no remaining references
2. Verify the backend compiles: `cd backend && npm run build`
3. Verify the frontend compiles: `cd frontend && ng build`
4. Confirm no broken imports or references in TypeScript files
