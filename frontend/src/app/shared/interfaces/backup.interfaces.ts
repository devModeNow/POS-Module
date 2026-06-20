/**
 * Backup type determining what content is included in the backup.
 * - full: schema + data
 * - schema-only: DDL statements only
 * - data-only: INSERT statements only
 */
export type BackupType = 'full' | 'schema-only' | 'data-only';

/**
 * Backup format determining the output file format.
 * - plain: Standard SQL text format (.sql)
 * - custom: PostgreSQL custom archive format (.dump)
 */
export type BackupFormat = 'plain' | 'custom';

/**
 * Metadata describing a database backup operation and its result.
 */
export interface BackupMetadata {
  /** Unique backup identifier (UUID v4) */
  id: string;

  /** Current lifecycle status of the backup */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';

  /** Type of backup content */
  type: BackupType;

  /** Output file format */
  format: BackupFormat;

  /** Name of the database that was backed up */
  databaseName: string;

  /** ISO 8601 timestamp when the backup was initiated */
  createdAt: string;

  /** ISO 8601 timestamp when the backup completed (success or failure) */
  completedAt?: string;

  /** Size of the generated backup file in bytes */
  fileSizeBytes?: number;

  /** Name of the backup file on disk */
  fileName?: string;

  /** Error details if status is "failed" */
  errorMessage?: string;

  /** Relative URL for downloading the backup file */
  downloadUrl?: string;
}

/**
 * Parameters for creating a new backup.
 */
export interface CreateBackupParams {
  type: BackupType;
  format: BackupFormat;
}

/**
 * Response returned after initiating a backup creation.
 */
export interface CreateBackupResponse {
  id: string;
  status: string;
}

/**
 * Response returned after deleting a backup.
 */
export interface DeleteBackupResponse {
  id: string;
  status: 'deleted';
}
