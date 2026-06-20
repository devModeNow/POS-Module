import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SchedulingController } from './controllers/scheduling.controller';
import { FeedbackController } from './controllers/feedback.controller';
import { DashboardController } from './controllers/dashboard.controller';
import { MenuController } from './controllers/menu.controller';
import { SchedulingService } from './services/scheduling.service';
import { FeedbackService } from './services/feedback.service';
import { DashboardService } from './services/dashboard.service';
import { MenuService } from './services/menu.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    SchedulingController,
    FeedbackController,
    DashboardController,
    MenuController,
  ],
  providers: [
    SchedulingService,
    FeedbackService,
    DashboardService,
    MenuService,
  ],
})
export class CateringModule {}
