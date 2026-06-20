# Implementation Plan: Database Backup & Migration

## Overview

This plan implements a `BackupModule` for the STS Car Expert NestJS backend. The module provides REST endpoints for triggering PostgreSQL backups via `pg_dump`, streaming downloads, and managing backup lifecycle. Implementation follows the existing project patterns (module/controller/service structure, JWT guards, class-validator DTOs) and uses TypeScript throughout.

## Tasks

- [x] 1. Set up module structure, interfaces, and utilities
  - [x] 1.1 Create backup module directory structure and core interfaces
    - Create `src/backup/` directory with subdirectories: `dto/`, `interfaces/`, `guards/`, `utils/`, `__tests__/`
    - Define `BackupMetadata` interface in `src/backup/interfaces/backup-metadata.interface.ts`
    - Define status type: `'pending' | 'in_progress' | 'completed' | 'failed'`
    - Define backup type: `'full' | 'schema-only' | 'data-only'`
    - Define format type: `'plain' | 'custom'`
    - _Requirements: 4.2, 7.2_

  - [x] 1.2 Create CreateBackupDto with class-validator decorators
    - Create `src/backup/dto/create-backup.dto.ts`
    - Add `type` field with `@IsOptional()` and `@IsIn(['full', 'schema-only', 'data-only'])`, default `'full'`
    - Add `format` field with `@IsOptional()` and `@IsIn(['plain', 'custom'])`, default `'plain'`
    - _Requirements: 1.2, 1.4_

  - [x] 1.3 Implement `buildPgDumpArgs` utility function
    - Create `src/backup/utils/build-pg-dump-args.ts`
    - Accept database connection config and backup options (type, format)
    - Include `--schema-only` for schema-only, `--data-only` for data-only, neither for full
    - Include `-Fp` for plain format, `-Fc` for custom format
    - Include `--encoding=UTF8`
    - Include all 10 `--exclude-schema` flags for Supabase-internal schemas (auth, storage, realtime, extensions, supabase_functions, supabase_migrations, pgsodium, vault, graphql, graphql_public)
    - Include host, port, username, dbname flags
    - _Requirements: 1.2, 2.1, 2.5, 2.6_

  - [x] 1.4 Implement `generateFilename` utility function
    - Create `src/backup/utils/generate-filename.ts`
    - Pattern: `{databaseName}_{backupType}_{YYYYMMDDTHHmmss}.{extension}`
    - Map backup type to filename segment: `full` → `full`, `schema-only` → `schema`, `data-only` → `data`
    - Map format to extension: `plain` → `sql`, `custom` → `dump`
    - _Requirements: 5.4, 3.3_

  - [x]* 1.5 Write property tests for `buildPgDumpArgs` (Property 1)
    - **Property 1: pg_dump argument correctness**
    - Use fast-check to generate all valid combinations of backup type and format
    - Assert correct type flag, format flag, UTF-8 encoding, and all 10 exclude-schema flags are present
    - **Validates: Requirements 1.2, 2.5, 2.6**

  - [x]* 1.6 Write property tests for `generateFilename` (Property 4)
    - **Property 4: Filename generation pattern**
    - Use fast-check to generate valid database names, backup types, and timestamps
    - Assert output matches regex `^.+_(full|schema|data)_\d{8}T\d{6}\.(sql|dump)$`
    - **Validates: Requirements 3.3, 5.4**

- [x] 2. Implement RolesGuard and authorization
  - [x] 2.1 Create RolesGuard and Roles decorator
    - Create `src/backup/guards/roles.guard.ts` implementing `CanActivate`
    - Use `Reflector` to read `roles` metadata from handler or class
    - Check `request.user.roleName` against required roles
    - Create `@Roles(...roles)` decorator using `SetMetadata`
    - _Requirements: 6.2, 6.5_

  - [x]* 2.2 Write property test for RolesGuard (Property 9)
    - **Property 9: Role-based access control**
    - Use fast-check to generate arbitrary role strings that are not "admin" or "superadmin"
    - Assert guard returns false (403) for all non-admin roles
    - Assert guard returns true for "admin" and "superadmin"
    - **Validates: Requirements 6.2, 6.5**

- [x] 3. Implement BackupService core logic
  - [x] 3.1 Create BackupService with in-memory metadata store
    - Create `src/backup/backup.service.ts`
    - Inject `ConfigService` for database config and `BACKUP_STORAGE_PATH`
    - Initialize `Map<string, BackupMetadata>` for metadata storage
    - Implement `getBackup(id)` returning metadata or undefined
    - Implement `listBackups()` returning all backups sorted by `createdAt` descending
    - Implement `getBackupFilePath(id)` returning absolute path if completed
    - Default `BACKUP_STORAGE_PATH` to `./backups` if env var not set
    - Ensure storage directory exists (recursive mkdir) on module init
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 5.3, 7.1, 7.2, 7.3_

  - [x] 3.2 Implement `createBackup` method with pg_dump execution
    - Generate UUID v4 for backup ID
    - Set initial status to `"pending"`
    - Validate pg_dump availability via `execFile('pg_dump', ['--version'])`
    - Transition to `"in_progress"` when pg_dump starts
    - Spawn `pg_dump` via `child_process.execFile` with args from `buildPgDumpArgs`
    - Set `PGPASSWORD` environment variable for the child process
    - Set 300-second timeout; on timeout kill process (SIGTERM), delete partial file, set status to `"failed"`
    - On success (exit code 0): record file size, set status to `"completed"`, set `completedAt`
    - On failure (non-zero exit): capture stderr, delete partial file, set status to `"failed"` with error message
    - Return metadata immediately after setting status to `"pending"` (async execution)
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 5.5, 7.1, 7.6_

  - [x] 3.3 Implement `deleteBackup` method
    - Check backup exists (throw NotFoundException if not)
    - Check status is not "pending" or "in_progress" (throw ConflictException if active)
    - Delete file from disk (ignore ENOENT)
    - Remove metadata from Map
    - Return deleted backup ID
    - _Requirements: 4.3, 4.4, 4.5_

  - [x]* 3.4 Write property tests for metadata and status (Properties 7, 10, 11)
    - **Property 7: Metadata completeness** — Assert all required fields present for any generated metadata
    - **Property 10: Status validity invariant** — Assert status is always one of the 4 valid values
    - **Property 11: Status-dependent response fields** — Assert completed backups have fileSizeBytes and downloadUrl; failed backups have errorMessage
    - **Validates: Requirements 4.2, 7.2, 7.4, 7.5**

  - [x]* 3.5 Write property tests for list sorting and deletion blocking (Properties 6, 8)
    - **Property 6: List sorting invariant** — Generate random backups with varying timestamps, assert list returns descending order
    - **Property 8: Active backup blocks deletion** — Generate backups with "pending" or "in_progress" status, assert delete is rejected
    - **Validates: Requirements 4.1, 4.5**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement BackupController with all endpoints
  - [x] 5.1 Create BackupController with POST /backups endpoint
    - Create `src/backup/backup.controller.ts`
    - Apply `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('admin', 'superadmin')` at class level
    - Implement `POST /backups` accepting `CreateBackupDto` (with `@UsePipes(ValidationPipe)`)
    - Return 202 Accepted with `{ id, status }` on success
    - Handle validation errors (400), connection failures (500), pg_dump not found (500)
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 6.1, 6.2_

  - [x] 5.2 Implement GET /backups and GET /backups/:id endpoints
    - `GET /backups` returns list of all backups with metadata
    - `GET /backups/:id` returns single backup metadata
    - Include `downloadUrl` and `fileSizeBytes` when status is "completed"
    - Include `errorMessage` when status is "failed"
    - Return 404 if backup ID not found
    - _Requirements: 4.1, 4.2, 7.3, 7.4, 7.5, 7.7_

  - [x] 5.3 Implement GET /backups/:id/download endpoint
    - Validate backup exists (404 if not)
    - Validate status is "completed" (409 if not)
    - Validate file exists on disk (404 if missing)
    - Stream file using `StreamableFile` with `fs.createReadStream`
    - Set `Content-Type`: `application/sql` for plain, `application/octet-stream` for custom
    - Set `Content-Disposition`: `attachment; filename="{fileName}"`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 5.4 Implement DELETE /backups/:id endpoint
    - Delegate to `BackupService.deleteBackup(id)`
    - Return 200 with `{ id, status: 'deleted' }`
    - Handle 404 (not found) and 409 (active backup) from service
    - _Requirements: 4.3, 4.4, 4.5_

  - [x]* 5.5 Write property tests for download and validation (Properties 2, 3, 5)
    - **Property 2: Invalid backup type rejection** — Generate arbitrary strings not in valid set, assert 400 error
    - **Property 3: Content-Type mapping** — Assert correct Content-Type for plain vs custom format
    - **Property 5: Non-completed status blocks download** — Assert 409 for pending/in_progress/failed statuses
    - **Validates: Requirements 1.4, 3.2, 3.5**

- [x] 6. Wire module into application
  - [x] 6.1 Register BackupModule in AppModule and add environment config
    - Import `BackupModule` in `src/app.module.ts`
    - Add `BACKUP_STORAGE_PATH` to `.env.example` with default value `./backups`
    - Ensure `ConfigModule` (already global) provides the backup storage path
    - _Requirements: 5.1, 5.2_

  - [x]* 6.2 Write unit tests for BackupController
    - Test all endpoints with mocked BackupService
    - Test guard application (mock JwtAuthGuard and RolesGuard)
    - Test error responses (401, 403, 404, 409)
    - _Requirements: 6.1, 6.3, 6.4, 6.5_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (11 properties total)
- Unit tests validate specific examples and edge cases
- The `fast-check` package must be installed as a dev dependency before running property tests
- All backup operations are async — the POST endpoint returns immediately while pg_dump runs in the background

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.1"] },
    { "id": 2, "tasks": ["1.5", "1.6", "2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "3.5"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["5.5", "6.1"] },
    { "id": 7, "tasks": ["6.2"] }
  ]
}
```
