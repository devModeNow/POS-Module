# Tasks

## Task 1: Delete HVAC-specific SQL migration files

- [x] 1.1 Delete `backend/sql/supabase/20250308_hvac_inventory.sql`
- [x] 1.2 Delete `backend/sql/supabase/20260313_serial_defect_return_fields.sql`
- [x] 1.3 Delete `backend/sql/supabase/20260329_add_previousSalesId_to_serial_numbers.sql`
- [x] 1.4 Delete `backend/sql/supabase/20260312_sales_order_project_fields.sql` (if exclusively HVAC tables)
- [x] 1.5 Delete `backend/sql/supabase/20260329_hybrid_transfer_link_so_po.sql` (if exclusively HVAC tables)

## Task 2: Clean HVAC content from combined and full-init SQL files

- [x] 2.1 Remove all HVAC table definitions (tblbranches, tblbrands, tblproducts, tblcapacity, tblcapacity_netprice_history, tblvendors, tblpurchase_orders, tblsales_order, tblinstallation, tblprocessflow, tblserial_numbers, tblso_material_items, tblso_payments, tblpo_payments, tbltransaction_product_items) from `backend/sql/supabase/all_migrations_combined.sql`
- [x] 2.2 Remove HVAC section markers and comments (e.g., "BEGIN FILE: 20250308_hvac_inventory.sql") from `all_migrations_combined.sql`
- [x] 2.3 Remove indexes referencing removed HVAC tables (idx_netprice_history_lookup, etc.) from `all_migrations_combined.sql`
- [x] 2.4 Remove HVAC table definitions from `backend/sql/supabase/20260419_full_init_with_rbac_and_superadmin.sql`
- [x] 2.5 Remove `branchId` column and its foreign key constraint from tblusers in the full init migration
- [x] 2.6 Remove foreign key constraints referencing removed HVAC tables from retained table definitions
- [x] 2.7 Remove HVAC comment headers from `backend/sql/supabase/20260310_material_inventory_enhancement.sql`

## Task 3: Delete HVAC-related frontend data files

- [x] 3.1 Delete `frontend/public/docs/DefaultHVAC-DR.pdf`
- [x] 3.2 Delete `frontend/public/docs/AirSummitDR.pdf`
- [x] 3.3 Delete `frontend/public/docs/tblcapacity_rows.json`
- [x] 3.4 Delete `frontend/public/docs/tblproducts_rows.json`
- [x] 3.5 Delete `frontend/public/docs/sales_order_daily_release_migration_rules.md`
- [x] 3.6 Delete `frontend/public/docs/sales_order_daily_release_migration_sample.csv`

## Task 4: Update backend branding and configuration

- [x] 4.1 Replace "Starting HVAC Backend..." with "Starting CBIS Backend..." in `backend/src/main.ts`
- [x] 4.2 Replace `hvac_warehouse` with `cbis` in DATABASE_URL and DB_NAME in `backend/.env.example`
- [x] 4.3 Remove or update the commented CORS line referencing `air-summit-hvac.vercel.app` in `backend/.env`
- [x] 4.4 Update CORS_ORIGINS from `air-summit-hvac.vercel.app` to the CBIS frontend URL in `backend/.env.production`

## Task 5: Update frontend branding and references

- [x] 5.1 Replace `'HVAC Warehouse and Sales'` with `'CBIS'` in `frontend/src/app/shared/services/app-title.strategy.ts`
- [x] 5.2 Replace `'HVAC Operations Command'` with `'Operations Command'` in `frontend/src/app/pages/dashboard/ecommerce/ecommerce.component.html`
- [x] 5.3 Replace `'Warehouse + Sales Hybrid Dashboard'` with `'Business Operations Dashboard'` in `frontend/src/app/pages/dashboard/ecommerce/ecommerce.component.html`
- [x] 5.4 Update `defaultDrTemplatePdf` reference in `frontend/src/app/pages/settings/settings.component.ts` to remove HVAC DR template path
- [x] 5.5 Update fallback production API URL in `frontend/src/app/shared/services/api-client.ts` from air-summit to CBIS URL
- [x] 5.6 Update logo references in `frontend/src/app/shared/layout/app-header/app-header.component.html` from air-summit-logo to CBIS logo
- [x] 5.7 Update `NG_APP_API_BASE_URL` in `frontend/.env` from air-summit URL to CBIS URL

## Task 6: Update project documentation

- [x] 6.1 Replace project title in `COPILOT.md` from "HVAC Warehouse and Sales Management System" to "CBIS - Automotive Repair Management System"
- [x] 6.2 Replace `hvac-backend.onrender.com` with `cbis-backend.onrender.com` in `DEPLOYMENT.md`

## Task 7: Verify cleanup completeness

- [x] 7.1 Run grep search for remaining HVAC/hvac references across the entire codebase (excluding .kiro/specs)
- [x] 7.2 Run grep search for remaining references to removed HVAC tables (tblcapacity, tblproducts, tblbrands, tblvendors, tblinstallation, tblprocessflow)
- [x] 7.3 Verify backend compiles successfully with `npm run build`
- [x] 7.4 Verify frontend compiles successfully with `ng build` or equivalent
- [x] 7.5 Confirm no broken imports or module references exist in TypeScript files
