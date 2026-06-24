import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PosDashboardController } from './controllers/dashboard.controller';
import { PosTerminalController } from './controllers/terminal.controller';
import { PosDashboardService } from './services/dashboard.service';
import { PosTerminalService } from './services/terminal.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PosDashboardController, PosTerminalController],
  providers: [PosDashboardService, PosTerminalService],
})
export class PosModule {}
