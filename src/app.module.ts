import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { BannersModule } from './modules/banners/banners.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { MenuModule } from './modules/menu/menu.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
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
        // SSL: Supabase lo exige desde fuera de su red, el Postgres local de Docker no.
        // Por defecto: SSL solo cuando NODE_ENV=production. DB_SSL=true/false lo fuerza
        // (ej. DB_SSL=false para probar el build de producción contra un Postgres local).
        // Se usa { rejectUnauthorized: false } porque Supabase usa certificados auto-firmados.
        ssl: (
          process.env.DB_SSL !== undefined
            ? process.env.DB_SSL === 'true'
            : configService.get<string>('nodeEnv') === 'production'
        )
          ? { rejectUnauthorized: false }
          : false,
      }),
    }),
    UsersModule,
    AuthModule,
    MenuModule,
    OrdersModule,
    CouponsModule,
    BannersModule,
    NotificationsModule,
    AdminModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
