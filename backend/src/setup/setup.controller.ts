import {
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SetupService } from './setup.service';

@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  /** Check if the database needs setup (no core tables exist) */
  @Get('status')
  async getStatus() {
    return this.setupService.getStatus();
  }

  /** Execute a SQL backup file to initialize the database */
  @Post('restore')
  @UseInterceptors(FileInterceptor('file'))
  async restore(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('SQL file is required');
    }

    const filename = file.originalname ?? 'backup.sql';
    if (!filename.endsWith('.sql')) {
      throw new BadRequestException('Only .sql files are accepted');
    }

    const sql = file.buffer.toString('utf-8');
    if (!sql.trim()) {
      throw new BadRequestException('SQL file is empty');
    }

    return this.setupService.restore(sql);
  }
}
