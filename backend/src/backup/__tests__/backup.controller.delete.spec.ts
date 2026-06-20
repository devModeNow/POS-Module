import { NotFoundException, ConflictException } from '@nestjs/common';
import { BackupController } from '../backup.controller';
import { BackupService } from '../backup.service';

describe('BackupController - DELETE /backups/:id', () => {
  let controller: BackupController;
  let service: Partial<BackupService>;

  beforeEach(() => {
    service = {
      deleteBackup: jest.fn().mockResolvedValue({ id: 'abc-123' }),
    };

    controller = new BackupController(service as BackupService);
  });

  it('should return id and status "deleted" on successful deletion', async () => {
    const result = await controller.deleteBackup('abc-123');

    expect(result).toEqual({ id: 'abc-123', status: 'deleted' });
    expect(service.deleteBackup).toHaveBeenCalledWith('abc-123');
  });

  it('should propagate NotFoundException when backup does not exist', async () => {
    (service.deleteBackup as jest.Mock).mockRejectedValue(
      new NotFoundException('Backup with id "non-existent" not found'),
    );

    await expect(controller.deleteBackup('non-existent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should propagate ConflictException when backup is active', async () => {
    (service.deleteBackup as jest.Mock).mockRejectedValue(
      new ConflictException(
        'Cannot delete backup with status "in_progress". Backup is still in progress.',
      ),
    );

    await expect(controller.deleteBackup('active-backup')).rejects.toThrow(
      ConflictException,
    );
  });

  it('should delegate to BackupService.deleteBackup with the correct id', async () => {
    await controller.deleteBackup('my-backup-id');

    expect(service.deleteBackup).toHaveBeenCalledTimes(1);
    expect(service.deleteBackup).toHaveBeenCalledWith('my-backup-id');
  });
});
