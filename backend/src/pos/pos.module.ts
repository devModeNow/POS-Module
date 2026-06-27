import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PosDashboardController } from './controllers/dashboard.controller';
import { PosStoreReportsController } from './controllers/store-reports.controller';
import { PosTerminalController } from './controllers/terminal.controller';
import { PosDashboardService } from './services/dashboard.service';
import { PosDiscountsService } from './services/discounts.service';
import { PosPaymentMethodsService } from './services/payment-methods.service';
import { PosStoreReportsService } from './services/store-reports.service';
import { PosTerminalService } from './services/terminal.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PosDashboardController, PosTerminalController, PosStoreReportsController],
  providers: [
    PosDashboardService,
    PosTerminalService,
    PosDiscountsService,
    PosPaymentMethodsService,
    PosStoreReportsService,
  ],
})
export class PosModule {}
