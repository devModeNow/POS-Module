# Requirements Document

## Introduction

This feature adds a Database Backup management UI to the existing Settings module of the STS Car Expert Angular frontend application. It provides administrators with a visual interface to trigger database backups, monitor backup progress, view backup history, download completed backup files, and delete old backups. The UI integrates with the existing backend BackupModule REST API endpoints (POST/GET/DELETE /backups) and follows the established tab-based layout pattern within the Settings page.

## Glossary

- **Backup_Settings_Tab**: The new tab added to the Settings page that contains all database backup management UI components.
- **Backup_List_View**: The component that displays a table of all backup records with their metadata and status.
- **Backup_Service_Frontend**: The Angular service responsible for communicating with the backend backup REST API endpoints via the shared apiClient.
- **Backup_Metadata**: The data object returned by the backend containing: id, status, type, format, databaseName, createdAt, completedAt, fileSizeBytes, fileName, errorMessage, and downloadUrl.
- **Administrator**: A user with roleName of "admin" or "superadmin" who is authorized to perform backup operations.
- **Backup_Trigger_Form**: The UI form that allows the Administrator to select backup type and format before initiating a backup.
- **Status_Badge**: A visual indicator (colored label) representing the current status of a backup (pending, in_progress, completed, failed).

## Requirements

### Requirement 1: Backup Settings Tab Integration

**User Story:** As an Administrator, I want to access database backup management from the Settings page, so that I can manage backups without navigating to a separate section.

#### Acceptance Criteria

1. THE Backup_Settings_Tab SHALL appear as a new tab labeled "Database Backup" in the Settings page tab bar, positioned after the existing "RBAC Configs" tab.
2. WHEN the Administrator clicks the "Database Backup" tab, THE Settings page SHALL display the Backup_List_View and Backup_Trigger_Form within the tab content area.
3. THE Backup_Settings_Tab SHALL only be visible to users whose roleName is "admin" or "superadmin".
4. IF the authenticated user does not have "admin" or "superadmin" role, THEN THE Backup_Settings_Tab SHALL not render in the tab bar.

### Requirement 2: Trigger New Backup

**User Story:** As an Administrator, I want to trigger a new database backup from the UI, so that I can create on-demand snapshots without using API tools directly.

#### Acceptance Criteria

1. THE Backup_Trigger_Form SHALL provide a dropdown to select backup type with options: "Full" (default), "Schema Only", and "Data Only".
2. THE Backup_Trigger_Form SHALL provide a dropdown to select backup format with options: "Plain SQL (.sql)" (default) and "Custom Archive (.dump)".
3. WHEN the Administrator clicks the "Create Backup" button, THE Backup_Service_Frontend SHALL send a POST request to the /backups endpoint with the selected type and format parameters.
4. WHEN the POST request returns a 202 response, THE Backup_List_View SHALL prepend the new backup entry to the top of the list with its initial status.
5. WHILE a backup creation request is in progress, THE "Create Backup" button SHALL be disabled and display a loading indicator with the text "Creating...".
6. IF the POST request returns an error response, THEN THE Backup_Settings_Tab SHALL display an error message with the server-provided error description above the backup list.

### Requirement 3: Display Backup History List

**User Story:** As an Administrator, I want to see a list of all previous backups with their details, so that I can track backup history and find specific backups.

#### Acceptance Criteria

1. WHEN the Backup_Settings_Tab is activated, THE Backup_Service_Frontend SHALL send a GET request to the /backups endpoint to retrieve the backup list.
2. THE Backup_List_View SHALL display each backup entry in a table with columns: Status, Type, Format, Database Name, Created At, File Size, and Actions.
3. THE Backup_List_View SHALL display the "Created At" timestamp formatted as a human-readable local date and time (e.g., "Jan 15, 2025, 2:30 PM").
4. THE Backup_List_View SHALL display the file size formatted in human-readable units (bytes, KB, MB, GB) with one decimal place for sizes above 1 KB.
5. WHILE the backup list is loading, THE Backup_List_View SHALL display a loading skeleton or spinner indicator.
6. IF the GET request returns an empty array, THEN THE Backup_List_View SHALL display a message "No backups found" with an icon indicating an empty state.
7. IF the GET request fails, THEN THE Backup_List_View SHALL display an error message with a "Retry" button to re-attempt the request.

### Requirement 4: Backup Status Display and Polling

**User Story:** As an Administrator, I want to see real-time status updates for in-progress backups, so that I know when a backup is ready for download.

#### Acceptance Criteria

1. THE Status_Badge SHALL display distinct visual styles for each status: "pending" (gray), "in_progress" (blue with pulse animation), "completed" (green), and "failed" (red).
2. WHILE any backup in the list has status "pending" or "in_progress", THE Backup_Service_Frontend SHALL poll the GET /backups endpoint every 5 seconds to refresh the list.
3. WHEN all backups in the list have a terminal status ("completed" or "failed"), THE Backup_Service_Frontend SHALL stop polling.
4. WHEN a backup transitions from "in_progress" to "completed", THE Backup_List_View SHALL update the entry to show the file size and enable the download action.
5. WHEN a backup transitions to "failed" status, THE Backup_List_View SHALL display the error message from the Backup_Metadata in a tooltip or expandable row detail.

### Requirement 5: Download Completed Backup

**User Story:** As an Administrator, I want to download completed backup files, so that I can store them locally or import them into another database tool.

#### Acceptance Criteria

1. WHEN a backup has status "completed", THE Backup_List_View SHALL display an enabled download button in the Actions column for that entry.
2. WHEN the Administrator clicks the download button, THE Backup_Service_Frontend SHALL initiate a file download by requesting GET /backups/:id/download with appropriate response handling for binary file streaming.
3. THE download action SHALL save the file with the original filename provided in the Content-Disposition header from the backend response.
4. WHILE a download is in progress, THE download button SHALL display a loading state and be disabled to prevent duplicate download requests.
5. IF the download request returns a 404 or 409 error, THEN THE Backup_Settings_Tab SHALL display an error message indicating the file is unavailable or the backup is not in a downloadable state.
6. WHEN a backup has status "pending", "in_progress", or "failed", THE download button SHALL be disabled with a tooltip explaining the backup is not ready for download.

### Requirement 6: Delete Backup

**User Story:** As an Administrator, I want to delete old backups, so that I can manage server storage and remove unnecessary backup files.

#### Acceptance Criteria

1. THE Backup_List_View SHALL display a delete button in the Actions column for each backup entry.
2. WHEN the Administrator clicks the delete button, THE Backup_Settings_Tab SHALL display a confirmation dialog asking "Are you sure you want to delete this backup? This action cannot be undone."
3. WHEN the Administrator confirms the deletion, THE Backup_Service_Frontend SHALL send a DELETE request to /backups/:id.
4. WHEN the DELETE request returns a success response, THE Backup_List_View SHALL remove the deleted entry from the list and display a success message.
5. IF the DELETE request returns a 409 response (backup is active), THEN THE Backup_Settings_Tab SHALL display an error message indicating the backup cannot be deleted while in progress.
6. IF the DELETE request returns a 404 response, THEN THE Backup_Settings_Tab SHALL display an error message indicating the backup was not found and refresh the list.
7. WHILE a delete request is in progress, THE delete button for that entry SHALL be disabled and display a loading indicator.

### Requirement 7: Error Handling and User Feedback

**User Story:** As an Administrator, I want clear feedback on all backup operations, so that I understand what happened and what to do next.

#### Acceptance Criteria

1. WHEN any backup operation succeeds, THE Backup_Settings_Tab SHALL display a success notification message that auto-dismisses after 5 seconds.
2. WHEN any backup operation fails due to a network error, THE Backup_Settings_Tab SHALL display an error message "Network error. Please check your connection and try again."
3. IF the backend returns a 401 response, THEN THE Backup_Service_Frontend SHALL allow the existing apiClient token refresh interceptor to handle re-authentication transparently.
4. IF the backend returns a 403 response, THEN THE Backup_Settings_Tab SHALL display an error message "You do not have permission to perform this action."
5. THE Backup_Settings_Tab SHALL display only one feedback message at a time, replacing any previous message when a new operation completes.

### Requirement 8: Responsive Layout and Accessibility

**User Story:** As an Administrator, I want the backup management UI to be usable on different screen sizes and accessible via keyboard, so that I can manage backups from any device.

#### Acceptance Criteria

1. THE Backup_List_View SHALL use a responsive table layout that displays all columns on desktop (width >= 768px) and collapses to a card-based layout on mobile viewports.
2. THE Backup_Trigger_Form dropdowns and buttons SHALL be fully operable using keyboard navigation (Tab, Enter, Escape keys).
3. THE "Create Backup" button and all action buttons SHALL have accessible labels (aria-label) describing their function for screen readers.
4. THE Status_Badge SHALL include an aria-label attribute with the full status text (e.g., aria-label="Status: In Progress") for screen reader users.
5. THE confirmation dialog for delete operations SHALL trap focus within the dialog and return focus to the triggering button when dismissed.
