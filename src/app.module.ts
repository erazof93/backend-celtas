import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { postgresTls } from './config/postgres-tls';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { BannersModule } from './modules/banners/banners.module';
import { BeveragesModule } from './modules/beverages/beverages.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { ExtraPortionsModule } from './modules/extra-portions/extra-portions.module';
import { MenuModule } from './modules/menu/menu.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { FriesTypesModule } from './modules/fries-types/fries-types.module';
import { SaucesModule } from './modules/sauces/sauces.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.database'),
        autoLoadEntities: true,
        // `synchronize` está SIEMPRE apagado, incluso en desarrollo. El schema se gestiona
        // solo por migraciones (ver "Flujo de migraciones" en la skill nestjs-celtas).
        // Reactivarlo rompe la detección de diffs de `migration:generate`.
        synchronize: false,
        ssl: postgresTls(),
      }),
    }),
    UsersModule,
    AuthModule,
    MenuModule,
    SaucesModule,
    FriesTypesModule,
    BeveragesModule,
    ExtraPortionsModule,
    OrdersModule,
    CouponsModule,
    BannersModule,
    NotificationsModule,
    AdminModule,
    ReportsModule,
    SettingsModule,
    RewardsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
