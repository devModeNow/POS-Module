import { Module } from '@nestjs/common';
import { JobOrdersController } from './job-orders.controller';
import { JobOrdersService } from './job-orders.service';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [JobOrdersController],
  providers: [JobOrdersService, JwtAuthGuard],
  exports: [JobOrdersService],
})
export class JobOrdersModule {}
