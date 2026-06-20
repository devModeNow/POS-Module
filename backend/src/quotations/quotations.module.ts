import { Module } from '@nestjs/common';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, JwtAuthGuard],
  exports: [QuotationsService],
})
export class QuotationsModule {}
