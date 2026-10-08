import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  exp?: number;
}

/**
 * Valida el access token (firmado con JWT_SECRET) y adjunta el usuario
 * al request (req.user) para los endpoints protegidos con JwtAuthGuard.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') as string,
    });
  }

  async validate(payload: JwtPayload): Promise<{
    userId: string;
    email: string;
    role: string;
    expiresAt?: number;
  }> {
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new UnauthorizedException('Token inválido');
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Usuario no encontrado');
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      ...(typeof payload.exp === 'number'
        ? { expiresAt: payload.exp * 1000 }
        : {}),
    };
  }
}
