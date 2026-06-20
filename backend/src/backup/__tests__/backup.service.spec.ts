import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { BackupService } from '../backup.service';
import { BackupMetadata } from '../interfaces';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('BackupService', () => {
  let service: BackupService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        DB_NAME: 'test_db',
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedFs.mkdir.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('constructor', () => {
    it('should default BACKUP_STORAGE_PATH to ./backups when not set', () => {
      expect(service.getStoragePath()).toBe('./backups');
    });

    it('should use configured BACKUP_STORAGE_PATH when set', async () => {
      const customPath = '/custom/backup/path';
      const customConfigService = {
        get: jest.fn((key: string, defaultValue?: string) => {
          if (key === 'BACKUP_STORAGE_PATH') return customPath;
          return defaultValue;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BackupService,
          { provide: ConfigService, useValue: customConfigService },
        ],
      }).compile();

      const customService = module.get<BackupService>(BackupService);
      expect(customService.getStoragePath()).toBe(customPath);
    });
  });

  describe('onModuleInit', () => {
    it('should create the storage directory recursively', async () => {
      await service.onModuleInit();

      expect(mockedFs.mkdir).toHaveBeenCalledWith('./backups', { recursive: true });
    });

    it('should throw if directory creation fails', async () => {
      mockedFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      await expect(service.onModuleInit()).rejects.toThrow('Permission denied');
    });
  });

  describe('getBackup', () => {
    it('should return undefined for non-existent backup', () => {
      expect(service.getBackup('non-existent-id')).toBeUndefined();
    });

    it('should return metadata for existing backup', () => {
      const metadata: BackupMetadata = {
        id: 'test-id-1',
        status: 'completed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        completedAt: '2025-01-15T14:31:00.000Z',
        fileSizeBytes: 1024,
        fileName: 'test_db_full_20250115T143022.sql',
      };

      // Access internal map to seed test data
      (service as any).backups.set('test-id-1', metadata);

      const result = service.getBackup('test-id-1');
      expect(result).toEqual(metadata);
    });
  });

  describe('listBackups', () => {
    it('should return empty array when no backups exist', () => {
      expect(service.listBackups()).toEqual([]);
    });

    it('should return backups sorted by createdAt descending', () => {
      const backups: BackupMetadata[] = [
        {
          id: 'oldest',
          status: 'completed',
          type: 'full',
          format: 'plain',
          databaseName: 'test_db',
          createdAt: '2025-01-10T10:00:00.000Z',
        },
        {
          id: 'newest',
          status: 'completed',
          type: 'full',
          format: 'plain',
          databaseName: 'test_db',
          createdAt: '2025-01-15T14:30:22.000Z',
        },
        {
          id: 'middle',
          status: 'in_progress',
          type: 'schema-only',
          format: 'custom',
          databaseName: 'test_db',
          createdAt: '2025-01-12T08:00:00.000Z',
        },
      ];

      const map = (service as any).backups as Map<string, BackupMetadata>;
      backups.forEach((b) => map.set(b.id, b));

      const result = service.listBackups();
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('newest');
      expect(result[1].id).toBe('middle');
      expect(result[2].id).toBe('oldest');
    });
  });

  describe('getBackupFilePath', () => {
    it('should return null for non-existent backup', () => {
      expect(service.getBackupFilePath('non-existent')).toBeNull();
    });

    it('should return null for backup that is not completed', () => {
      const metadata: BackupMetadata = {
        id: 'in-progress-id',
        status: 'in_progress',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        fileName: 'test_db_full_20250115T143022.sql',
      };

      (service as any).backups.set('in-progress-id', metadata);

      expect(service.getBackupFilePath('in-progress-id')).toBeNull();
    });

    it('should return null for completed backup without fileName', () => {
      const metadata: BackupMetadata = {
        id: 'no-file-id',
        status: 'completed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
      };

      (service as any).backups.set('no-file-id', metadata);

      expect(service.getBackupFilePath('no-file-id')).toBeNull();
    });

    it('should return absolute path for completed backup with fileName', () => {
      const metadata: BackupMetadata = {
        id: 'completed-id',
        status: 'completed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        completedAt: '2025-01-15T14:31:00.000Z',
        fileSizeBytes: 2048,
        fileName: 'test_db_full_20250115T143022.sql',
      };

      (service as any).backups.set('completed-id', metadata);

      const result = service.getBackupFilePath('completed-id');
      const expected = path.resolve('./backups', 'test_db_full_20250115T143022.sql');
      expect(result).toBe(expected);
    });

    it('should return null for failed backup', () => {
      const metadata: BackupMetadata = {
        id: 'failed-id',
        status: 'failed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        errorMessage: 'pg_dump failed',
      };

      (service as any).backups.set('failed-id', metadata);

      expect(service.getBackupFilePath('failed-id')).toBeNull();
    });
  });

  describe('deleteBackup', () => {
    it('should throw NotFoundException when backup does not exist', async () => {
      await expect(service.deleteBackup('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when backup status is pending', async () => {
      const metadata: BackupMetadata = {
        id: 'pending-id',
        status: 'pending',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
      };

      (service as any).backups.set('pending-id', metadata);

      await expect(service.deleteBackup('pending-id')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException when backup status is in_progress', async () => {
      const metadata: BackupMetadata = {
        id: 'in-progress-id',
        status: 'in_progress',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
      };

      (service as any).backups.set('in-progress-id', metadata);

      await expect(service.deleteBackup('in-progress-id')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should delete file and metadata for completed backup', async () => {
      const metadata: BackupMetadata = {
        id: 'completed-id',
        status: 'completed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        completedAt: '2025-01-15T14:31:00.000Z',
        fileSizeBytes: 2048,
        fileName: 'test_db_full_20250115T143022.sql',
      };

      (service as any).backups.set('completed-id', metadata);
      mockedFs.unlink.mockResolvedValue(undefined);

      const result = await service.deleteBackup('completed-id');

      expect(result).toEqual({ id: 'completed-id' });
      expect(mockedFs.unlink).toHaveBeenCalledWith(
        path.resolve('./backups', 'test_db_full_20250115T143022.sql'),
      );
      expect((service as any).backups.has('completed-id')).toBe(false);
    });

    it('should delete metadata for failed backup', async () => {
      const metadata: BackupMetadata = {
        id: 'failed-id',
        status: 'failed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        errorMessage: 'pg_dump failed',
        fileName: 'test_db_full_20250115T143022.sql',
      };

      (service as any).backups.set('failed-id', metadata);
      mockedFs.unlink.mockResolvedValue(undefined);

      const result = await service.deleteBackup('failed-id');

      expect(result).toEqual({ id: 'failed-id' });
      expect((service as any).backups.has('failed-id')).toBe(false);
    });

    it('should ignore ENOENT error when file does not exist on disk', async () => {
      const metadata: BackupMetadata = {
        id: 'no-file-id',
        status: 'completed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        completedAt: '2025-01-15T14:31:00.000Z',
        fileName: 'test_db_full_20250115T143022.sql',
      };

      (service as any).backups.set('no-file-id', metadata);
      const enoentError: any = new Error('ENOENT');
      enoentError.code = 'ENOENT';
      mockedFs.unlink.mockRejectedValue(enoentError);

      const result = await service.deleteBackup('no-file-id');

      expect(result).toEqual({ id: 'no-file-id' });
      expect((service as any).backups.has('no-file-id')).toBe(false);
    });

    it('should rethrow non-ENOENT errors from fs.unlink', async () => {
      const metadata: BackupMetadata = {
        id: 'error-id',
        status: 'completed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        completedAt: '2025-01-15T14:31:00.000Z',
        fileName: 'test_db_full_20250115T143022.sql',
      };

      (service as any).backups.set('error-id', metadata);
      const permError: any = new Error('Permission denied');
      permError.code = 'EACCES';
      mockedFs.unlink.mockRejectedValue(permError);

      await expect(service.deleteBackup('error-id')).rejects.toThrow(
        'Permission denied',
      );
    });

    it('should handle backup without fileName gracefully', async () => {
      const metadata: BackupMetadata = {
        id: 'no-filename-id',
        status: 'failed',
        type: 'full',
        format: 'plain',
        databaseName: 'test_db',
        createdAt: '2025-01-15T14:30:22.000Z',
        errorMessage: 'Failed before file was created',
      };

      (service as any).backups.set('no-filename-id', metadata);

      const result = await service.deleteBackup('no-filename-id');

      expect(result).toEqual({ id: 'no-filename-id' });
      expect(mockedFs.unlink).not.toHaveBeenCalled();
      expect((service as any).backups.has('no-filename-id')).toBe(false);
    });
  });
});
