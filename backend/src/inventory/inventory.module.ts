import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryProductsController } from './inventory-products.controller';
import { InventoryReportController } from './inventory-report.controller';
import { InventoryService } from './inventory.service';
import { InventoryProductsService } from './inventory-products.service';
import { InventoryReportService } from './inventory-report.service';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [InventoryProductsController, InventoryController, InventoryReportController],
  providers: [InventoryService, InventoryProductsService, InventoryReportService, JwtAuthGuard],
  exports: [InventoryService, InventoryProductsService],
})
export class InventoryModule {}
