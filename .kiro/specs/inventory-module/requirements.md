# Requirements Document

## Introduction

The Inventory Module is a comprehensive feature for the Car Expert Organization within the CBIS (Centralized Business Information System) platform. It provides product and accessories inventory management, purchase order creation and tracking, and monthly inventory reporting with daily sales breakdown. The module is built as a NestJS backend with PostgreSQL/Supabase, serving a separate Angular frontend via REST APIs. The system is multi-tenant, scoped by organization.

## Glossary

- **Inventory_Service**: The NestJS backend service responsible for inventory data operations, scoped to an organization
- **Product**: A car accessory or part tracked in the inventory system (stored in `tblinventory`)
- **Purchase_Order**: A record of products ordered from a supplier to replenish inventory (stored in `tblpurchases`)
- **PO_Item**: A line item within a Purchase Order specifying product, quantity, and unit cost (stored in `tblpo_items`)
- **Supplier**: A vendor from whom products are purchased (stored in `tblsuppliers`)
- **Stock_Status**: A classification of inventory health — Good (quantity above warning threshold), Warning (quantity at or near warning threshold), Bad (quantity below warning threshold or zero)
- **SRP**: Suggested Retail Price — the selling price of a product
- **Month_Sales**: The total monetary sales value for a product in the current calendar month
- **Purchased_Quantity**: The total number of units sold for a product in the current calendar month
- **Beginning_Balance**: The stock quantity of a product at the start of a given month
- **Ending_Inventory**: Calculated as Beginning_Balance + Total_Purchase - Total_Sales for the month
- **Actual_Count**: The physical count of inventory entered by a user at the end of the month
- **Inventory_Shortage**: The difference between Ending_Inventory and Actual_Count
- **Report_Service**: The component responsible for generating monthly inventory reports
- **Payment_Details**: Payment information associated with a Purchase Order including type, date, amount, reference number, and notes

## Requirements

### Requirement 1: Inventory List with Server-Side Pagination

**User Story:** As an inventory manager, I want to view a paginated list of all products with key metrics, so that I can monitor stock levels and sales performance efficiently.

#### Acceptance Criteria

1. WHEN a page request is received with page number and page size parameters, THE Inventory_Service SHALL return the corresponding page of Product records ordered by product name ascending.
2. THE Inventory_Service SHALL return pagination metadata including total record count, current page, page size, and total pages alongside the Product data.
3. WHEN a page request is received, THE Inventory_Service SHALL include for each Product: product name, brand, category, quantity, cost, SRP, Purchased_Quantity for the current month, Month_Sales for the current month, and Stock_Status.
4. THE Inventory_Service SHALL calculate Stock_Status as "Good" when quantity is above the stock warning threshold, "Warning" when quantity equals the stock warning threshold, and "Bad" when quantity is below the stock warning threshold.
5. WHEN a page of results is returned, THE Inventory_Service SHALL include a totals summary row containing the sum of quantity, cost, SRP, Purchased_Quantity, and Month_Sales for the displayed page results.

### Requirement 2: Inventory List Filtering

**User Story:** As an inventory manager, I want to filter the inventory list by search text, stock status, and delivery date range, so that I can quickly find specific products or identify stock issues.

#### Acceptance Criteria

1. WHEN a search query is provided, THE Inventory_Service SHALL filter Products whose product name, brand, or category contains the search text (case-insensitive).
2. WHEN a Stock_Status filter is provided (Good, Warning, or Bad), THE Inventory_Service SHALL return only Products matching the selected stock status classification.
3. WHEN a delivery date range is provided (start date and end date), THE Inventory_Service SHALL return only Products that have associated Purchase_Order deliveries within the specified date range.
4. WHEN multiple filters are provided simultaneously, THE Inventory_Service SHALL apply all filters using AND logic and return only Products matching all criteria.
5. WHEN filters are applied, THE Inventory_Service SHALL reset pagination to page 1 and recalculate the totals summary based on filtered results.

### Requirement 3: Add New Product

**User Story:** As an inventory manager, I want to add new products to the inventory, so that I can track new car accessories and parts.

#### Acceptance Criteria

1. WHEN a create product request is received with a valid product name, THE Inventory_Service SHALL create a new Product record with the provided details.
2. THE Inventory_Service SHALL require product name as a mandatory field for product creation.
3. WHEN a create product request is received, THE Inventory_Service SHALL accept optional fields: brand, category, description, stock quantity, stock warning threshold, cost price, selling price (SRP), and maximum discount price.
4. IF a create product request is received with a missing product name, THEN THE Inventory_Service SHALL return a validation error with a descriptive message.
5. WHEN a Product is created successfully, THE Inventory_Service SHALL return the new Product identifier.

### Requirement 4: Download Inventory

**User Story:** As an inventory manager, I want to download the current inventory data, so that I can share it with stakeholders or perform offline analysis.

#### Acceptance Criteria

1. WHEN a download inventory request is received, THE Inventory_Service SHALL generate a file containing all Products matching the current filter criteria.
2. THE Inventory_Service SHALL include in the download: product name, brand, category, quantity, cost, SRP, Purchased_Quantity, Month_Sales, and Stock_Status for each Product.
3. WHEN the download is generated, THE Inventory_Service SHALL return the file in a structured format (CSV or Excel).

### Requirement 5: Purchase Order Creation

**User Story:** As an inventory manager, I want to create purchase orders with multiple items and payment details, so that I can track product procurement from suppliers.

#### Acceptance Criteria

1. WHEN a create Purchase_Order request is received, THE Inventory_Service SHALL require a Supplier selection.
2. WHEN a create Purchase_Order request is received, THE Inventory_Service SHALL accept Payment_Details including payment type, payment date, payment amount, reference number, and notes.
3. WHEN a Product is selected for a PO_Item and the Product exists in inventory, THE Inventory_Service SHALL use the existing Product record and skip brand/category fields.
4. WHEN a Product is selected for a PO_Item and the Product does not exist in inventory, THE Inventory_Service SHALL accept new product fields including brand and category to create a new Product record.
5. WHEN a PO_Item is added, THE Inventory_Service SHALL require quantity and unit cost fields.
6. THE Inventory_Service SHALL allow multiple PO_Items to be added to a single Purchase_Order.
7. WHEN a Purchase_Order is created, THE Inventory_Service SHALL calculate the total cost as the sum of (quantity multiplied by unit cost) for all PO_Items.
8. WHEN a create Purchase_Order request is received, THE Inventory_Service SHALL accept an optional comments/remarks text field.
9. WHEN a Purchase_Order is created successfully, THE Inventory_Service SHALL return the new Purchase_Order identifier and generated PO number.
10. IF a create Purchase_Order request is received without a Supplier, THEN THE Inventory_Service SHALL return a validation error.
11. IF a create Purchase_Order request is received without at least one PO_Item, THEN THE Inventory_Service SHALL return a validation error.

### Requirement 6: Purchase Order Viewing

**User Story:** As an inventory manager, I want to view the full details of a purchase order, so that I can review what was ordered, from whom, and the payment information.

#### Acceptance Criteria

1. WHEN a view Purchase_Order request is received with a valid PO identifier, THE Inventory_Service SHALL return the Purchase_Order header details including PO number, Supplier name, order date, status, and comments/remarks.
2. WHEN a view Purchase_Order request is received, THE Inventory_Service SHALL return all PO_Items including product name, quantity, unit cost, and line total.
3. WHEN a view Purchase_Order request is received, THE Inventory_Service SHALL return the Payment_Details associated with the Purchase_Order.
4. WHEN a view Purchase_Order request is received, THE Inventory_Service SHALL return the total ordered quantity and total cost across all PO_Items.
5. IF a view Purchase_Order request is received with an invalid or non-existent PO identifier, THEN THE Inventory_Service SHALL return a not-found error with a descriptive message.

### Requirement 7: Purchase Order List

**User Story:** As an inventory manager, I want to view a list of all purchase orders, so that I can track procurement history and status.

#### Acceptance Criteria

1. WHEN a list Purchase_Orders request is received, THE Inventory_Service SHALL return all Purchase_Orders for the organization ordered by creation date descending.
2. THE Inventory_Service SHALL include for each Purchase_Order: PO number, Supplier name, order products (maximum 3 product names displayed, with an indicator when more exist), total ordered quantity, total cost, and order date.
3. WHEN a Purchase_Order has more than 3 PO_Items, THE Inventory_Service SHALL return the first 3 product names and a flag indicating additional items exist.

### Requirement 8: Supplier Smart Search

**User Story:** As an inventory manager, I want to search for suppliers by name when creating a purchase order, so that I can quickly select the correct supplier.

#### Acceptance Criteria

1. WHEN a supplier search query is received, THE Inventory_Service SHALL return Suppliers whose name contains the search text (case-insensitive), limited to 20 results.
2. THE Inventory_Service SHALL return for each matching Supplier: identifier, name, contact information, email, and address.

### Requirement 9: Product Smart Search for Purchase Orders

**User Story:** As an inventory manager, I want to search for existing products when adding items to a purchase order, so that I can link deliveries to existing inventory or create new products.

#### Acceptance Criteria

1. WHEN a product search query is received, THE Inventory_Service SHALL return Products whose product name or brand contains the search text (case-insensitive), limited to 20 results.
2. THE Inventory_Service SHALL return for each matching Product: identifier, product name, brand, category, current stock quantity, cost price, and selling price.
3. WHEN a product search returns results, THE Inventory_Service SHALL include a flag indicating whether each Product already exists in inventory.

### Requirement 10: Monthly Inventory Report Generation

**User Story:** As an inventory manager, I want to generate a monthly inventory report filtered by month and category, so that I can track daily sales, purchases, and identify inventory shortages.

#### Acceptance Criteria

1. WHEN a report request is received with a month and optional category filter, THE Report_Service SHALL return a report containing all Products matching the filter criteria.
2. THE Report_Service SHALL include for each Product in the report: product name/description, unit cost, SRP, and Beginning_Balance for the selected month.
3. THE Report_Service SHALL include daily sales columns for each day of the selected month, showing the quantity sold on each day.
4. THE Report_Service SHALL calculate Total_Sales as the sum of all daily sales quantities for the month.
5. THE Report_Service SHALL calculate Total_Purchase as the sum of all quantities received via Purchase_Orders during the month.
6. THE Report_Service SHALL calculate Ending_Inventory as Beginning_Balance plus Total_Purchase minus Total_Sales.
7. THE Report_Service SHALL include the Actual_Count field representing the user-entered physical count at month end.
8. THE Report_Service SHALL calculate Inventory_Shortage as Ending_Inventory minus Actual_Count.
9. THE Report_Service SHALL assign a remark of "GOOD" when Ending_Inventory equals Actual_Count, and "BAD" when Ending_Inventory does not equal Actual_Count.

### Requirement 11: Actual Count Entry

**User Story:** As an inventory manager, I want to enter the actual physical count for each product at the end of the month, so that the system can calculate inventory shortages.

#### Acceptance Criteria

1. WHEN an actual count update request is received with a product identifier, month, and count value, THE Inventory_Service SHALL store the Actual_Count for that Product and month.
2. THE Inventory_Service SHALL accept Actual_Count values as non-negative integers.
3. IF an actual count update request is received with a negative value, THEN THE Inventory_Service SHALL return a validation error.
4. WHEN an Actual_Count is stored, THE Report_Service SHALL recalculate Inventory_Shortage and update the remark for the affected Product.

### Requirement 12: Report Export to Excel

**User Story:** As an inventory manager, I want to export the monthly inventory report to Excel, so that I can share it with management or perform further analysis offline.

#### Acceptance Criteria

1. WHEN an export report request is received with month and optional category filter, THE Report_Service SHALL generate an Excel file containing the full monthly report data.
2. THE Report_Service SHALL structure the Excel file with the same columns as the on-screen report: product name, unit cost, SRP, Beginning_Balance, daily sales columns, Total_Sales, Total_Purchase, Ending_Inventory, Actual_Count, Inventory_Shortage, and Remarks.
3. WHEN the Excel file is generated, THE Report_Service SHALL return the file as a downloadable binary response with appropriate content-type headers.

### Requirement 13: Purchase Order Receiving and Stock Update

**User Story:** As an inventory manager, I want to receive a purchase order so that product quantities are automatically added to inventory stock.

#### Acceptance Criteria

1. WHEN a receive Purchase_Order request is received, THE Inventory_Service SHALL increase the stock quantity of each Product referenced in the PO_Items by the ordered quantity.
2. WHEN a Purchase_Order is received, THE Inventory_Service SHALL update the Purchase_Order status to "received".
3. THE Inventory_Service SHALL execute stock updates and status change within a single database transaction to maintain data consistency.
4. IF a receive request is made for a Purchase_Order that is already received, THEN THE Inventory_Service SHALL return an error indicating the order has already been received.

### Requirement 14: Organization Scoping

**User Story:** As a system administrator, I want all inventory operations scoped to the authenticated user's organization, so that data is isolated between tenants.

#### Acceptance Criteria

1. THE Inventory_Service SHALL scope all Product queries to the authenticated user's organization identifier.
2. THE Inventory_Service SHALL scope all Purchase_Order queries to the authenticated user's organization identifier.
3. THE Inventory_Service SHALL scope all Supplier queries to the authenticated user's organization identifier.
4. THE Report_Service SHALL scope all report data to the authenticated user's organization identifier.
5. IF a request attempts to access a resource belonging to a different organization, THEN THE Inventory_Service SHALL return a not-found error without revealing the resource exists.
