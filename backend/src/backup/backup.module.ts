import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [ConfigModule],
  controllers: [BackupController],
  providers: [BackupService, RolesGuard],
})
export class BackupModule {}
