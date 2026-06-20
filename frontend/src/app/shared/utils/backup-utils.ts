import { BackupMetadata } from '../interfaces/backup.interfaces';

/**
 * Formats an ISO 8601 timestamp to a human-readable local date/time string.
 * Example output: "Jan 15, 2025, 2:30 PM"
 */
export function formatBackupDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Formats a byte count to a human-readable file size string.
 * - Less than 1024: displays as whole bytes (e.g., "512 B")
 * - 1024+: uses the largest appropriate unit with exactly one decimal place (e.g., "2.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Extracts the filename from a Content-Disposition header value.
 * Handles both quoted (`filename="file.sql"`) and unquoted (`filename=file.sql`) formats.
 * Returns null if the header is null or no filename is found.
 */
export function extractFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  // Try quoted format first: filename="..."
  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Try unquoted format: filename=...
  const unquotedMatch = contentDisposition.match(/filename=([^\s;]+)/);
  if (unquotedMatch) {
    return unquotedMatch[1];
  }

  return null;
}

/**
 * Determines if polling should be active based on the current backup list.
 * Returns true if any backup has a non-terminal status ('pending' or 'in_progress').
 */
export function shouldPoll(backups: BackupMetadata[]): boolean {
  return backups.some(
    (backup) => backup.status === 'pending' || backup.status === 'in_progress'
  );
}

/**
 * Returns Tailwind CSS classes for a status badge based on the backup status.
 * - pending: gray background
 * - in_progress: blue background with pulse animation
 * - completed: green background
 * - failed: red background
 */
export function getStatusBadgeClasses(status: BackupMetadata['status']): string {
  switch (status) {
    case 'pending':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    case 'in_progress':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 animate-pulse';
    case 'completed':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
  }
}

/**
 * Returns an accessible aria-label string for a status badge.
 * Format: "Status: {Human Readable Status}" with title case.
 * Example: "in_progress" → "Status: In Progress"
 */
export function getStatusAriaLabel(status: BackupMetadata['status']): string {
  const labelMap: Record<BackupMetadata['status'], string> = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    failed: 'Failed',
  };

  return `Status: ${labelMap[status]}`;
}
