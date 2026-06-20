import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryReportController } from './inventory-report.controller';
import { InventoryService } from './inventory.service';
import { InventoryReportService } from './inventory-report.service';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [InventoryController, InventoryReportController],
  providers: [InventoryService, InventoryReportService, JwtAuthGuard],
  exports: [InventoryService],
})
export class InventoryModule {}
