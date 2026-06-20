import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoginModule } from './auth/login/login.module';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './usermanage/users/users.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SettingsModule } from './settings/settings.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { CustomersModule } from './customers/customers.module';
import { QuotationsModule } from './quotations/quotations.module';
import { JobOrdersModule } from './job-orders/job-orders.module';
import { InventoryModule } from './inventory/inventory.module';
import { ReportsModule } from './reports/reports.module';
import { FinanceModule } from './finance/finance.module';
import { BackupModule } from './backup/backup.module';
import { CateringModule } from './catering/catering.module';
import { SetupModule } from './setup/setup.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
    }),
    DatabaseModule,
    LoginModule,
    UsersModule,
    DashboardModule,
    SettingsModule,
    OrganizationsModule,
    CustomersModule,
    QuotationsModule,
    JobOrdersModule,
    InventoryModule,
    ReportsModule,
    FinanceModule,
    BackupModule,
    CateringModule,
    SetupModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
