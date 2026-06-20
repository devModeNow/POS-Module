import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BackupService } from '../backup.service';
import * as fs from 'fs/promises';
import * as childProcess from 'child_process';

jest.mock('fs/promises');
jest.mock('child_process');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedChildProcess = childProcess as jest.Mocked<typeof childProcess>;

// Mock uuid to return predictable values
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

describe('BackupService - createBackup', () => {
  let service: BackupService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_USER: 'postgres',
        DB_PASSWORD: 'secret_password',
        DB_NAME: 'test_db',
        BACKUP_STORAGE_PATH: './backups',
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.stat.mockResolvedValue({ size: 2048 } as any);
    mockedFs.unlink.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
  });

  describe('createBackup - immediate return', () => {
    beforeEach(() => {
      // Mock execFile to simulate pg_dump --version success and pg_dump execution success
      (mockedChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (_cmd: string, args: string[], optionsOrCallback: any, callback?: any) => {
          const cb = callback || optionsOrCallback;
          if (typeof cb === 'function') {
            // Simulate async completion
            process.nextTick(() => cb(null, '', ''));
          }
          return { pid: 1234 } as any;
        },
      );
    });

    it('should return metadata immediately with status "pending"', async () => {
      const result = await service.createBackup({ type: 'full', format: 'plain' });

      expect(result.id).toBe('test-uuid-1234');
      expect(result.status).toBe('pending');
      expect(result.type).toBe('full');
      expect(result.format).toBe('plain');
      expect(result.databaseName).toBe('test_db');
      expect(result.createdAt).toBeDefined();
      expect(result.fileName).toMatch(/^test_db_full_\d{8}T\d{6}\.sql$/);
    });

    it('should default type to "full" when not specified', async () => {
      const result = await service.createBackup({});

      expect(result.type).toBe('full');
    });

    it('should default format to "plain" when not specified', async () => {
      const result = await service.createBackup({});

      expect(result.format).toBe('plain');
    });

    it('should store metadata in the internal map', async () => {
      const result = await service.createBackup({ type: 'schema-only', format: 'custom' });

      const stored = service.getBackup(result.id);
      expect(stored).toBeDefined();
      expect(stored!.id).toBe(result.id);
      expect(stored!.type).toBe('schema-only');
      expect(stored!.format).toBe('custom');
    });

    it('should generate correct filename for custom format', async () => {
      const result = await service.createBackup({ type: 'data-only', format: 'custom' });

      expect(result.fileName).toMatch(/^test_db_data_\d{8}T\d{6}\.dump$/);
    });
  });

  describe('createBackup - async pg_dump execution', () => {
    it('should transition to "completed" on successful pg_dump', async () => {
      // Mock execFile: first call is --version check, second is actual pg_dump
      let callCount = 0;
      (mockedChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (_cmd: string, args: string[], optionsOrCallback: any, callback?: any) => {
          const cb = callback || optionsOrCallback;
          callCount++;
          if (typeof cb === 'function') {
            process.nextTick(() => cb(null, 'pg_dump (PostgreSQL) 15.0', ''));
          }
          return { pid: 1234 } as any;
        },
      );

      await service.createBackup({ type: 'full', format: 'plain' });

      // Wait for async execution to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const backup = service.getBackup('test-uuid-1234');
      expect(backup!.status).toBe('completed');
      expect(backup!.fileSizeBytes).toBe(2048);
      expect(backup!.completedAt).toBeDefined();
      expect(backup!.downloadUrl).toBe('/backups/test-uuid-1234/download');
    });

    it('should set status to "failed" when pg_dump is not available', async () => {
      (mockedChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (_cmd: string, args: string[], optionsOrCallback: any, callback?: any) => {
          const cb = callback || optionsOrCallback;
          if (typeof cb === 'function') {
            // First call is --version check - simulate failure
            if (Array.isArray(args) && args.includes('--version')) {
              process.nextTick(() =>
                cb(new Error('pg_dump not found'), '', ''),
              );
            } else {
              process.nextTick(() => cb(null, '', ''));
            }
          }
          return { pid: 1234 } as any;
        },
      );

      await service.createBackup({ type: 'full', format: 'plain' });

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      const backup = service.getBackup('test-uuid-1234');
      expect(backup!.status).toBe('failed');
      expect(backup!.errorMessage).toContain('pg_dump is not available');
    });

    it('should set status to "failed" and cleanup file on pg_dump error', async () => {
      let callCount = 0;
      (mockedChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (_cmd: string, args: string[], optionsOrCallback: any, callback?: any) => {
          const cb = callback || optionsOrCallback;
          callCount++;
          if (typeof cb === 'function') {
            if (callCount === 1) {
              // --version check succeeds
              process.nextTick(() => cb(null, 'pg_dump (PostgreSQL) 15.0', ''));
            } else {
              // Actual pg_dump fails
              const error = new Error('connection refused');
              (error as any).killed = false;
              process.nextTick(() =>
                cb(error, '', 'pg_dump: error: connection to server failed'),
              );
            }
          }
          return { pid: 1234 } as any;
        },
      );

      await service.createBackup({ type: 'full', format: 'plain' });

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      const backup = service.getBackup('test-uuid-1234');
      expect(backup!.status).toBe('failed');
      expect(backup!.errorMessage).toContain('connection to server failed');
      expect(mockedFs.unlink).toHaveBeenCalled();
    });

    it('should set status to "failed" with timeout message when pg_dump times out', async () => {
      let callCount = 0;
      (mockedChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (_cmd: string, args: string[], optionsOrCallback: any, callback?: any) => {
          const cb = callback || optionsOrCallback;
          callCount++;
          if (typeof cb === 'function') {
            if (callCount === 1) {
              // --version check succeeds
              process.nextTick(() => cb(null, 'pg_dump (PostgreSQL) 15.0', ''));
            } else {
              // Simulate timeout (killed = true)
              const error = new Error('process timed out');
              (error as any).killed = true;
              process.nextTick(() => cb(error, '', ''));
            }
          }
          return { pid: 1234 } as any;
        },
      );

      await service.createBackup({ type: 'full', format: 'plain' });

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      const backup = service.getBackup('test-uuid-1234');
      expect(backup!.status).toBe('failed');
      expect(backup!.errorMessage).toContain('timed out after 300 seconds');
      expect(mockedFs.unlink).toHaveBeenCalled();
    });

    it('should pass PGPASSWORD in environment to pg_dump', async () => {
      let capturedOptions: any = null;
      let callCount = 0;
      (mockedChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (_cmd: string, args: string[], options: any, callback?: any) => {
          callCount++;
          if (callCount === 2 && typeof callback === 'function') {
            capturedOptions = options;
            process.nextTick(() => callback(null, '', ''));
          } else if (typeof options === 'function') {
            // --version check (no options object)
            process.nextTick(() => options(null, 'pg_dump 15.0', ''));
          } else if (typeof callback === 'function') {
            process.nextTick(() => callback(null, '', ''));
          }
          return { pid: 1234 } as any;
        },
      );

      await service.createBackup({ type: 'full', format: 'plain' });

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.env.PGPASSWORD).toBe('secret_password');
    });

    it('should set 300-second timeout on pg_dump execution', async () => {
      let capturedOptions: any = null;
      let callCount = 0;
      (mockedChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (_cmd: string, args: string[], options: any, callback?: any) => {
          callCount++;
          if (callCount === 2 && typeof callback === 'function') {
            capturedOptions = options;
            process.nextTick(() => callback(null, '', ''));
          } else if (typeof options === 'function') {
            process.nextTick(() => options(null, 'pg_dump 15.0', ''));
          } else if (typeof callback === 'function') {
            process.nextTick(() => callback(null, '', ''));
          }
          return { pid: 1234 } as any;
        },
      );

      await service.createBackup({ type: 'full', format: 'plain' });

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.timeout).toBe(300_000);
    });

    it('should pass -f flag with file path to pg_dump args', async () => {
      let capturedArgs: string[] = [];
      let callCount = 0;
      (mockedChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (_cmd: string, args: string[], options: any, callback?: any) => {
          callCount++;
          if (callCount === 2 && typeof callback === 'function') {
            capturedArgs = args;
            process.nextTick(() => callback(null, '', ''));
          } else if (typeof options === 'function') {
            process.nextTick(() => options(null, 'pg_dump 15.0', ''));
          } else if (typeof callback === 'function') {
            process.nextTick(() => callback(null, '', ''));
          }
          return { pid: 1234 } as any;
        },
      );

      await service.createBackup({ type: 'full', format: 'plain' });

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(capturedArgs).toContain('-f');
      // The file path should follow the -f flag
      const fIndex = capturedArgs.indexOf('-f');
      expect(fIndex).toBeGreaterThan(-1);
      expect(capturedArgs[fIndex + 1]).toMatch(/test_db_full_\d{8}T\d{6}\.sql$/);
    });
  });
});
