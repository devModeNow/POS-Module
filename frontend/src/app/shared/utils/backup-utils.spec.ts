import {
  formatBackupDate,
  formatFileSize,
  extractFilename,
  shouldPoll,
  getStatusBadgeClasses,
  getStatusAriaLabel,
} from './backup-utils';
import { BackupMetadata } from '../interfaces/backup.interfaces';

describe('backup-utils', () => {
  describe('formatBackupDate', () => {
    it('should format an ISO 8601 string to a human-readable date/time', () => {
      const result = formatBackupDate('2025-01-15T14:30:00.000Z');
      // The exact output depends on locale/timezone, but should contain key parts
      expect(result).toContain('2025');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
    });

    it('should handle dates with different months', () => {
      const result = formatBackupDate('2024-12-25T08:00:00.000Z');
      expect(result).toContain('Dec');
      expect(result).toContain('25');
      expect(result).toContain('2024');
    });
  });

  describe('formatFileSize', () => {
    it('should display bytes with no decimal for values less than 1024', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(1023)).toBe('1023 B');
    });

    it('should display KB with one decimal for values >= 1024 and < 1MB', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(10240)).toBe('10.0 KB');
    });

    it('should display MB with one decimal for values >= 1MB and < 1GB', () => {
      expect(formatFileSize(1048576)).toBe('1.0 MB');
      expect(formatFileSize(2621440)).toBe('2.5 MB');
    });

    it('should display GB with one decimal for values >= 1GB', () => {
      expect(formatFileSize(1073741824)).toBe('1.0 GB');
      expect(formatFileSize(5368709120)).toBe('5.0 GB');
    });
  });

  describe('extractFilename', () => {
    it('should return null for null input', () => {
      expect(extractFilename(null)).toBeNull();
    });

    it('should extract filename from quoted format', () => {
      expect(extractFilename('attachment; filename="backup-2025.sql"')).toBe('backup-2025.sql');
    });

    it('should extract filename from unquoted format', () => {
      expect(extractFilename('attachment; filename=backup-2025.sql')).toBe('backup-2025.sql');
    });

    it('should return null if no filename directive is found', () => {
      expect(extractFilename('attachment; other=value')).toBeNull();
    });

    it('should handle filename with spaces in quoted format', () => {
      expect(extractFilename('attachment; filename="my backup file.sql"')).toBe('my backup file.sql');
    });
  });

  describe('shouldPoll', () => {
    it('should return false for an empty array', () => {
      expect(shouldPoll([])).toBe(false);
    });

    it('should return true if any backup is pending', () => {
      const backups = [
        { status: 'completed' } as BackupMetadata,
        { status: 'pending' } as BackupMetadata,
      ];
      expect(shouldPoll(backups)).toBe(true);
    });

    it('should return true if any backup is in_progress', () => {
      const backups = [
        { status: 'completed' } as BackupMetadata,
        { status: 'in_progress' } as BackupMetadata,
      ];
      expect(shouldPoll(backups)).toBe(true);
    });

    it('should return false if all backups are terminal', () => {
      const backups = [
        { status: 'completed' } as BackupMetadata,
        { status: 'failed' } as BackupMetadata,
      ];
      expect(shouldPoll(backups)).toBe(false);
    });
  });

  describe('getStatusBadgeClasses', () => {
    it('should return gray classes for pending status', () => {
      const classes = getStatusBadgeClasses('pending');
      expect(classes).toContain('bg-gray-100');
      expect(classes).toContain('text-gray-800');
    });

    it('should return blue classes with pulse for in_progress status', () => {
      const classes = getStatusBadgeClasses('in_progress');
      expect(classes).toContain('bg-blue-100');
      expect(classes).toContain('text-blue-800');
      expect(classes).toContain('animate-pulse');
    });

    it('should return green classes for completed status', () => {
      const classes = getStatusBadgeClasses('completed');
      expect(classes).toContain('bg-green-100');
      expect(classes).toContain('text-green-800');
    });

    it('should return red classes for failed status', () => {
      const classes = getStatusBadgeClasses('failed');
      expect(classes).toContain('bg-red-100');
      expect(classes).toContain('text-red-800');
    });
  });

  describe('getStatusAriaLabel', () => {
    it('should return "Status: Pending" for pending', () => {
      expect(getStatusAriaLabel('pending')).toBe('Status: Pending');
    });

    it('should return "Status: In Progress" for in_progress', () => {
      expect(getStatusAriaLabel('in_progress')).toBe('Status: In Progress');
    });

    it('should return "Status: Completed" for completed', () => {
      expect(getStatusAriaLabel('completed')).toBe('Status: Completed');
    });

    it('should return "Status: Failed" for failed', () => {
      expect(getStatusAriaLabel('failed')).toBe('Status: Failed');
    });
  });
});
