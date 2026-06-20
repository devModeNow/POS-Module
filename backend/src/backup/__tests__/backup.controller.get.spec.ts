import { NotFoundException } from '@nestjs/common';
import { BackupController } from '../backup.controller';
import { BackupService } from '../backup.service';
import { BackupMetadata } from '../interfaces';

describe('BackupController - GET endpoints', () => {
  let controller: BackupController;
  let service: Partial<BackupService>;

  const completedBackup: BackupMetadata = {
    id: 'abc-123',
    status: 'completed',
    type: 'full',
    format: 'plain',
    databaseName: 'test_db',
    createdAt: '2025-01-15T14:30:22.000Z',
    completedAt: '2025-01-15T14:31:00.000Z',
    fileSizeBytes: 1024,
    fileName: 'test_db_full_20250115T143022.sql',
    downloadUrl: '/backups/abc-123/download',
  };

  const failedBackup: BackupMetadata = {
    id: 'def-456',
    status: 'failed',
    type: 'schema-only',
    format: 'plain',
    databaseName: 'test_db',
    createdAt: '2025-01-15T13:00:00.000Z',
    completedAt: '2025-01-15T13:01:00.000Z',
    errorMessage: 'pg_dump timed out after 300 seconds',
  };

  const pendingBackup: BackupMetadata = {
    id: 'ghi-789',
    status: 'pending',
    type: 'data-only',
    format: 'custom',
    databaseName: 'test_db',
    createdAt: '2025-01-15T15:00:00.000Z',
  };

  beforeEach(() => {
    service = {
      listBackups: jest.fn().mockReturnValue([completedBackup, failedBackup, pendingBackup]),
      getBackup: jest.fn().mockImplementation((id: string) => {
        const map: Record<string, BackupMetadata> = {
          'abc-123': completedBackup,
          'def-456': failedBackup,
          'ghi-789': pendingBackup,
        };
        return map[id];
      }),
    };

    controller = new BackupController(service as BackupService);
  });

  describe('GET /backups', () => {
    it('should return list of all backups', () => {
      const result = controller.list();

      expect(result).toHaveLength(3);
      expect(service.listBackups).toHaveBeenCalled();
    });

    it('should return backups with metadata fields', () => {
      const result = controller.list();

      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('status');
      expect(result[0]).toHaveProperty('type');
      expect(result[0]).toHaveProperty('createdAt');
      expect(result[0]).toHaveProperty('databaseName');
    });

    it('should include downloadUrl and fileSizeBytes for completed backups', () => {
      const result = controller.list();
      const completed = result.find((b) => b.status === 'completed');

      expect(completed?.downloadUrl).toBe('/backups/abc-123/download');
      expect(completed?.fileSizeBytes).toBe(1024);
    });

    it('should include errorMessage for failed backups', () => {
      const result = controller.list();
      const failed = result.find((b) => b.status === 'failed');

      expect(failed?.errorMessage).toBe('pg_dump timed out after 300 seconds');
    });

    it('should return empty array when no backups exist', () => {
      (service.listBackups as jest.Mock).mockReturnValue([]);

      const result = controller.list();

      expect(result).toEqual([]);
    });
  });

  describe('GET /backups/:id', () => {
    it('should return backup metadata for a valid ID', () => {
      const result = controller.getOne('abc-123');

      expect(result).toEqual(completedBackup);
      expect(service.getBackup).toHaveBeenCalledWith('abc-123');
    });

    it('should throw NotFoundException for non-existent ID', () => {
      expect(() => controller.getOne('non-existent')).toThrow(NotFoundException);
    });

    it('should include downloadUrl and fileSizeBytes when status is completed', () => {
      const result = controller.getOne('abc-123');

      expect(result.downloadUrl).toBe('/backups/abc-123/download');
      expect(result.fileSizeBytes).toBe(1024);
    });

    it('should include errorMessage when status is failed', () => {
      const result = controller.getOne('def-456');

      expect(result.errorMessage).toBe('pg_dump timed out after 300 seconds');
    });

    it('should return pending backup without downloadUrl or errorMessage', () => {
      const result = controller.getOne('ghi-789');

      expect(result.status).toBe('pending');
      expect(result.downloadUrl).toBeUndefined();
      expect(result.fileSizeBytes).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
    });
  });
});
