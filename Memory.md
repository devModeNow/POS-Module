# Memory.md — POS Module (sts-incorporated-cbis)

Living notes for agents continuing this repo. Prefer this file over re-reading long transcripts.

## Stack
- Frontend: Angular (ng-tailadmin) under `frontend/`
- Backend: NestJS under `backend/`
- POS org roles: cashier vs non-cashier (admin)

## Continuations completed (high level)

### Through 3.5
- Inventory patch-on-edit, clickable variants, placeholder images
- Printer Browser / Network / USB / Bluetooth paths
- On-duty avatars, reports export (CSV/Excel/PDF), inventory import/export
- Notification filters, chat images, scrollable cashier cart
- Receipt print height hugs content

### 3.6
- Cashier default catalog = **Variants**
- Header active-nav highlight (POS / My Sales / Profile)
- Printer reconnect after reload (USB/BT/network); app-layout warm restore
- Bluetooth via Web Bluetooth + ESC/POS (`@point-of-sale/receipt-printer-encoder`)
- On-duty list excludes non-cashier/admin roles
- Reports + admin dashboard: icon-only Refresh
- My Sales: Reprint receipt column

### 3.7
- **Printer save bug:** Nest `ValidationPipe({ whitelist: true })` stripped undecorated DTO fields. Fixed with `@Allow()` on `UpdateBusinessProfileDto`.
- Printer connection dropdown trimmed to: **PrintHub (default)**, Network, USB Local, Browser Dialog (removed BLE + Mharmal from UI).
- Receipt template persists; thermal/PrintHub print uses template element order via `buildReceiptTextFromTemplate` / `writeReceiptFromTemplate`.
- Show company logo checkbox (default on); oversized image strip raised so templates don’t wipe logos.
- Admin header PrintHub connector/indicator (mirrors cashier).
- Admin KPI popups: pagination + filters.
- Chat: quieter polling (no empty-scroll flicker; silent user polls); delete (RMB / long-press); Clear Chat.
- Notifications: Mark all as read.
- Audit Trail: clickable log detail modal.
- Toolbar text buttons → icon + tooltip (reports export, inventory actions, staff, my-sales, printer save/preview, etc.).
- Purchase Orders linked to POS variants (`tblpo_items.variant_id`); search/create/receive update `tblinventory_variants.stock_qty`.
- Login page uses **company profile** logo (no `fwdslogo` brand fallback); upload syncs `tblorganizations.logo_url`.
- `Memory.md` created.

### 3.8
- Chat delete/clear uses modern `app-confirm-dialog` (not `window.confirm`)
- Background printer watch + silent PrintHub reconnect via `bluetooth.getDevices()`
- PrintHub prints company logo (`putImageWithUrl`) and centers header text
- Notifications “Mark all read” visible labeled button in panel header
- Login company logo enlarged (`max-w-[420px] max-h-28`)

### Post-3.8 refinements (receipt + PrintHub auto-connect + spacing)

#### Receipt content + centering
- Store/header text resolves to **company/business name**: settings `businessName` → org name (`OrgService` / JWT) → `'Store'`.
- Backend `getBusinessProfile` joins org and uses `COALESCE(NULLIF(TRIM(business_name), ''), o.name)` so empty business name falls back to organization name.
- Cashier line prints real name: `Cashier: {{cashier}}` from sale detail (`COALESCE(NULLIF(TRIM(fullname), ''), username)`).
- Template placeholders: `{{businessName}}`, `{{storeName}}`, `{{companyName}}`, `{{cashier}}`, `{{saleDate}}`, `{{paymentMethod}}`, etc. (flexible whitespace in `{{ }}`).
- `normalizeTemplateForPrint()` injects `Cashier: {{cashier}}` if missing; does **not** force-center saved align values.
- **Centering fix:** do **not** combine ESC `align:'center'` with space-padding (double-shifts on many BLE printers). Use **space-pad + `align:'left'`** only (`centerPad` in `pos-printhub.service.ts`). Same pad approach in `buildReceiptTextFromTemplate` for network/USB plain text.
- Match paper width (`58mm`→32 cols, `80mm`→42 cols); PrintHub `printReceipt` syncs `this.paperWidth` before writing.
- When `printChar` already set, print directly — do not re-open PrintHub picker mid-print.
- Preview/test print uses org name + signed-in display name for cashier.

#### Template vertical spacing on printout
- Editor stores block positions as canvas **Y%** (`PosReceiptTemplateElement.y`).
- Printout now inserts blank lines / spacers from those Y gaps (not a flat stack):
  - After logo (based on first block Y)
  - Between cashier/meta and items
  - Between items and total
  - Between paid/change and thank-you footer
  - Any other dragged gaps in the saved template
- Vertical gaps are **dynamic from template Y only** (no forced min blanks before items/total). Tight stacks in the editor print tight; drag farther apart to add space.
- Helpers in `pos-receipt-spacing.ts`: `templateSpacingBlankLines`, `templateLogoBlankLines`, `isItemsTemplateBlock`, `isTotalTemplateBlock`, `countTemplateBlockLines` (~4.5% canvas ≈ 1 line).
- Applied in: PrintHub `writeReceiptFromTemplate`, HTML `buildReceiptHtml`, plain text `buildReceiptTextFromTemplate`.
- Fallback non-template PrintHub layout also adds blank lines around items / total / footer.

#### PrintHub automatic Bluetooth connection
- `PosPrintHubService.connect()`: **silent reconnect first**, open Bluetooth picker only if no permitted device.
- `autoConnect()` / `trySilentReconnect()` via Web Bluetooth `getDevices()` + GATT service `000018f0-…`.
- Remembers device in localStorage: `pos.printhub.btDeviceId`, `pos.printhub.btDeviceName`, `pos.printerConnectionType`, `pos.receiptPaperWidth`.
- **GATT disconnect** → mark disconnected → schedule silent reconnect (~1.5s).
- **App layout watchdog:** restore on load, every **8s**, on `visibilitychange`, on `window` focus.
- Headers (cashier `pos-page-header` + admin `app-header`): default connection type **printhub**; call `autoConnect` after loading settings.
- Header / settings **PrintHub icon** uses `connect(..., { forcePicker: true })` so clicking always opens the Bluetooth chooser — even when already connected — to pick another printer. Cancel falls back to the previously paired device when possible.
- Printer settings panel: auto silent reconnect when type is PrintHub on load.
- **On login (POS org):**
  - `AuthService.login` / `refreshSession` → `connectPrintHubAfterAuth()` → `restoreSavedPrinterConnection()`.
  - `SigninFormComponent`: after login tries silent reconnect; if not connected, `requestConnectPrompt()` (tablets lose the Sign In click gesture after the login API await, so the picker cannot open there).
  - Cashier/admin headers show a **Connect receipt printer** dialog; tapping Connect opens the Bluetooth picker with a fresh gesture.
- Sale/test print: always `autoConnect` before PrintHub print; if still disconnected, set connect prompt + clear warning toast.
- **Logo garbage fix:** do not use PrintHub `putImageWithUrl` (broken threshold: any non-black RGB = ink → binary noise). Custom `safePrintLogo` / `buildMonoRasterEscPos` with luminance threshold + small BLE chunks (180 bytes).
- Browser rule: first pair needs a user gesture (Connect prompt or Bluetooth icon). After that, reconnect is silent.

### 3.9
- **Re-print with watermark:** My Sales (cashier) and admin KPI transaction table have Re-print actions. `printSaleReceipt(id, { reprint: true })` sets `ReceiptPrintContext.reprint`; PrintHub, HTML, and plain-text paths print a centered **RE-PRINT ONLY** / **Re-print Only** banner.
- **Variant modal backdrop:** Cashier product picker closes on outside click (`closeVariantModal` on overlay; `stopPropagation` on panel).
- **Logo → store name spacing:** `templateLogoBlankLines()` follows first block Y (dynamic).
- **Items → Total spacing:** dynamic from template Y only (no forced blank-line minimums).
- **Items line format:** `2x pack - Item name...` with price right-aligned (` .... ` + 2-column thermal). Long names truncate with `...` by paper width.
- **Saved template align:** Dragging blocks updates `align` from canvas X%; thermal print space-pads center/right lines (not ESC align). Explicit align dropdown is respected.
- **My Sales sale details:** Details modal loads `getTransactionDetail` — items, payment, totals, re-print from modal.
- **My Sales amounts:** Multi-item checkouts insert one `tblsales_transactions` row per line. Recent list and transaction count must group by checkout (header row `amount_paid IS NOT NULL` + 10s batch SUM), not raw line `total_amount`.

### 4.0
- **Re-print admin code:** My Sales re-print opens admin-code modal first; `POST /api/pos/admin-code/authorize` reuses void-code verification + audit.
- **posadmin login printer popup:** Sign-in only calls `requestConnectPrompt()` for cashiers — not posadmin.
- **Purchase Orders page:** `/users/purchase-orders` — in-page create form + list (not side modal). Sidebar under Inventory for POS org.
- **PO smart search:** Item field searches encoded products (inventory + POS variants); pick autofills variant, unit, stock, cost.
- **Chat delete:** Confirm dialog clicks no longer collapse the chat widget (`confirmOpen` guard in `onDocumentClick`).
- **Cash drawer:** Printer settings → enable + timing (`before_receipt` default = open on complete sale before receipt). ESC/POS pulse via PrintHub / USB / network / Bluetooth. Checkout modal shows per-sale “Open cash drawer” when enabled. DB: `pos_cash_drawer_enabled`, `pos_cash_drawer_open_on`.
- **Donut chart labels:** Admin dashboard donut slice labels use white text + drop shadow; center/legend use light gray for dark-theme readability.

### 4.1
- **Tablet/portrait cart:** Cart drawer uses slide-in panel (`max-xl`) instead of conflicting `hidden`/`flex`; desktop cart column at `xl+`. Auto-opens on tablet when cart has items.
- **Checkout modal:** Subtotals in accordion; payment + discount side-by-side; fixed header/footer with scrollable body; Total Due above action buttons.
- **Admin custom chart:** Field-based builder — pick **Group by** (day, cashier, payment method/status, category, product, brand, unit) + **Metric** (total amount, qty sold, transaction count, discount) + bar/donut. Data from `GET /api/pos/reports/custom-chart`.
- **Custom chart infinite load:** ApexCharts bindings must use **cached properties** (`customBarSeries`, `customBarXaxis`, …), not methods that return new arrays each CD cycle.
- **Admin widget remove/add:** × on KPI/chart/list cards; “Add card…” dropdown restores hidden widgets; layout persistence allows partial `widgetOrder`.
- **Admin KPI cards:** Removed “Tap for details” hint text.
- **Donut readability:** Center donut labels forced to white (`#ffffff`).
- **All chart widgets:** Bar/donut toggle on daily, category, payment, and custom charts.
- **Tablet sidenav overlap:** Backdrop breakpoint aligned to `xl:hidden` (matches sidebar); hover-expand disabled on touch devices.
- **Receipt item lines:** `Item name .... total` on first line, `qty x unitPrice` on second; no currency symbol on thermal output.
- **Offline mode:** Catalog cached locally; checkout queues when offline; amber banner + Sync now when pending sales exist.
- **Cashier My Sales table:** Server-side search/status filters + pagination (`page`/`pageSize` on `GET /api/pos/my-sales`); Txn # column.
- **BLE re-print 512-byte error:** Wrap PrintHub GATT `writeValue` in chunked proxy (~180 bytes) in `pos-printhub.service.ts`.
- **Portrait cart z-index:** Drawer/backdrop above header (`z-[9600]` / `z-[9550]`); open/close via `[ngClass]` (not `[class.max-xl:…]`).
- **Purchase Orders page:** Full-width PO table; create form opens in a modal via **+** button. Toolbar/actions use icon buttons (refresh, create, view, save, receive, close, add/remove item).
- **PO create status check:** Live DB had `CHECK (pending|received|cancelled)` rejecting `draft`. Fixed to `draft|ordered|received|cancelled` (`20260723_po_status_check_fix.sql` + `ensurePoSchema`). Drop legacy check **before** normalizing values.
- **PO item remove ✕:** Top-right of each item card (create + draft detail); avoid grid wrap from column spans summing > 12.

### 4.2
- **Variants catalog:** large variant name + price on grid/list cards; sale price shown when on sale.
- **Variant picker modal:** price aligned right and enlarged (`text-2xl`/`text-3xl`).
- **Void moved to My Sales:** cart keeps remove (X) only; post-sale void on each line in sale details (admin code). Backend restores `tblinventory_variants.stock_qty` and moves payment header (`amount_paid`, `reference_number`, etc.) to a sibling batch line when needed.
- **My Sales:** sortable headers; removable payment-method total cards (`localStorage` key `pos.mySales.hiddenPaymentCards`); Payment + Reference # columns; default period = **today**.
- **Checkout:** Reference # required for GCash/Maya/bank transfer/Foodpanda; quick amount chips 10–1000; Custom discount with confirm before apply. Persists `tblsales_transactions.reference_number`.
- **OUT OF STOCK** watermark overlay on OOS variant cards + modal rows.
- **Chat:** no sound/badge when the matching thread is already open (marks those notifs read); `"Seen"` under own private messages via `seen_at` + `GET /chat/seen`; sound + red FAB badge when closed/hidden.
- **Admin Inventory:** Low stock merges legacy `tblinventory` + POS variants; Category field is smart autocomplete (type + pick existing).
- **Purchase Orders:** `app-confirm-dialog` (no `window.confirm`); field labels above inputs; smart search returns **variants only** + product type + unit type fields.
- **PO create form smart fields:** Product type, Unit type, Brand, and Category are smart-search textboxes (suggest existing; free-type new). New brand/category/unit type values are created on save when missing.
- **PO draft detail form:** Same layout/labels as create — Variant, Product type, Unit type, Brand, Category are smart-search; Qty/Unit cost labeled. `getOnePO` returns separate `productName` + `unitType` (not coalesced display name). Selecting a variant autofills product type / unit / brand / category / cost.
- **Reports (POS dashboard + completed sales):** search, sortable headers, Reference # column. Dashboard transactions search/sort are server-side; completed sales filter/sort/paginate client-side over the loaded period (up to 200 rows).
- **Key PO files:** `frontend/.../purchase-orders/purchase-orders.component.*`, `frontend/.../inventory.service.ts`, `backend/src/inventory/inventory.service.ts` (`getOnePO` / create / update / receive).

### 4.3
- **Beverages gate = category** (not product name). Match `beverages` / typo `bevarages`; normalize saved category to `"Beverages"`.
- **Inventory (admin):** when category is Beverages, each variant gets:
  - `hasSugarLevel` checkbox
  - Sub-variants editor: temperature (`hot` / `iced` / N/A) + size (small/regular/medium/large datalist) + selling/sale price
  - **Duplicate variant** copies units, sugar flag, sub-variants, prices, image; stock starts at 0; new row inserts at top as `Name (copy)`
  - New sub-variant rows insert at the **top** of the list
  - Variants and sub-variants can be reordered in the form with up/down controls; saved order persists through existing `sort_order` handling
  - Sub-variants panel is collapsible per variant in the inventory form
  - Sub-variant order is now carried explicitly as `sortOrder` from admin save through cashier load, so cashier size button order matches POS admin reordering
- **Schema:** `tblinventory_variants.has_sugar_level`; `tblinventory_variant_subvariants`; `tblorg_unit_types.usage_scope` (`Beverages` | `Others`). Auto-ensured in Nest + SQL `20260804_pos_continuation_4_3.sql`.
- **Unit types (Settings):** create form has **Can be used for** selector [Beverages, Others]; table shows scope. Active rows are **editable** (label + scope) via Edit → Save; code stays fixed. Liter/bottle/can seeded to Beverages.
- **Inventory unit dropdown:** only shows units whose `usageScope` matches the product category (`Beverages` → Beverages units; anything else → Others units). Changing category re-filters and sanitizes selected units.
- **Cashier catalog:** All / Beverages / Others selector beside Product/Variants + grid/list toggles (`catalogGroup`, sessionStorage).
- **Cashier beverage picker:** loads `hasSugarLevel` + `subVariants` from terminal API; modal shows Temperature / Size / Sugar level; price follows selected sub-variant; cart line name includes those choices.
- **Cashier product cards:** in Products view, beverage cards now derive min/max/sale price from sub-variant pricing when present, instead of falling back to base variant price `0`.
- **Variant catalog cards:** when base/unit price is `0`, card price falls back to first priced sub-variant.
- **Checkout beverage pricing:** cart now sends `subVariantId`; backend resolves `unit_price` from `tblinventory_variant_subvariants` (not zero base/unit price). Also stores `sub_variant_id` on `tblsales_transactions`. Rejects checkout if beverage has sub-variants but none selected, or if resolved price is still `0`.
- **Inventory Product variants table:** Duplicate action copies units/sub-variants/settings/image; stock starts at `0`; name becomes `Name (copy)`. Fixed bigint id Map lookup so sub-variants actually copy.
- **Beverage product form:** Unit types section is collapsed by default for Beverages (pricing comes from sub-variants); use the Unit types header / + button to expand and add unit types when needed.
- **Inventory product form:** Variant cards are collapsible (header shows name when collapsed). Opening a product expands the first variant; add/duplicate expands the new card and collapses the others.
- **Cashier cart beverage details:** beverage lines now show plain order details on separate lines (e.g. `Iced`, `Large`, `75%`) for quicker cashier scanning.
- **Grams / manual entry:** default qty **200** on add-to-cart, unit change, and cart edit (`defaultVariantQty`).
- **POS Reports:** new **Product Logs** report lists product name, category, brand, added timestamp (`created_at`), and last updated timestamp (`updated_at`) from `tblinventory_products`.
- **Checkout (Bank Transfer):** cashier must enter buyer/customer fullname before submit. Saved on `tblsales_transactions.customer_full_name`; backend also enforces it so offline/queued or manual requests cannot bypass the rule.
- **Checkout references:** `Reference #` is now required for every **non-cash** payment method; cash stays exempt. Backend validates this too.
- **Key files:** `inventory.component.*`, `pos-dashboard.component.*`, `settings.component.*`, `inventory-products.service.ts`, `inventory-unit-types.service.ts`, `pos.service.ts` types.

## Key printer files
- Panel: `frontend/.../pos-printer-settings-panel/*`
- Print: `pos-receipt-print.service.ts`, `pos-printhub.service.ts`
- Spacing: `pos-receipt-spacing.ts`
- Login connect: `auth.service.ts` (`connectPrintHubAfterAuth`), `signin-form.component.ts` (`connectPrintHubOnLogin`)
- Layout watch: `app-layout.component.ts`
- Headers: `pos-page-header.component.ts`, `app-header.component.ts`
- Save API: `PUT /api/pos/printer-settings` → `settings.service.updateBusinessProfile`
- DTO: `backend/src/settings/dto/update-business-profile.dto.ts` (**must keep `@Allow()`**)
- Body size: `backend/src/main.ts` JSON limit `10mb`
- Business name fallback: `backend/src/settings/settings.service.ts` (org join)
- Cashier on sale detail: `backend/src/pos/services/store-reports.service.ts` (`getTransactionDetail`)

## Key chat / notif files
- Widget: `pos-chat-widget/*`
- APIs: `pos-communications.service.ts` + `pos-chat.service.ts` (`deleted_at`, delete + clear)
- Bell: `pos-notifications-bell/*` — mark-all uses `PATCH .../notifications/read` with empty body

## POS inventory vs legacy
- Cashiers sell from `tblinventory_variants`
- Legacy `tblinventory` still used for non-POS paths
- PO receive must update **variant** stock when `variant_id` is set

## PrintHub notes
- Session-based Web Bluetooth; reconnect after reload via `getDevices()` (no picker) once previously permitted.
- First-time pair still needs user gesture (login Sign In or header Bluetooth icon).
- Green indicator = live connected; amber/idle = saved or needs reconnect.
- Package: `printhub` in `frontend/package.json` — run `npm install` after pull if missing.
- Prefer pad+left for centered header lines; avoid pad+ESC center together.
- Paper width in settings must match the physical printer (58 vs 80).
- Vertical gaps follow template Y positions via `pos-receipt-spacing.ts`.

## Login branding
- Public profile: `GET /settings/public/business-profile` resolves POS org (`point-of-sales` / `pos`) then org-with-logo.
- Auth layout: `auth-page-layout` — do not reintroduce platform `fwdslogo` as the hero when a company logo exists.
- Logo size: larger on login (`max-w-[420px] max-h-28`).

## Gotchas
- After `git pull`, if Vite fails on `printhub`, run `npm install` in `frontend/`.
- Do not commit secrets; local printer WIP may conflict with remote PrintHub commits — stash carefully.
- Cashier LAN access needs `ng serve --host 0.0.0.0`.
- Do not remove `@Allow()` from business profile DTO or printer settings save will strip fields again.
- `PUT /api/pos/printer-settings` in `terminal.controller.ts` whitelists allowed fields — add new printer/cash-drawer keys there or they never reach `settings.service`.
- Nest whitelist + large base64 logos need 10mb body limit.
- Do not import spacing helpers from `pos-printhub` through `pos-receipt-print` in a way that creates a cycle — use `pos-receipt-spacing.ts`.
- Backend DB credentials live in `backend/.env` (not repo-root `.env`) — wrong file → wrong Supabase project.
- ApexCharts: never bind methods that allocate new `series`/`categories` arrays each change-detection cycle.
- Angular `[class.max-xl:foo]` bindings break on Tailwind colon variants — use `[ngClass]` instead.
- `tblpurchases_status_check`: drop constraint before UPDATE to `draft`; legacy check was `pending|received|cancelled`.

## Suggested next checks when continuing
1. Continuation 4.3 smoke: Inventory category Beverages → sugar checkbox + sub-variants save/reload; Settings unit type scope Beverages/Others; cashier All/Beverages/Others filter; grams unit defaults qty to 200.
2. Purchase Orders → New PO + Draft PO: labels on all item fields; Product type / Unit type / Brand / Category smart search (pick or type new); Variant smart search autofills related fields.
3. Login as POS user → PrintHub connects (silent if previously paired; picker once if first time).
4. Reload dashboard → Bluetooth indicator goes green without clicking (if printer on + previously paired).
5. Print receipt → store/company name + cashier name centered, with gaps matching template (logo → header → items → total → thank you).
6. Drag template blocks farther apart → save → reprint → blank lines increase.
7. Save printer settings → reload → connection type + template still in Network `item`.
8. Receive PO linked to a POS variant → variant stock increases on cashier terminal.
9. Chat delete/clear + notification mark-all.
10. Login shows uploaded company logo.
11. My Sales → Details modal + Re-print (watermark on thermal).
12. Admin KPI transactions → Re-print icon in Actions column.
13. Saved template align/spacing → reprint matches editor layout (items format `Qty - Name - Unit`).
14. Re-print from My Sales → admin void code required.
15. Purchase Orders page → full-width table; **+** opens create modal; icon actions; status `draft` OK.
16. Cash drawer enabled → complete sale opens drawer before receipt (PrintHub/USB/network).
17. Admin dashboard charts → donut view labels readable (white % on slices); custom chart stable (no infinite load).
18. Tablet portrait → cart drawer above header/filters; checkout modal accordion + fixed footer.
19. Offline sale → queues locally; Sync now uploads when online.
20. Receipt items → name + total on line 1, qty x price on line 2 (no ₱ on thermal).
21. My Sales → filter/pagination on recent sales table.
22. BLE re-print of long receipts → no 512-byte GATT write error.
