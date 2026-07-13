import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { PosCommunicationsController } from './controllers/pos-communications.controller';
import { PosDashboardController } from './controllers/dashboard.controller';
import { PosStoreReportsController } from './controllers/store-reports.controller';
import { PosTerminalController } from './controllers/terminal.controller';
import { PosDashboardService } from './services/dashboard.service';
import { PosDiscountsService } from './services/discounts.service';
import { PosPaymentMethodsService } from './services/payment-methods.service';
import { PosStoreReportsService } from './services/store-reports.service';
import { PosTerminalService } from './services/terminal.service';
import { PosOrgBootstrapService } from './services/pos-org-bootstrap.service';
import { PosChatService } from './services/pos-chat.service';
import { PosNotificationsService } from './services/pos-notifications.service';

import { PosOperationsController } from './controllers/pos-operations.controller';
import { PosStaffService } from './services/pos-staff.service';
import { PosVoidService } from './services/pos-void.service';

@Module({
  imports: [DatabaseModule, SettingsModule],
  controllers: [
    PosDashboardController,
    PosTerminalController,
    PosStoreReportsController,
    PosOperationsController,
    PosCommunicationsController,
  ],
  providers: [
    PosDashboardService,
    PosTerminalService,
    PosDiscountsService,
    PosPaymentMethodsService,
    PosStoreReportsService,
    PosOrgBootstrapService,
    PosStaffService,
    PosVoidService,
    PosChatService,
    PosNotificationsService,
  ],
})
export class PosModule {}
