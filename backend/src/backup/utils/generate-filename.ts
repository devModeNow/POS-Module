import { BackupType, BackupFormat } from '../interfaces/backup-metadata.interface';

/**
 * Maps backup type to the filename segment.
 * - full → 'full'
 * - schema-only → 'schema'
 * - data-only → 'data'
 */
const BACKUP_TYPE_SEGMENT: Record<BackupType, string> = {
  full: 'full',
  'schema-only': 'schema',
  'data-only': 'data',
};

/**
 * Maps backup format to the file extension.
 * - plain → 'sql'
 * - custom → 'dump'
 */
const FORMAT_EXTENSION: Record<BackupFormat, string> = {
  plain: 'sql',
  custom: 'dump',
};

/**
 * Formats a Date into the ISO 8601 basic timestamp format: YYYYMMDDTHHmmss
 */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Generates a backup filename following the pattern:
 * {databaseName}_{backupType}_{YYYYMMDDTHHmmss}.{extension}
 *
 * @param databaseName - Name of the database being backed up
 * @param type - Backup type (full, schema-only, data-only)
 * @param format - Backup format (plain, custom)
 * @param date - Optional date for the timestamp (defaults to current time)
 * @returns Generated filename string
 *
 * @see Requirements 5.4, 3.3
 */
export function generateFilename(
  databaseName: string,
  type: BackupType,
  format: BackupFormat,
  date: Date = new Date(),
): string {
  const typeSegment = BACKUP_TYPE_SEGMENT[type];
  const extension = FORMAT_EXTENSION[format];
  const timestamp = formatTimestamp(date);

  return `${databaseName}_${typeSegment}_${timestamp}.${extension}`;
}
