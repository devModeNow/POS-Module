import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule, MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } })],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, JwtAuthGuard],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
