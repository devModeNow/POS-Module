# Implementation Plan: Database Backup Settings UI

## Overview

This plan implements a "Database Backup" tab in the existing Settings page, providing administrators with backup management capabilities: triggering new backups, viewing backup history with real-time status polling, downloading completed backups, and deleting old backups. The implementation extends the existing `SettingsComponent` with a new tab, creates a dedicated `BackupService`, and adds pure utility functions for formatting and state logic.

## Tasks

- [x] 1. Create BackupService and shared interfaces/utilities
  - [x] 1.1 Create backup interfaces and types
    - Create `frontend/src/app/shared/interfaces/backup.interfaces.ts`
    - Define `BackupMetadata`, `BackupType`, `BackupFormat`, `CreateBackupParams`, `CreateBackupResponse`, `DeleteBackupResponse` interfaces matching the backend contract
    - _Requirements: 3.2, 4.1, 5.2, 6.3_

  - [x] 1.2 Create BackupService
    - Create `frontend/src/app/shared/services/backup.service.ts`
    - Implement `@Injectable({ providedIn: 'root' })` service using shared `apiClient`
    - Implement `listBackups()`: GET `/backups` → `BackupMetadata[]`
    - Implement `createBackup(params)`: POST `/backups` with type/format body → `CreateBackupResponse`
    - Implement `downloadBackup(id)`: GET `/backups/:id/download` with `responseType: 'blob'` and return response (including headers for filename extraction)
    - Implement `deleteBackup(id)`: DELETE `/backups/:id` → `DeleteBackupResponse`
    - _Requirements: 2.3, 3.1, 5.2, 6.3_

  - [x] 1.3 Create backup utility functions
    - Create `frontend/src/app/shared/utils/backup-utils.ts`
    - Implement `formatBackupDate(isoString: string): string` — formats ISO 8601 to locale date/time
    - Implement `formatFileSize(bytes: number): string` — formats bytes to human-readable units (B, KB, MB, GB)
    - Implement `extractFilename(contentDisposition: string | null): string | null` — parses Content-Disposition header
    - Implement `shouldPoll(backups: BackupMetadata[]): boolean` — returns true if any backup is pending/in_progress
    - Implement `getStatusBadgeClasses(status): string` — returns Tailwind CSS classes for status badge
    - Implement `getStatusAriaLabel(status): string` — returns accessible label string
    - _Requirements: 3.3, 3.4, 4.2, 4.3, 8.4_

  - [ ]* 1.4 Write property tests for backup utility functions
    - **Property 2: Date formatting produces valid human-readable output**
    - **Property 3: File size formatting uses correct units and precision**
    - **Property 4: Polling is active if and only if non-terminal backups exist**
    - **Property 6: Filename extraction from Content-Disposition header**
    - **Property 8: Status badge aria-label correctness**
    - **Validates: Requirements 3.3, 3.4, 4.2, 4.3, 5.3, 8.4**

- [x] 2. Checkpoint - Ensure service and utilities compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Extend SettingsComponent with Database Backup tab
  - [x] 3.1 Add backup tab to SettingsComponent TypeScript
    - Extend `SettingsTab` type to include `'database-backup'`
    - Add `{ key: 'database-backup', label: 'Database Backup' }` to the `tabs` array (after 'rbac-configs')
    - Add backup state properties: `backups`, `isLoadingBackups`, `isCreatingBackup`, `downloadingIds`, `deletingIds`, `backupError`, `backupMessage`, `backupMessageTimeout`, `pollingInterval`
    - Add `backupForm` with defaults: `{ type: 'full', format: 'plain' }`
    - Add confirmation dialog state: `showDeleteConfirm`, `deleteTargetId`
    - Add `get canAccessBackup(): boolean` getter using `RbacService.isAdminOrSuperAdmin()`
    - Conditionally include the backup tab in the rendered tabs array based on `canAccessBackup`
    - Inject `BackupService` in the constructor
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 3.2 Implement backup tab lifecycle methods
    - Override `setActiveTab()` to call `loadBackups()` when switching to 'database-backup' and stop polling when switching away
    - Implement `loadBackups()`: call `BackupService.listBackups()`, set `backups`, handle errors, start polling if needed
    - Implement `startPolling()` / `stopPolling()`: 5-second interval calling `listBackups()`, clear on all-terminal or tab switch
    - Implement `ngOnDestroy()` to clear polling interval and message timeout
    - _Requirements: 3.1, 4.2, 4.3_

  - [x] 3.3 Implement backup CRUD action methods
    - Implement `createBackup()`: disable button, call `BackupService.createBackup(backupForm)`, prepend result to list, show success message, start polling, handle errors
    - Implement `downloadBackup(id)`: add id to `downloadingIds`, call `BackupService.downloadBackup(id)`, extract filename from Content-Disposition header, trigger browser download via Blob URL, remove from `downloadingIds`, handle errors
    - Implement `confirmDelete(id)` / `cancelDelete()` / `executeDelete()`: show confirmation dialog, call `BackupService.deleteBackup(id)`, remove entry from list, show success message, handle 404/409 errors
    - Implement `showFeedback(type, message)`: set `backupMessage` or `backupError`, clear the other, auto-dismiss success after 5s
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.4, 7.5_

  - [ ]* 3.4 Write property test for backup creation payload correctness
    - **Property 1: Backup creation payload correctness**
    - **Validates: Requirements 2.3**

- [x] 4. Implement Database Backup tab template
  - [x] 4.1 Create backup tab HTML section
    - Add `*ngIf="activeTab === 'database-backup'"` section in `settings.component.html`
    - Add feedback message area (success/error) with conditional rendering
    - Add Backup Trigger Form: type dropdown (Full/Schema Only/Data Only), format dropdown (Plain SQL/Custom Archive), "Create Backup" button with loading state
    - Add loading skeleton/spinner for list loading state
    - Add empty state message "No backups found" with icon
    - Add error state with "Retry" button
    - _Requirements: 2.1, 2.2, 2.5, 3.5, 3.6, 3.7, 7.1, 7.2, 7.5_

  - [x] 4.2 Create backup list table/cards
    - Implement responsive table (desktop) with columns: Status, Type, Format, Database Name, Created At, File Size, Actions
    - Implement card-based layout for mobile (< 768px) using Tailwind responsive classes
    - Render Status Badge with distinct styles: gray (pending), blue+pulse (in_progress), green (completed), red (failed)
    - Format Created At using `formatBackupDate()` utility
    - Format File Size using `formatFileSize()` utility
    - Show error message tooltip/expandable for failed backups
    - _Requirements: 3.2, 3.3, 3.4, 4.1, 4.4, 4.5, 8.1_

  - [x] 4.3 Implement action buttons and confirmation dialog
    - Add Download button: enabled only when `status === 'completed'`, disabled with tooltip otherwise, loading state per entry
    - Add Delete button: always visible, loading state per entry, disabled while deleting
    - Implement confirmation dialog with focus trap: "Are you sure you want to delete this backup? This action cannot be undone." with Confirm/Cancel buttons
    - Add `aria-label` attributes on all action buttons and status badges
    - Ensure keyboard navigation (Tab, Enter, Escape) works for form and dialog
    - Return focus to triggering button when dialog is dismissed
    - _Requirements: 5.1, 5.4, 5.6, 6.1, 6.2, 6.7, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 4.4 Write property test for download button enabled state
    - **Property 5: Download button enabled if and only if status is completed**
    - **Validates: Requirements 5.1, 5.6**

- [x] 5. Checkpoint - Ensure full feature compiles and renders
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Error handling and feedback integration
  - [x] 6.1 Implement comprehensive error handling
    - Handle network errors with message "Network error. Please check your connection and try again."
    - Allow 401 responses to pass through to apiClient token refresh interceptor
    - Handle 403 with message "You do not have permission to perform this action."
    - Handle 404 on download/delete with appropriate messages and list refresh
    - Handle 409 on delete (backup active) and download (not ready) with specific messages
    - Handle 500 with generic error message and retry option
    - Ensure polling errors are silently ignored (no UI disruption)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 6.2 Write property test for single feedback message invariant
    - **Property 7: Single feedback message invariant**
    - **Validates: Requirements 7.5**

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The implementation uses TypeScript throughout, matching the existing Angular project
- All backup UI lives within the existing `SettingsComponent` — no new routes or child components
- The `BackupService` follows the same pattern as `BusinessSettingsService` (injectable, async, uses apiClient)
- Dark mode support is handled via Tailwind's `dark:` prefix classes matching existing patterns

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3"] },
    { "id": 6, "tasks": ["4.4", "6.1"] },
    { "id": 7, "tasks": ["6.2"] }
  ]
}
```
