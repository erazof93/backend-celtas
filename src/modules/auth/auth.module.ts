import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    // Rate limiting para POST /auth/login y POST /auth/register (5 intentos/minuto por IP).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'auth', ttl: 60_000, limit: 5 }],
      errorMessage: 'Demasiados intentos. Intenta de nuevo en un minuto.',
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>(
            'jwt.expiresIn',
          ) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleAuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
