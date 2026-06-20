import {
  Injectable,
  OnModuleInit,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

import { BackupMetadata, BackupType, BackupFormat } from './interfaces';
import { buildPgDumpArgs } from './utils/build-pg-dump-args';
import { generateFilename } from './utils/generate-filename';

/**
 * Service responsible for managing database backup operations.
 * Stores backup metadata in-memory using a Map.
 *
 * @see Requirements 4.1, 4.2, 5.1, 5.2, 5.3, 7.1, 7.2, 7.3
 */
@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private readonly backups = new Map<string, BackupMetadata>();
  private readonly storagePath: string;

  /** Timeout for pg_dump execution in milliseconds (300 seconds) */
  private readonly PG_DUMP_TIMEOUT_MS = 300_000;

  /** Path to the pg_dump executable (defaults to 'pg_dump' which relies on PATH) */
  private readonly pgDumpPath: string;

  constructor(private readonly configService: ConfigService) {
    this.storagePath = this.configService.get<string>(
      'BACKUP_STORAGE_PATH',
      './backups',
    );
    this.pgDumpPath = this.configService.get<string>(
      'PG_DUMP_PATH',
      'pg_dump',
    );
  }

  /**
   * Ensures the backup storage directory exists on module initialization.
   * Creates the directory recursively if it does not exist.
   * @see Requirements 5.3
   */
  async onModuleInit(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
      this.logger.log(`Backup storage directory ensured at: ${this.storagePath}`);
    } catch (error) {
      this.logger.error(
        `Failed to create backup storage directory: ${this.storagePath}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Retrieves backup metadata by ID.
   * @param id - The backup identifier
   * @returns The backup metadata or undefined if not found
   * @see Requirements 7.3
   */
  getBackup(id: string): BackupMetadata | undefined {
    return this.backups.get(id);
  }

  /**
   * Returns all backups sorted by createdAt in descending order (most recent first).
   * @returns Array of backup metadata sorted by creation timestamp descending
   * @see Requirements 4.1
   */
  listBackups(): BackupMetadata[] {
    return Array.from(this.backups.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * Returns the absolute file path for a completed backup.
   * @param id - The backup identifier
   * @returns Absolute path to the backup file if the backup exists and is completed, otherwise null
   * @see Requirements 5.1
   */
  getBackupFilePath(id: string): string | null {
    const backup = this.backups.get(id);
    if (!backup || backup.status !== 'completed' || !backup.fileName) {
      return null;
    }
    return path.resolve(this.storagePath, backup.fileName);
  }

  /**
   * Creates a new database backup using pg_dump.
   *
   * Returns metadata immediately with status "pending" and executes
   * pg_dump asynchronously in the background (fire-and-forget).
   *
   * @param options - Backup options (type, format)
   * @returns Backup metadata with initial "pending" status
   *
   * @see Requirements 1.1, 1.3, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 5.5, 7.1, 7.6
   */
  async createBackup(options: {
    type?: string;
    format?: string;
  }): Promise<BackupMetadata> {
    const backupType: BackupType = (options.type as BackupType) || 'full';
    const backupFormat: BackupFormat = (options.format as BackupFormat) || 'plain';

    const id = uuidv4();
    const databaseName = this.configService.get<string>('DB_NAME', 'postgres');
    const fileName = generateFilename(databaseName, backupType, backupFormat);

    const metadata: BackupMetadata = {
      id,
      status: 'pending',
      type: backupType,
      format: backupFormat,
      databaseName,
      createdAt: new Date().toISOString(),
      fileName,
    };

    this.backups.set(id, metadata);

    // Fire-and-forget: execute pg_dump in the background
    this.executePgDump(id, backupType, backupFormat, fileName).catch((error) => {
      this.logger.error(`Unexpected error in backup ${id}: ${error.message}`);
    });

    return metadata;
  }

  /**
   * Executes pg_dump asynchronously. Updates metadata status throughout the process.
   * @param id - Backup ID
   * @param type - Backup type
   * @param format - Backup format
   * @param fileName - Output file name
   */
  private async executePgDump(
    id: string,
    type: BackupType,
    format: BackupFormat,
    fileName: string,
  ): Promise<void> {
    const metadata = this.backups.get(id);
    if (!metadata) return;

    const filePath = path.resolve(this.storagePath, fileName);

    // Step 1: Validate pg_dump availability
    try {
      await this.validatePgDumpAvailability();
    } catch (error) {
      metadata.status = 'failed';
      metadata.errorMessage = `pg_dump is not available: ${error.message}`;
      metadata.completedAt = new Date().toISOString();
      this.logger.error(`Backup ${id} failed: pg_dump not available`);
      return;
    }

    // Step 2: Transition to in_progress
    metadata.status = 'in_progress';

    // Step 3: Build pg_dump arguments
    const dbConfig = {
      host: this.configService.get<string>('DB_HOST', '127.0.0.1'),
      port: parseInt(this.configService.get<string>('DB_PORT', '5432'), 10),
      username: this.configService.get<string>('DB_USER', 'postgres'),
      dbname: this.configService.get<string>('DB_NAME', 'postgres'),
    };

    const args = buildPgDumpArgs(dbConfig, { type, format });

    // Add output file flag (-f) to direct output to file
    args.push('-f', filePath);

    // Step 4: Execute pg_dump with PGPASSWORD env var
    const password = this.configService.get<string>('DB_PASSWORD', '');

    try {
      await this.spawnPgDump(args, password);

      // Success: record file size and mark completed
      const stats = await fs.stat(filePath);
      metadata.fileSizeBytes = stats.size;
      metadata.status = 'completed';
      metadata.completedAt = new Date().toISOString();
      metadata.downloadUrl = `/backups/${id}/download`;
      this.logger.log(
        `Backup ${id} completed successfully (${stats.size} bytes)`,
      );
    } catch (error) {
      // Failure: clean up partial file and mark failed
      metadata.status = 'failed';
      metadata.errorMessage = error.message || 'pg_dump execution failed';
      metadata.completedAt = new Date().toISOString();
      await this.cleanupPartialFile(filePath);
      this.logger.error(`Backup ${id} failed: ${error.message}`);
    }
  }

  /**
   * Validates that pg_dump is available on the system by running `pg_dump --version`.
   * @throws Error if pg_dump is not found or cannot be executed
   * @see Requirements 1.6
   */
  private validatePgDumpAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(this.pgDumpPath, ['--version'], (error) => {
        if (error) {
          reject(new Error(error.message || 'pg_dump not found'));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Spawns pg_dump as a child process with the given arguments.
   * Sets PGPASSWORD environment variable and enforces a 300-second timeout.
   *
   * @param args - pg_dump command-line arguments
   * @param password - Database password to set as PGPASSWORD
   * @returns Promise that resolves on success (exit code 0) or rejects on failure
   *
   * @see Requirements 1.7, 2.7
   */
  private spawnPgDump(args: string[], password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const childProcess = execFile(
        this.pgDumpPath,
        args,
        {
          env: { ...process.env, PGPASSWORD: password },
          timeout: this.PG_DUMP_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer for stderr
        },
        (error, _stdout, stderr) => {
          if (error) {
            if (error.killed) {
              // Process was killed due to timeout
              reject(
                new Error(
                  `pg_dump timed out after ${this.PG_DUMP_TIMEOUT_MS / 1000} seconds`,
                ),
              );
            } else {
              // Non-zero exit code or other error
              const errorMsg =
                stderr?.trim() || error.message || 'pg_dump failed';
              reject(new Error(errorMsg));
            }
          } else {
            resolve();
          }
        },
      );

      // Node.js execFile with timeout option will send SIGTERM automatically
      if (!childProcess) {
        reject(new Error('Failed to spawn pg_dump process'));
      }
    });
  }

  /**
   * Removes a partial backup file from disk.
   * Silently ignores ENOENT errors (file doesn't exist).
   * @see Design: Partial File Cleanup
   */
  private async cleanupPartialFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        this.logger.warn(
          `Failed to cleanup partial file: ${filePath}`,
          err.message,
        );
      }
    }
  }

  /**
   * Deletes a backup by ID.
   * Removes the backup file from disk and the metadata from the store.
   *
   * @param id - The backup identifier
   * @returns Object containing the deleted backup ID
   * @throws NotFoundException if the backup does not exist
   * @throws ConflictException if the backup is still active (pending or in_progress)
   * @see Requirements 4.3, 4.4, 4.5
   */
  async deleteBackup(id: string): Promise<{ id: string }> {
    const backup = this.backups.get(id);

    if (!backup) {
      throw new NotFoundException(`Backup with id "${id}" not found`);
    }

    if (backup.status === 'pending' || backup.status === 'in_progress') {
      throw new ConflictException(
        `Cannot delete backup with status "${backup.status}". Backup is still in progress.`,
      );
    }

    // Delete file from disk (ignore if file doesn't exist)
    if (backup.fileName) {
      const filePath = path.resolve(this.storagePath, backup.fileName);
      try {
        await fs.unlink(filePath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          this.logger.warn(`Failed to delete backup file: ${filePath}`, err.message);
          throw err;
        }
      }
    }

    // Remove metadata from store
    this.backups.delete(id);

    return { id };
  }

  /**
   * Returns the configured storage path.
   * Useful for testing and internal access.
   */
  getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * Provides access to the internal metadata store for testing purposes.
   * @internal
   */
  protected getBackupsMap(): Map<string, BackupMetadata> {
    return this.backups;
  }
}
