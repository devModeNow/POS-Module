import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  StreamableFile,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { BackupService } from './backup.service';
import { CreateBackupDto } from './dto/create-backup.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from './guards/roles.guard';
import type { BackupMetadata } from './interfaces';

/**
 * Controller for database backup operations.
 * All endpoints require admin or superadmin role.
 *
 * @see Requirements 1.1, 1.3, 1.4, 4.1, 4.2, 6.1, 6.2, 7.3, 7.4, 7.5, 7.7
 */
@Controller('backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /**
   * Triggers a new database backup.
   * Returns 202 Accepted with the backup ID and initial status.
   *
   * @param createBackupDto - Backup options (type, format)
   * @returns Object with backup id and status
   *
   * @see Requirements 1.1, 1.3, 1.4, 1.5, 1.6
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async create(@Body() createBackupDto: CreateBackupDto) {
    try {
      const backup = await this.backupService.createBackup(createBackupDto);
      return { id: backup.id, status: backup.status };
    } catch (error) {
      throw new InternalServerErrorException(
        error.message || 'Failed to initiate backup',
      );
    }
  }

  /**
   * Returns a list of all backups sorted by creation timestamp descending.
   *
   * @returns Array of backup metadata
   * @see Requirements 4.1, 4.2
   */
  @Get()
  list(): BackupMetadata[] {
    return this.backupService.listBackups();
  }

  /**
   * Downloads a completed backup file by streaming it to the client.
   * Sets appropriate Content-Type and Content-Disposition headers.
   *
   * @param id - Backup identifier
   * @param res - Express response object (passthrough mode)
   * @returns StreamableFile wrapping the backup file read stream
   * @throws NotFoundException if backup does not exist or file is missing from disk
   * @throws ConflictException if backup status is not "completed"
   * @see Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
   */
  @Get(':id/download')
  download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const backup = this.backupService.getBackup(id);
    if (!backup) {
      throw new NotFoundException(`Backup with id "${id}" not found`);
    }

    if (backup.status !== 'completed') {
      throw new ConflictException(
        `Cannot download backup with status "${backup.status}". Backup must be completed.`,
      );
    }

    const filePath = this.backupService.getBackupFilePath(id);
    if (!filePath || !existsSync(filePath)) {
      throw new NotFoundException('Backup file is unavailable on disk');
    }

    const contentType =
      backup.format === 'plain' ? 'application/sql' : 'application/octet-stream';

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${backup.fileName}"`,
    });

    const fileStream = createReadStream(filePath);
    return new StreamableFile(fileStream);
  }

  /**
   * Returns metadata for a single backup by ID.
   * Includes downloadUrl and fileSizeBytes when status is "completed".
   * Includes errorMessage when status is "failed".
   *
   * @param id - Backup identifier
   * @returns Backup metadata
   * @throws NotFoundException if backup ID does not exist
   * @see Requirements 7.3, 7.4, 7.5, 7.7
   */
  @Get(':id')
  getOne(@Param('id') id: string): BackupMetadata {
    const backup = this.backupService.getBackup(id);
    if (!backup) {
      throw new NotFoundException(`Backup with id "${id}" not found`);
    }
    return backup;
  }

  /**
   * DELETE /backups/:id
   * Deletes a backup by its identifier.
   * Delegates to BackupService.deleteBackup which throws:
   * - NotFoundException (404) if backup doesn't exist
   * - ConflictException (409) if backup is still active (pending/in_progress)
   *
   * @param id - The backup identifier
   * @returns Object with id and status 'deleted'
   * @see Requirements 4.3, 4.4, 4.5
   */
  @Delete(':id')
  async deleteBackup(@Param('id') id: string) {
    await this.backupService.deleteBackup(id);
    return { id, status: 'deleted' };
  }
}
