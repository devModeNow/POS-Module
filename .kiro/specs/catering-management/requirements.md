# Requirements Document

## Introduction

The Catering Management Module is a comprehensive feature for STS Catering Services within the CBIS (Centralized Business Information System) platform. It provides public-facing scheduling and customer feedback capabilities, an internal admin dashboard for monitoring operations, schedule lifecycle management with expense tracking, and a full menu/package management system. The module is built as a NestJS backend with PostgreSQL/Supabase, serving an Angular frontend via REST APIs. The system is multi-tenant, scoped by organization. The frontend uses Angular standalone components with Tailwind CSS, and the backend follows the existing NestJS module pattern (controller → service → PostgreSQL via pg). The STS Catering Services organization already exists in the database.

## Glossary

- **Scheduling_Service**: The NestJS backend service responsible for catering schedule operations, scoped to an organization
- **Menu_Service**: The NestJS backend service responsible for menu item and package management, scoped to an organization
- **Dashboard_Service**: The NestJS backend service responsible for aggregating dashboard metrics, scoped to an organization
- **Feedback_Service**: The NestJS backend service responsible for customer feedback and rating operations
- **Scheduling_UI**: The Angular frontend component(s) responsible for rendering the public scheduling form and admin schedule management views
- **Menu_UI**: The Angular frontend component(s) responsible for rendering menu item and package management views
- **Dashboard_UI**: The Angular frontend component(s) responsible for rendering the catering dashboard with metrics and feedback
- **Schedule**: A catering event booking record containing customer details, venue, event date, number of guests, and selected package
- **Schedule_Status**: The lifecycle state of a Schedule — Pending (awaiting confirmation), In-Progress (confirmed and active), or Completed (event finished with expenses recorded)
- **Menu_Item**: A single food item belonging to a specific category (e.g., chicken adobo under the chicken category)
- **Menu_Category**: A classification for menu items — chicken, pork, vegetable, seafood, beef, soup, pasta, salad, drinks, dessert, appetizer, or freebie
- **Package**: A bundled catering offering with a name, price per head, minimum pax requirement, and a collection of menu items organized by category
- **Category_Selection_Limit**: A configurable number defining how many menu items a customer can select from a specific category within a Package
- **Operational_Expense**: A cost record associated with a completed Schedule, categorized into predefined expense types
- **Expense_Category**: A classification for operational expenses — Purchases, Rental, Electricity & Water, Communication, Salaries & Wages, Supplies & Materials, Repair & Maintenance, Travel & Transportation, Representation, SSS, Philhealth, Pag IBIG, Taxes, Licenses, Professional Fee, or Miscellaneous
- **Customer_Feedback**: A rating and review submitted by a customer after their catering event
- **Rating_Link**: A unique URL generated for a specific Schedule that allows the customer to submit feedback without authentication
- **Pax**: The number of guests or persons to be served at a catering event

## Requirements

### Requirement 1: Public Scheduling Form Submission

**User Story:** As a potential customer, I want to submit a catering scheduling request through a public form, so that I can book STS Catering Services for my event without needing to create an account.

#### Acceptance Criteria

1. THE Scheduling_Service SHALL provide a public API endpoint that does not require authentication for schedule submission.
2. WHEN a scheduling request is received, THE Scheduling_Service SHALL require the following fields: customer name (maximum 100 characters), contact number (maximum 15 characters, digits only), venue (maximum 200 characters), target date of event, number of pax, and selected Package identifier.
3. WHEN a valid scheduling request is received with all required fields, THE Scheduling_Service SHALL create a new Schedule record with Schedule_Status set to Pending.
4. WHEN a Schedule is created successfully, THE Scheduling_Service SHALL return a confirmation response containing the message "Thank you for Scheduling with us" and a prompt to complete a scheduling experience feedback form.
5. IF a scheduling request is received with any missing required field, THEN THE Scheduling_Service SHALL return a validation error with a descriptive message identifying the missing fields.
6. IF a scheduling request is received with a target date of event in the past (compared against the current server date in UTC), THEN THE Scheduling_Service SHALL return a validation error indicating the event date must be a future date.
7. IF a scheduling request is received with a number of pax less than 1, THEN THE Scheduling_Service SHALL return a validation error indicating the number of pax must be a positive integer.
8. IF a scheduling request is received with a number of pax less than the selected Package's minimum pax, THEN THE Scheduling_Service SHALL return a validation error indicating the number of pax does not meet the package minimum requirement.
9. IF a scheduling request is received with an invalid Package identifier, THEN THE Scheduling_Service SHALL return a validation error indicating the selected package does not exist.
10. WHEN a Schedule is created, THE Scheduling_Service SHALL associate the Schedule with the STS Catering Services organization.
11. IF a scheduling request is received with a customer name exceeding 100 characters, THEN THE Scheduling_Service SHALL return a validation error indicating the customer name must not exceed 100 characters.
12. IF a scheduling request is received with a contact number exceeding 15 characters or containing non-digit characters, THEN THE Scheduling_Service SHALL return a validation error indicating the contact number must be at most 15 digits and contain only numeric characters.
13. IF a scheduling request is received with a venue exceeding 200 characters, THEN THE Scheduling_Service SHALL return a validation error indicating the venue must not exceed 200 characters.

### Requirement 2: Public Scheduling Form UI

**User Story:** As a potential customer, I want to access a user-friendly scheduling form on the web, so that I can easily fill in my event details and submit a booking request.

#### Acceptance Criteria

1. THE Scheduling_UI SHALL render a public scheduling form page accessible without authentication at a dedicated route.
2. THE Scheduling_UI SHALL display input fields for: customer name (text, maximum 100 characters), contact number (text, maximum 15 characters, digits only), venue (text, maximum 200 characters), target date of event (date picker restricted to future dates), number of pax (numeric, minimum 1, maximum 10000), and a dropdown/selector for available Packages.
3. WHEN the public scheduling form loads, THE Scheduling_UI SHALL fetch available Packages from the Menu_Service public endpoint and display each Package in the selector showing the package name, price per head, and minimum pax.
4. IF the Scheduling_UI fails to fetch Packages from the Menu_Service public endpoint, THEN THE Scheduling_UI SHALL display an error message indicating that packages could not be loaded and disable form submission.
5. THE Scheduling_UI SHALL validate all required fields on the client side before submission: customer name is not empty, contact number is not empty and contains only digits, venue is not empty, target date of event is a future date, number of pax is a positive integer greater than or equal to the selected Package's minimum pax, and a Package is selected. THE Scheduling_UI SHALL display inline validation messages adjacent to each field that fails validation.
6. WHEN the form is submitted successfully, THE Scheduling_UI SHALL display a confirmation message "Thank you for Scheduling with us" and present the scheduling experience feedback form.
7. IF the form submission fails due to a server validation error, THEN THE Scheduling_UI SHALL display the error message returned by the Scheduling_Service.
8. IF the form submission fails due to a network error or server unavailability, THEN THE Scheduling_UI SHALL display an error message indicating the submission could not be completed and preserve the user's entered form data.

### Requirement 3: Scheduling Experience Feedback

**User Story:** As a customer who just submitted a scheduling request, I want to provide feedback on the scheduling experience, so that STS Catering Services can improve their booking process.

#### Acceptance Criteria

1. WHEN a scheduling experience feedback request is received with a valid Schedule identifier, THE Feedback_Service SHALL store the feedback associated with that Schedule.
2. THE Feedback_Service SHALL accept an integer rating value (1 to 5) and an optional text comment with a maximum length of 500 characters for the scheduling experience feedback.
3. IF a feedback request is received with a rating value outside the range of 1 to 5 or a non-integer value, THEN THE Feedback_Service SHALL return a validation error indicating the rating must be a whole number between 1 and 5.
4. THE Feedback_Service SHALL provide a public API endpoint that does not require authentication for scheduling experience feedback submission.
5. IF a feedback request is received with an invalid Schedule identifier, THEN THE Feedback_Service SHALL return a not-found error.
6. IF a feedback request is received for a Schedule that already has scheduling experience feedback recorded, THEN THE Feedback_Service SHALL return an error indicating feedback has already been submitted for this schedule.
7. WHEN the confirmation message is displayed after scheduling, THE Scheduling_UI SHALL render a feedback form with a star rating input (1 to 5) and an optional comment text area with a maximum length of 500 characters.
8. WHEN the customer submits the feedback form, THE Scheduling_UI SHALL send the rating and comment to the Feedback_Service and display a thank-you acknowledgment message upon success.
9. IF the feedback form submission fails due to a server error, THEN THE Scheduling_UI SHALL display the error message returned by the Feedback_Service.

### Requirement 4: Customer Satisfaction Rating via Link

**User Story:** As an admin, I want to generate a unique rating link for a completed event, so that I can send it to the customer to collect their satisfaction feedback about the catering service.

#### Acceptance Criteria

1. WHEN a generate rating link request is received with a valid Schedule identifier for a Schedule with Schedule_Status equal to Completed, THE Feedback_Service SHALL create a unique Rating_Link associated with that Schedule with an expiration period of 30 days from generation.
2. THE Feedback_Service SHALL return the generated Rating_Link URL that can be shared with the customer.
3. WHEN a customer accesses a valid Rating_Link, THE Feedback_Service SHALL allow the customer to submit a satisfaction rating (1 to 5) and an optional text review (maximum 1000 characters) without authentication.
4. WHEN a customer submits feedback through a Rating_Link, THE Feedback_Service SHALL store the rating and review associated with the corresponding Schedule.
5. IF a Rating_Link that has already been used for feedback submission is accessed again, THEN THE Feedback_Service SHALL return a message indicating feedback has already been submitted.
6. IF an invalid or expired Rating_Link is accessed, THEN THE Feedback_Service SHALL return a not-found error with a descriptive message indicating the link is invalid or has expired past its 30-day validity period.
7. THE Feedback_Service SHALL scope rating link generation to authenticated admin users of the organization.
8. THE Scheduling_UI SHALL render a public rating page at the Rating_Link URL with a star rating input (1 to 5), an optional review text area (maximum 1000 characters), and a submit button.
9. WHEN the rating is submitted successfully, THE Scheduling_UI SHALL display a thank-you message to the customer.
10. IF a generate rating link request is received for a Schedule that does not have Schedule_Status equal to Completed, THEN THE Feedback_Service SHALL return an error indicating that rating links can only be generated for completed schedules.
11. IF a customer submits feedback through a Rating_Link with a rating value outside the range of 1 to 5, THEN THE Feedback_Service SHALL return a validation error indicating the rating must be between 1 and 5.

### Requirement 5: Dashboard Metrics Cards

**User Story:** As an admin, I want to see summary cards on the dashboard showing key operational metrics, so that I can quickly assess the current state of the catering business.

#### Acceptance Criteria

1. WHEN a dashboard metrics request is received, THE Dashboard_Service SHALL return the count of Schedules with Schedule_Status equal to Pending (unconfirmed schedules).
2. WHEN a dashboard metrics request is received, THE Dashboard_Service SHALL return the count of Schedules with Schedule_Status equal to In-Progress (confirmed schedules).
3. WHEN a dashboard metrics request is received, THE Dashboard_Service SHALL return the total sales amount calculated from all Completed Schedules (sum of pax multiplied by package price per head), rounded to 2 decimal places.
4. WHEN a dashboard metrics request is received, THE Dashboard_Service SHALL return the total expenses amount calculated from all Operational_Expense records associated with Completed Schedules, rounded to 2 decimal places.
5. THE Dashboard_Service SHALL scope all metrics to the authenticated user's organization identifier.
6. THE Dashboard_UI SHALL display four summary cards: Unconfirmed Schedules (count), Confirmed Schedules (count), Total Sales (currency with 2 decimal places), and Total Expenses (currency with 2 decimal places).
7. WHEN the dashboard page loads, THE Dashboard_UI SHALL fetch metrics from the Dashboard_Service and populate the summary cards, displaying 0 for counts and 0.00 for currency values when no matching records exist.
8. IF the Dashboard_UI fails to retrieve metrics from the Dashboard_Service, THEN THE Dashboard_UI SHALL display an error message indicating that metrics could not be loaded and provide a retry option.

### Requirement 6: Dashboard Customer Feedback List

**User Story:** As an admin, I want to see a list of customer feedback, reviews, and ratings on the dashboard, so that I can monitor customer satisfaction and identify areas for improvement.

#### Acceptance Criteria

1. WHEN a dashboard feedback list request is received, THE Dashboard_Service SHALL return a paginated list of Customer_Feedback records (maximum 50 records per page) ordered by submission date descending.
2. THE Dashboard_Service SHALL include for each Customer_Feedback record: customer name, rating value (1 to 5), review text, submission date, and associated Schedule event date.
3. WHEN a dashboard feedback list request is received, THE Dashboard_Service SHALL return the overall average rating across all Customer_Feedback records, rounded to one decimal place.
4. THE Dashboard_Service SHALL scope all feedback data to the authenticated user's organization identifier.
5. THE Dashboard_Service SHALL include Customer_Feedback records of all feedback types (scheduling experience and satisfaction rating) in the dashboard feedback list.
6. THE Dashboard_UI SHALL display a section listing customer feedback with each entry showing: customer name, star rating (1 to 5), review text, submission date, and event date.
7. THE Dashboard_UI SHALL display the overall average rating above the feedback list at the top of the feedback section.
8. IF no Customer_Feedback records exist for the organization, THEN THE Dashboard_Service SHALL return an empty list and an average rating of zero.
9. IF no Customer_Feedback records exist for the organization, THEN THE Dashboard_UI SHALL display a message indicating no feedback has been received yet.

### Requirement 7: Schedule List with Status Filtering

**User Story:** As an admin, I want to view schedules separated by their status (Pending, In-Progress, Completed), so that I can manage the catering event lifecycle efficiently.

#### Acceptance Criteria

1. WHEN a schedule list request is received with a status filter of Pending, THE Scheduling_Service SHALL return all Schedules with Schedule_Status equal to Pending, ordered by target event date ascending.
2. WHEN a schedule list request is received with a status filter of In-Progress, THE Scheduling_Service SHALL return all Schedules with Schedule_Status equal to In-Progress, ordered by target event date ascending.
3. WHEN a schedule list request is received with a status filter of Completed, THE Scheduling_Service SHALL return all Schedules with Schedule_Status equal to Completed, ordered by target event date descending.
4. THE Scheduling_Service SHALL include for each Schedule: customer name, contact number, venue, target event date, number of pax, selected Package name, and Schedule_Status.
5. THE Scheduling_Service SHALL scope all schedule queries to the authenticated user's organization identifier.
6. THE Scheduling_UI SHALL display a schedule management page with three tabs or sections: Pending, In-Progress, and Completed.
7. THE Scheduling_UI SHALL render each Schedule as a list item or card showing customer name, contact number, venue, event date, number of pax, and package name.
8. WHEN the Pending tab is active, THE Scheduling_UI SHALL display a "Confirm" action button for each Schedule.
9. WHEN the In-Progress tab is active, THE Scheduling_UI SHALL display a "Complete" action button for each Schedule.

### Requirement 8: Schedule Confirmation (Pending to In-Progress)

**User Story:** As an admin, I want to confirm a pending schedule, so that the catering event is officially booked and moves to the active stage.

#### Acceptance Criteria

1. WHEN a confirm schedule request is received with a valid Schedule identifier, THE Scheduling_Service SHALL update the Schedule_Status from Pending to In-Progress and return the updated Schedule record including the new Schedule_Status.
2. IF a confirm schedule request is received for a Schedule that is not in Pending status, THEN THE Scheduling_Service SHALL return an error indicating only Pending schedules can be confirmed.
3. IF a confirm schedule request is received with an invalid Schedule identifier, THEN THE Scheduling_Service SHALL return a not-found error.
4. THE Scheduling_Service SHALL scope the confirm operation to the authenticated user's organization identifier.
5. WHEN the admin clicks the "Confirm" button on a Pending schedule, THE Scheduling_UI SHALL send a confirm request to the Scheduling_Service and move the Schedule to the In-Progress list upon success.
6. IF the confirm request fails, THEN THE Scheduling_UI SHALL display the error message returned by the Scheduling_Service and keep the Schedule in the Pending list unchanged.

### Requirement 9: Schedule Completion with Operational Expenses

**User Story:** As an admin, I want to mark an in-progress schedule as completed and record the operational expenses, so that I can track costs and generate accurate financial data.

#### Acceptance Criteria

1. WHEN a complete schedule request is received with a valid Schedule identifier and Operational_Expense records, THE Scheduling_Service SHALL update the Schedule_Status from In-Progress to Completed.
2. WHEN a complete schedule request is received, THE Scheduling_Service SHALL accept Operational_Expense entries for each Expense_Category: Purchases, Rental, Electricity & Water, Communication, Salaries & Wages, Supplies & Materials, Repair & Maintenance, Travel & Transportation, Representation, SSS, Philhealth, Pag IBIG, Taxes, Licenses, Professional Fee, and Miscellaneous, where each category entry is optional and defaults to 0.00 if not provided.
3. WHEN Operational_Expense entries are provided, THE Scheduling_Service SHALL store each expense with its Expense_Category and amount value.
4. THE Scheduling_Service SHALL accept expense amounts as non-negative numeric values with up to two decimal places, within the range of 0.00 to 999,999,999.99.
5. IF a complete schedule request is received for a Schedule that is not in In-Progress status, THEN THE Scheduling_Service SHALL return an error indicating only In-Progress schedules can be completed.
6. IF a complete schedule request is received with a negative expense amount or an amount exceeding 999,999,999.99, THEN THE Scheduling_Service SHALL return a validation error indicating the acceptable range.
7. WHEN a Schedule is completed, THE Scheduling_Service SHALL calculate and store the total operational expense as the sum of all Operational_Expense amounts.
8. THE Scheduling_Service SHALL scope the complete operation to the authenticated user's organization identifier.
9. IF a complete schedule request is received with an invalid or non-existent Schedule identifier, THEN THE Scheduling_Service SHALL return a not-found error.
10. WHEN the admin clicks the "Complete" button on an In-Progress schedule, THE Scheduling_UI SHALL display a modal or form with input fields for each Expense_Category (Purchases, Rental, Electricity & Water, Communication, Salaries & Wages, Supplies & Materials, Repair & Maintenance, Travel & Transportation, Representation, SSS, Philhealth, Pag IBIG, Taxes, Licenses, Professional Fee, Miscellaneous), each defaulting to 0.00.
11. WHEN the admin submits the expense form, THE Scheduling_UI SHALL send the completion request with all expense amounts to the Scheduling_Service and move the Schedule to the Completed list upon success.
12. IF the completion request fails due to a validation or status error, THEN THE Scheduling_UI SHALL display the error message returned by the Scheduling_Service and keep the expense form open with the entered values preserved.

### Requirement 10: Menu Item Management

**User Story:** As an admin, I want to manage individual menu items organized by category, so that I can maintain an up-to-date list of food offerings for package creation.

#### Acceptance Criteria

1. WHEN a create menu item request is received with a valid name and Menu_Category, THE Menu_Service SHALL create a new Menu_Item record.
2. THE Menu_Service SHALL require a name and Menu_Category for menu item creation.
3. THE Menu_Service SHALL accept only the following values for Menu_Category: chicken, pork, vegetable, seafood, beef, soup, pasta, salad, drinks, dessert, appetizer, or freebie.
4. WHEN a list menu items request is received, THE Menu_Service SHALL return all Menu_Item records grouped by Menu_Category.
5. WHEN an update menu item request is received with a valid Menu_Item identifier, THE Menu_Service SHALL update the specified fields.
6. WHEN a delete menu item request is received with a valid Menu_Item identifier, THE Menu_Service SHALL remove the Menu_Item record.
7. IF a create menu item request is received with an invalid Menu_Category, THEN THE Menu_Service SHALL return a validation error listing the valid categories.
8. IF a delete request targets a Menu_Item that is referenced by an active Package, THEN THE Menu_Service SHALL return an error indicating the item cannot be deleted while in use.
9. THE Menu_Service SHALL scope all menu item operations to the authenticated user's organization identifier.
10. THE Menu_UI SHALL display a menu management page with a list of Menu_Items grouped by Menu_Category.
11. THE Menu_UI SHALL provide an "Add Menu Item" form or modal with fields for item name and a category dropdown.
12. THE Menu_UI SHALL provide edit and delete actions for each Menu_Item in the list.

### Requirement 11: Package Management

**User Story:** As an admin, I want to create and manage catering packages that bundle menu items with pricing, so that customers can select a package when scheduling an event.

#### Acceptance Criteria

1. WHEN a create package request is received, THE Menu_Service SHALL require: package name (maximum 100 characters), price per head (between 0.01 and 999,999,999.99), and minimum pax (between 1 and 10,000).
2. WHEN a create package request is received, THE Menu_Service SHALL accept a collection of at least one Menu_Item identifier organized by Menu_Category.
3. WHEN a create package request is received, THE Menu_Service SHALL accept a Category_Selection_Limit for each Menu_Category included in the package, defining how many items a customer can select from that category, with a minimum value of 1 and not exceeding the number of menu items provided for that category.
4. WHEN a valid create package request is received, THE Menu_Service SHALL create a new Package record with all associated menu items and category selection limits.
5. WHEN a list packages request is received, THE Menu_Service SHALL return all Package records including package name, price per head, minimum pax, and the menu items organized by category with their Category_Selection_Limits.
6. WHEN an update package request is received with a valid Package identifier, THE Menu_Service SHALL update the specified fields including menu item associations and category selection limits, applying the same validation rules as creation for any fields provided.
7. WHEN a delete package request is received with a valid Package identifier, THE Menu_Service SHALL remove the Package record.
8. IF a create or update package request is received with a price per head less than or equal to zero or greater than 999,999,999.99, THEN THE Menu_Service SHALL return a validation error.
9. IF a create or update package request is received with a minimum pax less than 1 or greater than 10,000, THEN THE Menu_Service SHALL return a validation error.
10. IF a delete request targets a Package that is referenced by an active Schedule (Pending or In-Progress), THEN THE Menu_Service SHALL return an error indicating the package cannot be deleted while in use.
11. THE Menu_Service SHALL scope all package operations to the authenticated user's organization identifier.
12. THE Menu_UI SHALL display a package list showing each Package with its name, price per head, minimum pax, and a summary of included menu items.
13. THE Menu_UI SHALL provide a "Create Package" form or modal with fields for package name, price per head, minimum pax, and a multi-select interface for choosing menu items per category with configurable Category_Selection_Limits.
14. THE Menu_UI SHALL provide edit and delete actions for each Package in the list.
15. IF a create or update package request includes a Menu_Item identifier that does not exist or does not belong to the authenticated user's organization, THEN THE Menu_Service SHALL return a validation error indicating the invalid menu item.
16. IF an update or delete package request is received with a Package identifier that does not exist, THEN THE Menu_Service SHALL return a not-found error.
17. IF a create package request is received with an empty package name or a package name exceeding 100 characters, THEN THE Menu_Service SHALL return a validation error.

### Requirement 12: Public Package Listing for Scheduling Form

**User Story:** As a potential customer filling out the scheduling form, I want to see available catering packages with their details, so that I can select the most suitable package for my event.

#### Acceptance Criteria

1. THE Menu_Service SHALL provide a public API endpoint that does not require authentication for listing available packages.
2. WHEN a public package list request is received with an organization identifier, THE Menu_Service SHALL return all active Package records for that organization.
3. THE Menu_Service SHALL include for each Package: package name, price per head, minimum pax, and menu items organized by category with Category_Selection_Limits.

### Requirement 13: Database Schema for Catering Module

**User Story:** As a developer, I want a well-structured database schema for the catering module, so that all catering data is properly stored and queryable within the existing multi-tenant PostgreSQL database.

#### Acceptance Criteria

1. THE Scheduling_Service SHALL store Schedule records in a dedicated catering schedules table with columns for: BIGSERIAL identifier, organization identifier (BIGINT referencing the organizations table), customer name (VARCHAR 100), contact number (VARCHAR 50), venue (TEXT), target event date (DATE), number of pax (INTEGER), selected package identifier (BIGINT), Schedule_Status (VARCHAR 20 with a CHECK constraint allowing only 'pending', 'in_progress', or 'completed'), created_at (TIMESTAMPTZ defaulting to NOW()), and updated_at (TIMESTAMPTZ).
2. THE Menu_Service SHALL store Menu_Item records in a dedicated catering menu items table with columns for: BIGSERIAL identifier, organization identifier (BIGINT referencing the organizations table), item name (VARCHAR 100), Menu_Category (VARCHAR 20 with a CHECK constraint allowing only 'chicken', 'pork', 'vegetable', 'seafood', 'beef', 'soup', 'pasta', 'salad', 'drinks', 'dessert', 'appetizer', or 'freebie'), created_at (TIMESTAMPTZ defaulting to NOW()), and updated_at (TIMESTAMPTZ).
3. THE Menu_Service SHALL store Package records in a dedicated catering packages table with columns for: BIGSERIAL identifier, organization identifier (BIGINT referencing the organizations table), package name (VARCHAR 100), price per head (NUMERIC 12,2), minimum pax (INTEGER with a CHECK constraint requiring value greater than or equal to 1), created_at (TIMESTAMPTZ defaulting to NOW()), and updated_at (TIMESTAMPTZ).
4. THE Menu_Service SHALL store package-to-menu-item associations in a junction table with columns for: package identifier (BIGINT), menu item identifier (BIGINT), Category_Selection_Limit (INTEGER with a CHECK constraint requiring value greater than or equal to 1), and a composite unique constraint on (package identifier, menu item identifier).
5. THE Scheduling_Service SHALL store Operational_Expense records in a dedicated catering expenses table with columns for: BIGSERIAL identifier, schedule identifier (BIGINT), Expense_Category (VARCHAR 50 with a CHECK constraint allowing only 'Purchases', 'Rental', 'Electricity & Water', 'Communication', 'Salaries & Wages', 'Supplies & Materials', 'Repair & Maintenance', 'Travel & Transportation', 'Representation', 'SSS', 'Philhealth', 'Pag IBIG', 'Taxes', 'Licenses', 'Professional Fee', or 'Miscellaneous'), amount (NUMERIC 12,2 with a CHECK constraint requiring value greater than or equal to 0), created_at (TIMESTAMPTZ defaulting to NOW()), and updated_at (TIMESTAMPTZ).
6. THE Feedback_Service SHALL store Customer_Feedback records in a dedicated catering feedback table with columns for: BIGSERIAL identifier, schedule identifier (BIGINT), feedback type (VARCHAR 30 with a CHECK constraint allowing only 'scheduling_experience' or 'satisfaction_rating'), rating value (INTEGER with a CHECK constraint requiring value between 1 and 5 inclusive), review text (TEXT, nullable), Rating_Link token (VARCHAR 64, nullable, with a UNIQUE constraint), and created_at (TIMESTAMPTZ defaulting to NOW()).
7. THE database schema SHALL include foreign key constraints with the following ON DELETE behaviors: schedules to packages (RESTRICT, preventing package deletion while referenced), expenses to schedules (CASCADE, removing expenses when a schedule is deleted), feedback to schedules (CASCADE, removing feedback when a schedule is deleted), and junction table entries to both packages (CASCADE) and menu items (CASCADE).
8. THE database schema SHALL include an index on the organization identifier column for all catering tables that contain an organization identifier column, to support efficient multi-tenant queries.
9. WHEN a Schedule record is deleted that has associated Operational_Expense or Customer_Feedback records, THE database schema SHALL automatically remove the associated records via the CASCADE foreign key constraint.
10. THE database schema SHALL include a unique constraint on the Rating_Link token column in the catering feedback table to ensure each generated link is unique across all feedback records.

### Requirement 14: Frontend Routing and Navigation Integration

**User Story:** As an admin, I want the catering management pages integrated into the existing application navigation, so that I can access scheduling, menus, and dashboard from the sidebar.

#### Acceptance Criteria

1. THE Scheduling_UI SHALL register Angular child routes under the authenticated layout path for the catering module pages: dashboard (path: "dashboard"), schedules (path: "catering-schedules"), and manage menus (path: "catering-menus"), each protected by the existing rbacGuard with a route data object specifying the corresponding menu key and "canRead" permission.
2. THE Scheduling_UI SHALL integrate catering navigation items (Dashboard, Catering Schedules, Catering Menus) into the existing sidebar layout, visible only to users whose RBAC-allowed menus include the corresponding catering menu keys within the STS Catering Services organization.
3. THE Scheduling_UI SHALL register a public route outside the authenticated layout (without authentication guards) for the scheduling form page, accessible at a dedicated path that does not require login.
4. THE Scheduling_UI SHALL register a public route outside the authenticated layout (without authentication guards) for the customer rating link page, accepting a Rating_Link token as a route parameter to identify the associated Schedule.
5. WHEN a user belonging to STS Catering Services logs in and navigates to the dashboard route, THE Dashboard_UI SHALL render the catering-specific dashboard displaying metrics cards and the customer feedback list as defined in Requirements 5 and 6.
6. IF an unauthenticated user attempts to access a catering admin route (catering-schedules or catering-menus), THEN THE Scheduling_UI SHALL redirect the user to the login page.
7. IF an authenticated user without the required RBAC permission navigates to a catering admin route, THEN THE Scheduling_UI SHALL deny access consistent with the existing rbacGuard behavior.

### Requirement 15: Organization Scoping

**User Story:** As a system administrator, I want all catering management operations scoped to the authenticated user's organization, so that data is isolated between tenants.

#### Acceptance Criteria

1. THE Scheduling_Service SHALL scope all Schedule queries to the authenticated user's organization identifier.
2. THE Menu_Service SHALL scope all Menu_Item and Package queries to the authenticated user's organization identifier.
3. THE Dashboard_Service SHALL scope all metric and feedback queries to the authenticated user's organization identifier.
4. THE Feedback_Service SHALL scope all Customer_Feedback queries to the authenticated user's organization identifier.
5. IF a request attempts to access a resource belonging to a different organization, THEN THE Scheduling_Service SHALL return a not-found error without revealing the resource exists.
