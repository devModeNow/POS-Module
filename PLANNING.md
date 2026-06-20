# Centralized Business Information System (CBIS)
## Planning, Implementation & System Key Features

---

## 1. Project Overview

**Project Name:** Centralized Business Information System (CBIS)
**Stack:** NestJS (Backend) · Angular 19 (Frontend) · PostgreSQL via Supabase
**Goal:** A single platform that manages multiple business organizations under one roof. Each organization operates independently with its own data, menus, roles, and processes — while the platform owner manages everything from a central admin layer.

---

## 2. Core Concept — Multi-Organization Architecture

```
CBIS Platform (Super Admin)
│
├── Organization: Car Expert Auto Repair
│   ├── Dashboard
│   ├── Customers (+ Vehicles)
│   ├── Quotations
│   ├── Job Orders (full workflow)
│   ├── Inventory (+ Purchase Orders + Reports)
│   └── Reports
│
├── Organization: [Future Business B]
│   └── [Business-specific modules]
│
└── Platform Layer
    ├── Dashboard (platform KPIs)
    ├── Organizations Management
    ├── User Management (all users across orgs)
    └── Settings (platform + per-org)
```

### Key Rules
- A **user belongs to one organization** via `org_id` on their profile.
- When a user logs in, the system detects their `org_id` and loads only that organization's menus and permissions.
- **Super Admin / Platform Owner** has no `org_id` restriction — they see everything.
- Each organization has its own **roles, permissions, and settings**.
- Organizations do NOT share data (customers, job orders, inventory, etc.) with each other.
- `roleMenus` in `tblrbac` is stored as a JSON array string — normalized to CSV on JWT build.
- `rolePermission` in `tblrbac` is stored as a JSON object — normalized to `canRead,canCreate,...` on JWT build.

---

## 3. Phase 1 — Foundation ✅ COMPLETE

### Completed Items
- [x] `tblorganizations` — central org registry
- [x] `tblorg_settings` — per-org settings (34 columns including print settings)
- [x] `tblorg_menus` — per-org menu definitions
- [x] `tblusers.org_id` — user scoped to org
- [x] `tblrbac.org_id` — roles scoped to org
- [x] Platform roles seeded: `superadmin` (id=10), `platform_admin` (id=11)
- [x] Org roles seeded for Car Expert: `ADMIN`(1), `SERVICE_ADVISOR`(2), `TECHNICIAN`(3), `CASHIER`(4)
- [x] 31 permission keys seeded (`platform.*` + `org.*`)
- [x] JWT payload includes `orgId`, `orgCode`, `orgName`, normalized `menus` CSV, normalized `permissions` CSV
- [x] Login blocks deactivated org users
- [x] Frontend `RbacService` reads org context from JWT
- [x] Frontend sidebar renders org-specific menus dynamically
- [x] Organizations CRUD page (list, create, edit, activate/deactivate)
- [x] Org switcher in header (platform admins switch orgs, org users see read-only badge)
- [x] User Management with org selector — roles filtered per selected org
- [x] Settings page (System, Print Settings, RBAC Configs)
- [x] Auth page shows org logos from `tblorganizations`
- [x] Coming-soon placeholder for unbuilt org routes

### Live Database — Phase 1 Tables
| Table | Purpose |
|---|---|
| `tblorganizations` | Business org registry |
| `tblorg_settings` | Per-org business profile + print settings |
| `tblorg_menus` | Per-org sidebar menu definitions |
| `tblrbac` | Roles (org_id scoped) |
| `tblusers` | Users (org_id scoped) |
| `auth_permission_keys` | Normalized permission dictionary |
| `auth_role_permissions` | Role → permission mapping |
| `auth_user_permission_overrides` | Per-user allow/deny overrides |

---

## 4. Phase 2 — Car Expert Auto Repair Modules

**Organization:** Car Expert Auto Repair (`org_id = 1`, `code = 'car-expert'`)
**Focus:** Full auto repair shop workflow from customer intake to job completion and payment.

### 4.1 Phase 2 Menus

| Menu Key | Label | Route |
|---|---|---|
| `dashboard` | Dashboard | `/users/dashboard` |
| `customers` | Customers | `/users/customers` |
| `quotations` | Quotations | `/users/quotations` |
| `job-orders` | Job Orders | `/users/job-orders` |
| `inventory` | Inventory | `/users/inventory` |
| `reports` | Reports | `/users/reports` |

---

### 4.2 Customers Module

**Purpose:** Manage customer profiles and their registered vehicles in one place.

#### Page Layout
- Full-page list of customers with search and filters
- Click **View** → opens a **right-side drawer** with full customer profile

#### Customer List Table Columns
| Column | Description |
|---|---|
| Name | Full name |
| Contact | Phone number |
| Email | Email address |
| Vehicles | Count of registered vehicles |
| Last Visit | Date of last job order |
| Actions | View button |

#### Customer Profile Drawer — Tabs
The drawer has 4 tabs:

**Tab 1 — Vehicles**
- List of all plate numbers registered to this customer
- Columns: Plate Number, Make, Model, Engine Type, Fuel Type, Odometer, Year
- Action: View vehicle details

**Tab 2 — Job Orders**
- All job orders linked to this customer's vehicles
- Columns: JO#, Plate, Date, Mechanic, Status, Total Amount
- Status badges: Pending, In Progress, For Payment, Released, Cancelled

**Tab 3 — Payments**
- All payments made by this customer (JO payments + parts purchases)
- Columns: Date, Reference, Description, Mode of Payment, Amount

**Tab 4 — History (Audit Log)**
- All movements: JO created, approved, signed, paid, released
- Columns: Date/Time, Action, Details, Performed By

#### Database Tables Used
- `tblcustomers` — customer master (needs `org_id`)
- `tblvehicles` — vehicles per customer
- `tbljoborders` — job orders per vehicle
- `tblinvoices` — invoices per customer
- `tblsales` — sales/payments per customer
- `tblservice_history` — service history per vehicle

#### Database Changes Required
```sql
-- Add org_id to tblcustomers
ALTER TABLE tblcustomers ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES tblorganizations(id);

-- Add year_model to tblvehicles
ALTER TABLE tblvehicles ADD COLUMN IF NOT EXISTS year_model INT;
ALTER TABLE tblvehicles ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE tblvehicles ADD COLUMN IF NOT EXISTS transmission TEXT;
ALTER TABLE tblvehicles ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES tblorganizations(id);
```

---

### 4.3 Quotations Module

**Purpose:** Create and send price quotations to customers before a job order is created.

#### Page Layout
- List of all quotations with status filters
- Create Quotation button → opens drawer/modal

#### Quotation Fields
| Field | Type | Notes |
|---|---|---|
| Customer Name | Text / Search | Search existing or type new |
| Contact | Text | |
| Vehicle Plate | Text | |
| Services | Table | Service Name, Description, Fee |
| Parts/Supplies | Table | Item, Qty, Unit Price |
| Labor Fee | Number | |
| Discount | Number | Optional |
| Total | Computed | Auto-calculated |
| Valid Until | Date | Expiry date |
| Notes | Textarea | |
| Status | Select | Draft, Sent, Accepted, Declined, Expired |

#### Database Table Required (New)
```sql
CREATE TABLE IF NOT EXISTS public.tblquotations (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES tblorganizations(id),
  customer_id     BIGINT REFERENCES tblcustomers(id),
  customer_name   TEXT NOT NULL,
  contact         TEXT,
  vehicle_plate   TEXT,
  services        JSONB NOT NULL DEFAULT '[]',  -- [{name, description, fee}]
  parts           JSONB NOT NULL DEFAULT '[]',  -- [{name, qty, unit_price}]
  labor_fee       NUMERIC DEFAULT 0,
  discount        NUMERIC DEFAULT 0,
  total_amount    NUMERIC DEFAULT 0,
  valid_until     DATE,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'draft', -- draft|sent|accepted|declined|expired
  created_by      BIGINT REFERENCES tblusers(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 4.4 Job Orders Module ⭐ Core Module

**Purpose:** Full auto repair workflow from vehicle intake to payment and release.

#### Business Rules
- Single form — no step-by-step wizard
- Search plate number first → auto-populate if found, create new if not
- Customer signature required before work begins (PNG saved to DB)
- Mechanic updates job when done
- Payment required before release
- Print receipt on release

#### Job Order Form Fields

**Section 1 — Vehicle & Customer**
| Field | Type | Notes |
|---|---|---|
| Plate Number | Text + Search | Auto-fetch vehicle & customer if exists |
| Vehicle Make | Text | Auto-filled or manual |
| Vehicle Model | Text | Auto-filled or manual |
| Engine Type | Text | Auto-filled or manual |
| Fuel Type | Select | Gasoline, Diesel, Electric, Hybrid |
| Odometer Reading | Number | Current reading |
| Customer Name | Text | Auto-filled or manual |
| Contact | Text | Auto-filled or manual |
| Email | Text | Auto-filled or manual |
| Address | Textarea | Auto-filled or manual |

**Section 2 — Job Order Details**
| Field | Type | Notes |
|---|---|---|
| Assigned Mechanic | Select | From `tbltechnicians` |
| Job Description | Textarea | Overall description |
| Status | Select | Pending, In Progress, For Payment, Released, Cancelled |

**Section 3 — Services (Table, Multiple)**
| Column | Type | Notes |
|---|---|---|
| Service Name | Text | Manual input |
| Description | Text | Optional |
| Fee | Number | |
| Action | Button | Remove row |

**Section 4 — Parts & Supplies (Table, Multiple)**
| Column | Type | Notes |
|---|---|---|
| Item Name | Smart Search | Search inventory OR type manually |
| Source | Auto | `inventory` if from stock, `customer-supplied` if no price, `external` if manual |
| Quantity | Number | |
| Unit Price | Number | Empty = Customer Supplied |
| Total | Computed | Qty × Price |
| Action | Button | Remove row |

**Section 5 — Summary**
| Field | Notes |
|---|---|
| Services Subtotal | Sum of all service fees |
| Parts Subtotal | Sum of all parts |
| Labor Fee | Manual input |
| Discount | Optional |
| Grand Total | Auto-calculated |

#### Job Order Workflow

```
1. CREATE JO
   └── Form filled → Save → Status: PENDING

2. CUSTOMER E-SIGNATURE
   └── Tablet/pen input → PNG saved to tbljoborders.customer_signature_data
   └── Status: IN PROGRESS

3. MECHANIC WORKS
   └── Mechanic updates: jobs_done, service_remarks
   └── Mechanic signs: mechanic_signature_data
   └── Status: FOR PAYMENT

4. PAYMENT
   └── Payment drawer shows JO summary
   └── Fields: Mode of Payment, Date, Amount
   └── Saved to tblinvoices + tblsales
   └── Status: PAID

5. RELEASE
   └── Print JO Receipt (PDF)
   └── Staff manually signs paper
   └── Status: RELEASED
```

#### Payment Form Fields
| Field | Type | Notes |
|---|---|---|
| Mode of Payment | Select | Cash, GCash, Bank Transfer, Card |
| Date of Payment | Date | |
| Amount | Number | |
| Reference No. | Text | Optional |
| Notes | Text | Optional |

#### Database Changes Required
```sql
-- Add org_id and missing fields to tbljoborders
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES tblorganizations(id);
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS jo_number TEXT;  -- auto-generated e.g. JO-2025-0001
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS labor_fee NUMERIC DEFAULT 0;
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS discount NUMERIC DEFAULT 0;
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS total_amount NUMERIC DEFAULT 0;
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES tblusers(id);
ALTER TABLE tbljoborders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add service_name and fee to tbljoborder_supplies
ALTER TABLE tbljoborder_supplies ADD COLUMN IF NOT EXISTS service_name TEXT;
ALTER TABLE tbljoborder_supplies ADD COLUMN IF NOT EXISTS fee NUMERIC DEFAULT 0;
ALTER TABLE tbljoborder_supplies ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'inventory'; -- inventory|customer-supplied|external

-- Payment table (new)
CREATE TABLE IF NOT EXISTS public.tbljo_payments (
  id              BIGSERIAL PRIMARY KEY,
  job_order_id    BIGINT NOT NULL REFERENCES tbljoborders(id),
  org_id          BIGINT NOT NULL REFERENCES tblorganizations(id),
  mode            TEXT NOT NULL,  -- cash|gcash|bank-transfer|card
  amount          NUMERIC NOT NULL,
  payment_date    DATE NOT NULL,
  reference_no    TEXT,
  notes           TEXT,
  created_by      BIGINT REFERENCES tblusers(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add org_id to tblinvoices
ALTER TABLE tblinvoices ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES tblorganizations(id);
```

---

### 4.5 Inventory Module

**Purpose:** Manage parts and supplies stock, purchase orders, and inventory reports.

#### Tabs
1. **Inventory** — Parts & Supplies list
2. **Purchase Orders** — PO management
3. **Reports** — Inventory reports

#### Tab 1 — Inventory (Parts & Supplies)

**List Features:** Search, Filter by Category/Brand, Low Stock highlight

**Table Columns**
| Column | Notes |
|---|---|
| Item Name | |
| Category | |
| Brand | |
| Stock Qty | Highlighted red if below `stock_warning` |
| Cost Price | |
| SRP | |
| Max Discount | |
| Actions | View, Edit |

**Item Fields (Create/Edit)**
| Field | Type |
|---|---|
| Item Name | Text |
| Category | Text / Select |
| Brand | Text |
| Quantity | Number |
| Cost Price | Number |
| SRP | Number |
| Max Discount Price | Number |
| Stock Warning Level | Number |
| Supplier | Select from `tblsuppliers` |
| Description | Textarea |

#### Tab 2 — Purchase Orders

**List Features:** Search, Filter by Status, Date range

**PO Fields**
| Field | Type |
|---|---|
| PO Number | Auto-generated |
| Supplier | Select from `tblsuppliers` |
| Items | Table: Item, Qty, Unit Cost, Total |
| Total Amount | Computed |
| Status | Draft, Ordered, Received, Cancelled |
| Notes | Textarea |
| Order Date | Date |
| Expected Date | Date |

#### Tab 3 — Inventory Reports
- Inventory Summary (all items, current stock, value)
- Low Stocks Report (items below `stock_warning`)
- Stock Movement Report (in/out per date range)

#### Database Changes Required
```sql
-- Add missing fields to tblinventory
ALTER TABLE tblinventory ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES tblorganizations(id);
ALTER TABLE tblinventory ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE tblinventory ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE tblinventory ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tblinventory ADD COLUMN IF NOT EXISTS max_discount_price NUMERIC;
ALTER TABLE tblinventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add org_id to tblsuppliers
ALTER TABLE tblsuppliers ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES tblorganizations(id);

-- Purchase Order Items table (new)
CREATE TABLE IF NOT EXISTS public.tblpo_items (
  id              BIGSERIAL PRIMARY KEY,
  purchase_id     BIGINT NOT NULL REFERENCES tblpurchases(id) ON DELETE CASCADE,
  inventory_id    BIGINT REFERENCES tblinventory(id),
  item_name       TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_cost       NUMERIC NOT NULL DEFAULT 0,
  total_cost      NUMERIC NOT NULL DEFAULT 0
);

-- Add fields to tblpurchases
ALTER TABLE tblpurchases ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES tblorganizations(id);
ALTER TABLE tblpurchases ADD COLUMN IF NOT EXISTS po_number TEXT;
ALTER TABLE tblpurchases ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'; -- draft|ordered|received|cancelled
ALTER TABLE tblpurchases ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE tblpurchases ADD COLUMN IF NOT EXISTS order_date DATE;
ALTER TABLE tblpurchases ADD COLUMN IF NOT EXISTS expected_date DATE;
ALTER TABLE tblpurchases ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES tblusers(id);
ALTER TABLE tblpurchases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

---

### 4.6 Reports Module

**Purpose:** Generate business reports for management review.

#### Report Types

| Report | Filters | Output |
|---|---|---|
| Sales Report | Daily / Weekly / Monthly, Date Range | Total sales, breakdown by payment mode |
| Jobs Done Report | Daily / Weekly / Monthly, Date Range | Count and value of completed JOs |
| Inventory Report | Category, Brand | Current stock levels and values |
| Low Stocks Report | Threshold | Items below warning level |

---

## 5. Phase 2 — Database Migration Summary

### New Tables
| Table | Purpose |
|---|---|
| `tblquotations` | Customer quotations |
| `tbljo_payments` | Job order payments |
| `tblpo_items` | Purchase order line items |

### Altered Tables
| Table | Changes |
|---|---|
| `tblcustomers` | + `org_id` |
| `tblvehicles` | + `org_id`, `year_model`, `color`, `transmission` |
| `tbljoborders` | + `org_id`, `jo_number`, `labor_fee`, `discount`, `total_amount`, `created_by`, `updated_at` |
| `tbljoborder_supplies` | + `service_name`, `fee`, `source` |
| `tblinventory` | + `org_id`, `category`, `brand`, `description`, `max_discount_price`, `updated_at` |
| `tblsuppliers` | + `org_id` |
| `tblpurchases` | + `org_id`, `po_number`, `status`, `notes`, `order_date`, `expected_date`, `created_by`, `updated_at` |
| `tblinvoices` | + `org_id` |

---

## 6. Phase 2 — Backend Module Structure

```
backend/src/
├── customers/               ← NEW
│   ├── customers.controller.ts
│   ├── customers.module.ts
│   └── customers.service.ts
├── quotations/              ← NEW
│   ├── quotations.controller.ts
│   ├── quotations.module.ts
│   └── quotations.service.ts
├── job-orders/              ← NEW
│   ├── job-orders.controller.ts
│   ├── job-orders.module.ts
│   └── job-orders.service.ts
├── inventory/               ← NEW
│   ├── inventory.controller.ts
│   ├── inventory.module.ts
│   └── inventory.service.ts
└── reports/                 ← NEW
    ├── reports.controller.ts
    ├── reports.module.ts
    └── reports.service.ts
```

---

## 7. Phase 2 — Frontend Page Structure

```
frontend/src/app/pages/
├── customers/
│   ├── customers.component.ts       ← List page
│   └── customers.component.html
├── quotations/
│   ├── quotations.component.ts
│   └── quotations.component.html
├── job-orders/
│   ├── job-orders.component.ts      ← List + Create/Edit
│   └── job-orders.component.html
├── inventory/
│   ├── inventory.component.ts       ← Tabbed: Inventory | PO | Reports
│   └── inventory.component.html
└── reports/
    ├── reports.component.ts
    └── reports.component.html

frontend/src/app/shared/services/
├── customers.service.ts             ← NEW
├── quotations.service.ts            ← NEW
├── job-orders.service.ts            ← NEW
├── inventory.service.ts             ← NEW
└── reports.service.ts               ← NEW
```

---

## 8. Phase 2 — Implementation Checklist

### Database Migration
- [ ] Run Phase 2 migration SQL (alter existing tables + create new tables)
- [ ] Seed: Add `quotations`, `job-orders`, `inventory` to `tblorg_menus` for Car Expert
- [ ] Update `tblrbac` roleMenus for Car Expert roles to include new menus

### Backend
- [ ] Customers module (CRUD + vehicles + JO history + payments + audit)
- [ ] Quotations module (CRUD + status management)
- [ ] Job Orders module (create, update status, signature save, payment, release)
- [ ] Inventory module (parts CRUD + PO CRUD + stock adjustment)
- [ ] Reports module (sales, jobs, inventory, low stocks)

### Frontend
- [ ] Customers page (list + profile drawer with 4 tabs)
- [ ] Quotations page (list + create/edit drawer)
- [ ] Job Orders page (list + single-form create/edit + signature capture + payment drawer)
- [ ] Inventory page (tabbed: inventory list + PO list + reports)
- [ ] Reports page (report type selector + date filters + table/chart output)
- [ ] Update `app.routes.ts` — replace coming-soon with real components
- [ ] Update `tblorg_menus` sidebar entries for Car Expert

---

## 9. Phase 3 — Platform Dashboard & Reports (Planned)
- [ ] Platform-wide dashboard (all orgs summary: total orgs, users, revenue)
- [ ] Cross-org user activity
- [ ] Audit logs per org
- [ ] Platform-level reports

## 10. Phase 4 — Expansion (Planned)
- [ ] Payroll module (per org)
- [ ] Accounting module (per org)
- [ ] Multi-org reports
- [ ] Notification system
- [ ] API rate limiting per org

---

## 11. JWT Payload Structure

### Platform User (superadmin / platform_admin)
```json
{
  "sub": 1,
  "username": "admin",
  "fullname": "System Administrator",
  "roleId": 10,
  "roleName": "superadmin",
  "menus": "ALL",
  "permissions": "ALL",
  "orgId": null,
  "orgCode": null,
  "orgName": null
}
```

### Org User (Car Expert ADMIN)
```json
{
  "sub": 2,
  "username": "pttadmin",
  "fullname": "Test Admin",
  "roleId": 1,
  "roleName": "ADMIN",
  "menus": "dashboard,customers,vehicles,job-orders,inventory,sales,finance,reports,user-management",
  "permissions": "canRead,canCreate,canUpdate,canDelete",
  "orgId": 1,
  "orgCode": "car-expert",
  "orgName": "Car Expert Auto Repair"
}
```

**Notes:**
- `menus = 'ALL'` → frontend grants all 4 platform menus
- `permissions = 'ALL'` → frontend grants `canDoAll`
- `roleMenus` JSON array in DB → normalized to CSV on JWT build
- `rolePermission` JSON object in DB → normalized to `canRead,canCreate,...` on JWT build

---

## 12. RBAC Permission Keys — Phase 2

```
-- Customers
customers.view
customers.create
customers.edit
customers.delete

-- Quotations
quotations.view
quotations.create
quotations.edit
quotations.delete
quotations.send

-- Job Orders
job-orders.view
job-orders.create
job-orders.edit
job-orders.delete
job-orders.approve
job-orders.payment
job-orders.release
job-orders.print

-- Inventory
inventory.view
inventory.create
inventory.edit
inventory.delete
inventory.purchase-order.view
inventory.purchase-order.create
inventory.purchase-order.receive

-- Reports
reports.view
reports.export
```

---

## 13. Key Technical Notes

### Signature Capture
- Use HTML5 Canvas with touch/mouse/stylus events
- Save as PNG base64 string to `tbljoborders.customer_signature_data`
- Display as `<img>` tag on JO detail view and printed receipt

### Smart Search for Parts
- Debounced input → `GET /inventory/search?q=brake&orgId=1`
- Returns matching inventory items
- If user types something not in inventory → treated as manual entry
- Source auto-set: `inventory` (from stock), `customer-supplied` (no price), `external` (manual with price)

### JO Number Auto-Generation
- Format: `JO-YYYY-NNNN` (e.g. `JO-2025-0001`)
- Sequence per org per year
- Generated on insert via DB trigger or service logic

### Print Receipt
- Angular generates HTML → browser `window.print()`
- Uses org's `tblorg_settings` for logo, business name, address
- Includes: JO details, services, parts, payment summary, signature image

---

*Document Version: 2.0*
*Phase 1: COMPLETE*
*Phase 2: IN PLANNING — Ready to build*
*Last Updated: Phase 2 Plan documented*
