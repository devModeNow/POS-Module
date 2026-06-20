# Requirements Document

## Introduction

This feature provides a database backup and export capability for the STS Car Expert system. It enables administrators to create portable PostgreSQL backup files (in standard SQL dump format) that can be restored or imported into any PostgreSQL database administration tool such as pgAdmin, DBeaver, DataGrip, or the native `psql` CLI. The backup covers both schema (DDL) and data (DML), ensuring a complete snapshot of the database state for migration, disaster recovery, or environment replication purposes.

## Glossary

- **Backup_Service**: The NestJS service responsible for orchestrating database backup operations, including connecting to PostgreSQL, generating dump files, and managing backup metadata.
- **Backup_Controller**: The NestJS controller that exposes REST API endpoints for triggering and downloading database backups.
- **Backup_File**: A standard PostgreSQL-compatible SQL dump file containing DDL (schema) and DML (data) statements that can be restored using `pg_restore`, `psql`, or any PostgreSQL admin tool.
- **Administrator**: A user with elevated privileges authorized to perform backup and export operations.
- **Backup_Metadata**: Information about a backup including timestamp, file size, database name, and backup type (full, schema-only, data-only).
- **pg_dump**: The standard PostgreSQL utility used to generate logical backups in plain SQL or custom archive format.

## Requirements

### Requirement 1: Trigger Database Backup

**User Story:** As an Administrator, I want to trigger a database backup through an API endpoint, so that I can create a portable snapshot of the current database state on demand.

#### Acceptance Criteria

1. WHEN the Administrator sends a POST request to the backup endpoint, THE Backup_Service SHALL initiate a full database backup using pg_dump.
2. WHEN the backup is initiated, THE Backup_Service SHALL support three backup types: full (schema + data), schema-only, and data-only, and SHALL default to full if no backup type is specified in the request.
3. WHEN the backup process starts, THE Backup_Controller SHALL return a response containing the backup identifier and status within 5 seconds, where status is one of: "in_progress", "completed", or "failed".
4. IF the Administrator specifies a backup type that is not one of "full", "schema-only", or "data-only", THEN THE Backup_Service SHALL return an error response indicating the invalid backup type and listing the accepted values.
5. IF the database connection fails during backup initiation, THEN THE Backup_Service SHALL return an error response with a descriptive message indicating the connection failure without initiating the pg_dump process.
6. IF pg_dump is not available on the server, THEN THE Backup_Service SHALL return an error response indicating the missing dependency.
7. IF the backup process does not complete within 300 seconds, THEN THE Backup_Service SHALL terminate the pg_dump process and set the backup status to "failed".

### Requirement 2: Generate PostgreSQL-Compatible Backup File

**User Story:** As an Administrator, I want the backup file to be in standard PostgreSQL format, so that I can restore it using any PostgreSQL administration tool.

#### Acceptance Criteria

1. THE Backup_Service SHALL generate backup files in plain SQL format (.sql) when no format parameter is specified in the backup request.
2. WHERE the custom archive format is selected, THE Backup_Service SHALL generate backup files in PostgreSQL custom format (.dump) compatible with pg_restore.
3. WHEN a full backup is generated, THE Backup_File SHALL contain all DDL statements (CREATE TABLE, CREATE INDEX, CREATE FUNCTION, CREATE VIEW, CREATE TRIGGER, CREATE SEQUENCE, CREATE TYPE) and INSERT statements necessary to recreate all user-defined database objects.
4. WHEN a backup is generated in plain SQL format, THE Backup_File SHALL wrap all statements within a single transaction block (BEGIN at the start, COMMIT at the end) so that restoration either fully succeeds or fully rolls back.
5. THE Backup_Service SHALL exclude Supabase-internal schemas (auth, storage, realtime, extensions, supabase_functions, supabase_migrations, pgsodium, vault, graphql, graphql_public) from the backup output.
6. THE Backup_Service SHALL generate backup files using UTF-8 encoding.
7. IF pg_dump fails or is terminated during backup file generation, THEN THE Backup_Service SHALL delete any partially written backup file and set the backup status to failed.
8. WHEN a schema-only backup is generated, THE Backup_File SHALL contain only DDL statements without any INSERT statements. WHEN a data-only backup is generated, THE Backup_File SHALL contain only INSERT statements without any DDL statements.

### Requirement 3: Download Backup File

**User Story:** As an Administrator, I want to download the generated backup file, so that I can store it locally or import it into another PostgreSQL tool.

#### Acceptance Criteria

1. WHEN a backup is completed, THE Backup_Controller SHALL provide a GET endpoint to download the Backup_File by its identifier.
2. WHEN the download is requested, THE Backup_Controller SHALL stream the file with the appropriate Content-Type header (application/sql for .sql files, application/octet-stream for .dump files).
3. WHEN the download is requested, THE Backup_Controller SHALL set the Content-Disposition header to "attachment" with a filename following the pattern `{database_name}_{backup_type}_{ISO_timestamp}.{extension}` as defined in the Backup_File naming convention.
4. IF the requested backup identifier does not correspond to an existing backup record, THEN THE Backup_Controller SHALL return a 404 response with an error message indicating the backup identifier that was not found.
5. IF the requested backup exists but its status is not "completed", THEN THE Backup_Controller SHALL return a 409 response with an error message indicating the current backup status.
6. IF the backup record exists with "completed" status but the file is missing from the storage path, THEN THE Backup_Controller SHALL return a 404 response with an error message indicating the file is unavailable on disk.

### Requirement 4: List and Manage Backups

**User Story:** As an Administrator, I want to view a list of previously created backups and delete old ones, so that I can manage storage and find specific backup versions.

#### Acceptance Criteria

1. WHEN the Administrator sends a GET request to the backups list endpoint, THE Backup_Controller SHALL return a list of all backups sorted by creation timestamp in descending order (most recent first), each entry containing the Backup_Metadata and current backup status.
2. THE Backup_Metadata SHALL include: backup identifier, creation timestamp, file size in bytes, backup type, and database name.
3. WHEN the Administrator sends a DELETE request for a specific backup with status "completed" or "failed", THE Backup_Service SHALL remove the Backup_File from storage, remove the associated Backup_Metadata, and return a response containing the deleted backup identifier and a confirmation status.
4. IF the backup to delete does not exist, THEN THE Backup_Controller SHALL return a 404 response with an error message indicating the backup identifier was not found.
5. IF the Administrator sends a DELETE request for a backup with status "pending" or "in_progress", THEN THE Backup_Controller SHALL return a 409 response with an error message indicating the backup cannot be deleted while in progress.

### Requirement 5: Backup File Storage

**User Story:** As an Administrator, I want backup files stored in a configurable location on the server, so that I can control where backups are persisted.

#### Acceptance Criteria

1. THE Backup_Service SHALL store generated backup files in a configurable directory path defined by the BACKUP_STORAGE_PATH environment variable.
2. IF the BACKUP_STORAGE_PATH environment variable is not set, THEN THE Backup_Service SHALL default to a `backups` directory within the project root.
3. IF the configured storage directory does not exist, THEN THE Backup_Service SHALL recursively create all necessary parent directories in the path before writing the backup file.
4. THE Backup_Service SHALL name backup files using the pattern: `{database_name}_{backup_type}_{timestamp}.{extension}` where timestamp uses the format `YYYYMMDDTHHmmss` (ISO 8601 basic format without separators), backup_type is one of `full`, `schema`, or `data`, and extension is `sql` for plain SQL format or `dump` for custom archive format.
5. IF the Backup_Service fails to write the backup file due to insufficient permissions or insufficient disk space, THEN THE Backup_Service SHALL set the backup status to failed, store an error message indicating the write failure reason in the Backup_Metadata, and remove any partially written file.

### Requirement 6: Authorization and Security

**User Story:** As a system owner, I want backup operations restricted to authorized administrators, so that sensitive database contents are protected from unauthorized access.

#### Acceptance Criteria

1. THE Backup_Controller SHALL require a valid JWT token (Bearer scheme in the Authorization header, signature-verified and not expired) for all backup endpoints.
2. THE Backup_Controller SHALL verify that the authenticated user has a roleName of "admin" or "superadmin" in the JWT payload before processing backup requests.
3. IF a request is received without a token or with a malformed token, THEN THE Backup_Controller SHALL return a 401 Unauthorized response with an error message indicating the authentication failure reason.
4. IF a request is received with an expired JWT token, THEN THE Backup_Controller SHALL return a 401 Unauthorized response with an error message indicating token expiration.
5. IF an authenticated user whose roleName is neither "admin" nor "superadmin" attempts a backup operation, THEN THE Backup_Controller SHALL return a 403 Forbidden response with an error message indicating insufficient permissions.

### Requirement 7: Backup Progress and Status

**User Story:** As an Administrator, I want to check the status of an ongoing backup, so that I know when the backup is ready for download.

#### Acceptance Criteria

1. WHEN a backup is first created, THE Backup_Service SHALL assign the initial status of "pending" before transitioning to "in_progress" when pg_dump begins execution.
2. WHILE a backup is in progress, THE Backup_Service SHALL track the backup status as one of: "pending", "in_progress", "completed", or "failed".
3. WHEN the Administrator sends a GET request with a backup identifier, THE Backup_Controller SHALL return the current status and Backup_Metadata for that backup within 2 seconds.
4. WHEN the backup status is "completed", THE Backup_Controller SHALL include the file size in bytes and the download URL in the response.
5. WHEN the backup status is "failed", THE Backup_Controller SHALL include the error message in the response.
6. IF a backup fails during execution, THEN THE Backup_Service SHALL set the status to "failed" and store the error message in the Backup_Metadata.
7. IF the Administrator sends a GET request with a backup identifier that does not exist, THEN THE Backup_Controller SHALL return a 404 response with an error message indicating the backup identifier was not found.
