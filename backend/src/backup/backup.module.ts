import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  imports: [ConfigModule],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
