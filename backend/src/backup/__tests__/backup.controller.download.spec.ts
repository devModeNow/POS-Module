import { NotFoundException, ConflictException, StreamableFile } from '@nestjs/common';
import { BackupController } from '../backup.controller';
import { BackupService } from '../backup.service';
import { BackupMetadata } from '../interfaces';
import * as fs from 'fs';
import { Readable } from 'stream';

// Mock the fs module
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  createReadStream: jest.fn(),
}));

describe('BackupController - GET /backups/:id/download', () => {
  let controller: BackupController;
  let service: Partial<BackupService>;
  let mockResponse: any;

  const completedPlainBackup: BackupMetadata = {
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

  const completedCustomBackup: BackupMetadata = {
    id: 'custom-456',
    status: 'completed',
    type: 'full',
    format: 'custom',
    databaseName: 'test_db',
    createdAt: '2025-01-15T14:30:22.000Z',
    completedAt: '2025-01-15T14:31:00.000Z',
    fileSizeBytes: 2048,
    fileName: 'test_db_full_20250115T143022.dump',
    downloadUrl: '/backups/custom-456/download',
  };

  const pendingBackup: BackupMetadata = {
    id: 'pending-789',
    status: 'pending',
    type: 'data-only',
    format: 'plain',
    databaseName: 'test_db',
    createdAt: '2025-01-15T15:00:00.000Z',
  };

  const failedBackup: BackupMetadata = {
    id: 'failed-101',
    status: 'failed',
    type: 'full',
    format: 'plain',
    databaseName: 'test_db',
    createdAt: '2025-01-15T13:00:00.000Z',
    errorMessage: 'pg_dump failed',
  };

  beforeEach(() => {
    service = {
      getBackup: jest.fn().mockImplementation((id: string) => {
        const map: Record<string, BackupMetadata> = {
          'abc-123': completedPlainBackup,
          'custom-456': completedCustomBackup,
          'pending-789': pendingBackup,
          'failed-101': failedBackup,
        };
        return map[id];
      }),
      getBackupFilePath: jest.fn().mockImplementation((id: string) => {
        if (id === 'abc-123') return '/backups/test_db_full_20250115T143022.sql';
        if (id === 'custom-456') return '/backups/test_db_full_20250115T143022.dump';
        return null;
      }),
    };

    mockResponse = {
      set: jest.fn(),
    };

    controller = new BackupController(service as BackupService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should throw NotFoundException when backup does not exist', () => {
    expect(() => controller.download('non-existent', mockResponse)).toThrow(
      NotFoundException,
    );
  });

  it('should throw ConflictException when backup status is pending', () => {
    expect(() => controller.download('pending-789', mockResponse)).toThrow(
      ConflictException,
    );
  });

  it('should throw ConflictException when backup status is failed', () => {
    expect(() => controller.download('failed-101', mockResponse)).toThrow(
      ConflictException,
    );
  });

  it('should throw NotFoundException when file does not exist on disk', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    expect(() => controller.download('abc-123', mockResponse)).toThrow(
      NotFoundException,
    );
  });

  it('should return StreamableFile for completed plain backup', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const mockStream = new Readable({ read() {} });
    (fs.createReadStream as jest.Mock).mockReturnValue(mockStream);

    const result = controller.download('abc-123', mockResponse);

    expect(result).toBeInstanceOf(StreamableFile);
  });

  it('should set Content-Type to application/sql for plain format', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const mockStream = new Readable({ read() {} });
    (fs.createReadStream as jest.Mock).mockReturnValue(mockStream);

    controller.download('abc-123', mockResponse);

    expect(mockResponse.set).toHaveBeenCalledWith({
      'Content-Type': 'application/sql',
      'Content-Disposition': 'attachment; filename="test_db_full_20250115T143022.sql"',
    });
  });

  it('should set Content-Type to application/octet-stream for custom format', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const mockStream = new Readable({ read() {} });
    (fs.createReadStream as jest.Mock).mockReturnValue(mockStream);

    controller.download('custom-456', mockResponse);

    expect(mockResponse.set).toHaveBeenCalledWith({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="test_db_full_20250115T143022.dump"',
    });
  });

  it('should set Content-Disposition with correct filename', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const mockStream = new Readable({ read() {} });
    (fs.createReadStream as jest.Mock).mockReturnValue(mockStream);

    controller.download('abc-123', mockResponse);

    expect(mockResponse.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition': 'attachment; filename="test_db_full_20250115T143022.sql"',
      }),
    );
  });

  it('should create read stream from the correct file path', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const mockStream = new Readable({ read() {} });
    (fs.createReadStream as jest.Mock).mockReturnValue(mockStream);

    controller.download('abc-123', mockResponse);

    expect(fs.createReadStream).toHaveBeenCalledWith(
      '/backups/test_db_full_20250115T143022.sql',
    );
  });

  it('should include current status in ConflictException message', () => {
    try {
      controller.download('pending-789', mockResponse);
      fail('Expected ConflictException');
    } catch (error) {
      expect(error.message).toContain('pending');
    }
  });
});
