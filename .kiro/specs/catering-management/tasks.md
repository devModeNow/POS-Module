# Implementation Plan: Catering Management Module

## Overview

This plan implements the Catering Management Module for STS Catering Services within the CBIS platform. The implementation follows the existing architecture: NestJS backend with a single `CateringModule` containing dedicated controllers and services, PostgreSQL/Supabase via the shared `DatabaseService`, and Angular standalone components with Tailwind CSS on the frontend. Tasks are ordered to build foundational layers first (database, DTOs, services) then wire up controllers and frontend components.

## Tasks

- [x] 1. Database schema and project structure
  - [x] 1.1 Create the catering database migration SQL file
    - Create `backend/sql/supabase/20260601_catering_module.sql` with all six tables: `catering_packages`, `catering_menu_items`, `catering_package_items`, `catering_schedules`, `catering_expenses`, `catering_feedback`
    - Include all CHECK constraints, foreign keys (RESTRICT for schedules→packages, CASCADE for expenses→schedules, feedback→schedules, package_items→packages/menu_items), indexes on org_id columns, and the unique constraint on `link_token`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10_

  - [x] 1.2 Create the NestJS catering module structure and DTOs
    - Create directory structure: `backend/src/catering/` with `catering.module.ts`, `controllers/`, `services/`, `dto/`, and `__tests__/`
    - Create `catering.module.ts` registering all controllers and services
    - Create DTOs with class-validator decorators: `create-schedule.dto.ts`, `create-feedback.dto.ts`, `create-menu-item.dto.ts`, `create-package.dto.ts`, `complete-schedule.dto.ts`
    - Register `CateringModule` in `app.module.ts`
    - _Requirements: 1.2, 3.2, 9.2, 9.4, 10.2, 10.3, 11.1, 11.2, 11.3_

- [x] 2. Menu and Package management (backend)
  - [x] 2.1 Implement MenuService with CRUD operations
    - Create `backend/src/catering/services/menu.service.ts`
    - Implement `createMenuItem`, `listMenuItems` (grouped by category), `updateMenuItem`, `deleteMenuItem` (with package-reference check)
    - Implement `createPackage`, `listPackages`, `listPackagesPublic`, `updatePackage`, `deletePackage` (with active-schedule check)
    - All queries scoped by `orgId` using parameterized SQL via `DatabaseService`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.15, 11.16, 11.17, 12.1, 12.2, 12.3_

  - [x] 2.2 Implement MenuController with all endpoints
    - Create `backend/src/catering/controllers/menu.controller.ts`
    - Implement authenticated endpoints: `GET /items`, `POST /items`, `PATCH /items/:id`, `DELETE /items/:id`, `GET /packages`, `POST /packages`, `PATCH /packages/:id`, `DELETE /packages/:id`
    - Implement public endpoint: `GET /packages/public/:orgId`
    - Apply `JwtAuthGuard` on admin endpoints, extract `orgId` from JWT
    - Apply `ValidationPipe` for DTO validation
    - _Requirements: 10.9, 11.11, 12.1, 15.2_

  - [ ]* 2.3 Write property tests for menu item category validation
    - **Property 11: Menu item category validation**
    - **Validates: Requirements 10.2, 10.3**

  - [ ]* 2.4 Write property tests for menu item deletion constraint
    - **Property 13: Menu item deletion constraint**
    - **Validates: Requirements 10.6, 10.8**

  - [ ]* 2.5 Write property tests for package creation round-trip
    - **Property 14: Package creation round-trip**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**

  - [ ]* 2.6 Write property tests for package deletion constraint
    - **Property 15: Package deletion constraint**
    - **Validates: Requirements 11.7, 11.10**

  - [ ]* 2.7 Write property tests for menu items grouped by category
    - **Property 12: Menu items grouped by category**
    - **Validates: Requirements 10.4**

- [x] 3. Scheduling management (backend)
  - [x] 3.1 Implement SchedulingService
    - Create `backend/src/catering/services/scheduling.service.ts`
    - Implement `createPublicSchedule` — validate DTO, verify package exists and pax >= package min_pax, create schedule with status 'pending' associated with STS Catering org
    - Implement `findAll` — query schedules by org and status filter, join package name, order by event_date (ASC for pending/in_progress, DESC for completed)
    - Implement `confirm` — validate schedule is pending, update to 'in_progress'
    - Implement `complete` — validate schedule is in_progress, store expenses, calculate total_expense, update to 'completed'
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [x] 3.2 Implement SchedulingController
    - Create `backend/src/catering/controllers/scheduling.controller.ts`
    - Implement public endpoint: `POST /api/catering/schedules/public` (no auth)
    - Implement authenticated endpoints: `GET /`, `PATCH /:id/confirm`, `PATCH /:id/complete`
    - Apply `JwtAuthGuard` on admin endpoints, extract `orgId` from JWT
    - _Requirements: 1.1, 7.5, 8.4, 9.8, 15.1_

  - [ ]* 3.3 Write property tests for valid scheduling request
    - **Property 1: Valid scheduling request creates a Pending schedule**
    - **Validates: Requirements 1.2, 1.3, 1.10**

  - [ ]* 3.4 Write property tests for invalid scheduling input rejection
    - **Property 2: Invalid scheduling input is rejected with descriptive error**
    - **Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.9, 1.11, 1.12, 1.13**

  - [ ]* 3.5 Write property tests for schedule state machine transitions
    - **Property 9: Schedule state machine transitions**
    - **Validates: Requirements 8.1, 8.2, 9.1, 9.5**

  - [ ]* 3.6 Write property tests for schedule status filtering
    - **Property 8: Schedule status filtering returns correct subset in correct order**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ]* 3.7 Write property tests for expense storage and total calculation
    - **Property 10: Expense storage round-trip and total calculation**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.7**

- [x] 4. Checkpoint - Backend core services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Feedback system (backend)
  - [x] 5.1 Implement FeedbackService
    - Create `backend/src/catering/services/feedback.service.ts`
    - Implement `submitSchedulingFeedback` — validate schedule exists, check no prior scheduling feedback, store with type 'scheduling_experience'
    - Implement `generateRatingLink` — validate schedule is completed, generate UUID v4 token, store with 30-day expiration, return URL
    - Implement `validateRatingLink` — check token exists, not expired, not already used
    - Implement `submitRating` — validate token, store rating with type 'satisfaction_rating', mark token as used
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11_

  - [x] 5.2 Implement FeedbackController
    - Create `backend/src/catering/controllers/feedback.controller.ts`
    - Implement public endpoints: `POST /scheduling/:scheduleId`, `GET /rating/:token`, `POST /rating/:token`
    - Implement authenticated endpoint: `POST /generate-link/:scheduleId`
    - Apply `JwtAuthGuard` only on generate-link endpoint
    - _Requirements: 3.4, 4.7, 15.4_

  - [ ]* 5.3 Write property tests for feedback rating validation
    - **Property 3: Feedback rating validation**
    - **Validates: Requirements 3.2, 3.3, 4.11**

  - [ ]* 5.4 Write property tests for scheduling feedback idempotency
    - **Property 4: Scheduling feedback is idempotent (single submission per schedule)**
    - **Validates: Requirements 3.6**

  - [ ]* 5.5 Write property tests for rating link generation
    - **Property 5: Rating link generation requires Completed status**
    - **Validates: Requirements 4.1, 4.2, 4.10**

  - [ ]* 5.6 Write property tests for rating link single-use and expiration
    - **Property 6: Rating link single-use and expiration enforcement**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6**

- [x] 6. Dashboard (backend)
  - [x] 6.1 Implement DashboardService
    - Create `backend/src/catering/services/dashboard.service.ts`
    - Implement `getMetrics` — query pending count, in_progress count, total sales (sum of pax × price_per_head for completed), total expenses (sum of expense amounts for completed), all scoped by orgId
    - Implement `getFeedbackList` — paginated query (50 per page), ordered by created_at DESC, include customer name from joined schedule, calculate average rating, return empty list with 0 average when no records
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.8_

  - [x] 6.2 Implement DashboardController
    - Create `backend/src/catering/controllers/dashboard.controller.ts`
    - Implement authenticated endpoints: `GET /metrics`, `GET /feedback`
    - Apply `JwtAuthGuard`, extract `orgId` from JWT
    - _Requirements: 5.5, 6.4, 15.3_

  - [ ]* 6.3 Write property tests for dashboard metrics consistency
    - **Property 7: Dashboard metrics are consistent with underlying data**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [ ]* 6.4 Write property tests for feedback list pagination and ordering
    - **Property 17: Feedback list pagination and ordering**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5**

  - [ ]* 6.5 Write property tests for organization data isolation
    - **Property 16: Organization data isolation**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**

- [x] 7. Checkpoint - Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Frontend - Public pages
  - [x] 8.1 Implement the public scheduling form component
    - Create `frontend/src/app/pages/catering/public/scheduling-form/scheduling-form.component.ts`
    - Build reactive form with fields: customer name, contact number, venue, event date (date picker restricted to future dates), pax, package selector
    - Fetch packages from public endpoint on init, display name/price/min_pax in dropdown
    - Implement client-side validation with inline error messages
    - On success: display "Thank you for Scheduling with us" confirmation and render the scheduling feedback form
    - Handle network errors by preserving form data and showing error message
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 8.2 Implement the public rating page component
    - Create `frontend/src/app/pages/catering/public/rating-page/rating-page.component.ts`
    - Accept token from route parameter, validate token via `GET /api/catering/feedback/rating/:token`
    - Render star rating input (1-5) and optional review textarea (max 1000 chars)
    - On submit: POST to `/api/catering/feedback/rating/:token`, show thank-you message on success
    - Handle expired/used/invalid tokens with appropriate error messages
    - _Requirements: 4.3, 4.5, 4.6, 4.8, 4.9_

- [x] 9. Frontend - Admin dashboard
  - [x] 9.1 Implement the catering dashboard component
    - Create `frontend/src/app/pages/catering/dashboard/catering-dashboard.component.ts`
    - Fetch metrics on init, display four summary cards: Unconfirmed Schedules (count), Confirmed Schedules (count), Total Sales (currency), Total Expenses (currency)
    - Display 0 / 0.00 for empty states
    - Implement feedback list section: show customer name, star rating, review, submission date, event date
    - Display overall average rating above feedback list
    - Show "No feedback received yet" when list is empty
    - Implement retry button on fetch failure
    - _Requirements: 5.6, 5.7, 5.8, 6.6, 6.7, 6.9_

- [x] 10. Frontend - Schedule management
  - [x] 10.1 Implement the catering schedules component
    - Create `frontend/src/app/pages/catering/schedules/catering-schedules.component.ts`
    - Implement three tabs/sections: Pending, In-Progress, Completed
    - Render each schedule as a card showing customer name, contact number, venue, event date, pax, package name
    - Add "Confirm" button on Pending items, "Complete" button on In-Progress items
    - On Confirm: call PATCH confirm endpoint, move schedule to In-Progress tab on success
    - On Complete: open expense modal/form with all 16 expense category fields defaulting to 0.00
    - On expense submit: call PATCH complete endpoint, move schedule to Completed tab on success
    - Handle errors by displaying server messages and preserving form state
    - _Requirements: 7.6, 7.7, 7.8, 7.9, 8.5, 8.6, 9.10, 9.11, 9.12_

- [x] 11. Frontend - Menu and package management
  - [x] 11.1 Implement the catering menus component
    - Create `frontend/src/app/pages/catering/menus/catering-menus.component.ts`
    - Display menu items grouped by category
    - Implement "Add Menu Item" form/modal with name field and category dropdown (12 categories)
    - Implement edit and delete actions for each menu item
    - Display package list with name, price per head, min pax, and menu item summary
    - Implement "Create Package" form/modal with name, price per head, min pax, and multi-select interface for menu items per category with configurable selection limits
    - Implement edit and delete actions for each package
    - Handle deletion constraint errors with descriptive messages
    - _Requirements: 10.10, 10.11, 10.12, 11.12, 11.13, 11.14_

- [x] 12. Frontend routing and navigation integration
  - [x] 12.1 Configure Angular routes and sidebar navigation
    - Register authenticated child routes: `dashboard`, `catering-schedules`, `catering-menus` under the authenticated layout, protected by `rbacGuard` with appropriate menu keys
    - Register public routes outside authenticated layout: scheduling form path and rating page path with `:token` parameter
    - Add catering navigation items (Dashboard, Catering Schedules, Catering Menus) to the sidebar, visible only to users with matching RBAC permissions in STS Catering Services org
    - Ensure unauthenticated access to admin routes redirects to login
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [x] 13. Final checkpoint - Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The backend follows the existing CBIS pattern: `DatabaseService` (pg Pool), `JwtAuthGuard`, organization-scoped queries
- The frontend uses Angular standalone components with Tailwind CSS, consistent with existing pages like job-orders
- All property-based tests should be placed in `backend/src/catering/__tests__/` with `.property.spec.ts` suffix

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7"] },
    { "id": 3, "tasks": ["5.1", "6.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 5, "tasks": ["8.1", "8.2", "9.1", "10.1", "11.1"] },
    { "id": 6, "tasks": ["12.1"] }
  ]
}
```
