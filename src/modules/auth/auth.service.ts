import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User, UserProvider } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleAuthService } from './google-auth.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly googleAuthService: GoogleAuthService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens & { user: User }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({
      email: dto.email,
      password: passwordHash,
      fullName: dto.fullName,
      provider: 'local',
      phone: dto.phone ?? null,
    });

    const tokens = await this.generateTokens(user);
    return { ...tokens, user };
  }

  async login(dto: LoginDto): Promise<AuthTokens & { user: User }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Rechazo explícito para cuentas creadas con Google.
    if (user.provider === UserProvider.GOOGLE) {
      throw new UnauthorizedException(
        'Esta cuenta usa Google. Inicia sesión con el botón de Google.',
      );
    }

    if (!user.password) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const tokens = await this.generateTokens(user);
    return { ...tokens, user };
  }

  /**
   * Login/registro con Google. Verifica el idToken contra Google y:
   *  - si ya existe un usuario con ese googleId → login directo;
   *  - si el email ya existe como cuenta local → rechaza (no fusiona cuentas);
   *  - si no existe → crea el usuario con provider 'google' y password null.
   */
  async googleLogin(dto: GoogleAuthDto): Promise<AuthTokens & { user: User }> {
    const profile = await this.googleAuthService.verifyIdToken(dto.idToken);

    // 1. Login directo si ya existe por googleId.
    let user = await this.usersService.findByGoogleId(profile.googleId);
    if (user) {
      const tokens = await this.generateTokens(user);
      return { ...tokens, user };
    }

    // 2. Si el email ya existe, no fusionamos cuentas automáticamente.
    const existingByEmail = await this.usersService.findByEmail(profile.email);
    if (existingByEmail) {
      if (existingByEmail.provider === UserProvider.LOCAL) {
        throw new ConflictException(
          'Este correo ya está registrado con contraseña. Inicia sesión tradicional o usa "olvidé mi contraseña".',
        );
      }
      // Cuenta Google con el mismo email pero distinto googleId (caso inesperado).
      throw new ConflictException(
        'Este correo ya está asociado a otra cuenta de Google.',
      );
    }

    // 3. Crear usuario nuevo con provider 'google' y password null.
    user = await this.usersService.create({
      email: profile.email,
      password: null,
      fullName: profile.name,
      provider: 'google',
      googleId: profile.googleId,
    });

    const tokens = await this.generateTokens(user);
    return { ...tokens, user };
  }

  async refresh(dto: RefreshDto): Promise<AuthTokens & { user: User }> {
    let payload: { sub: string };

    try {
      payload = await this.jwtService.verifyAsync<{ sub: string }>(
        dto.refreshToken,
        {
          secret: this.configService.get<string>('jwt.refreshSecret'),
        },
      );
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    const tokens = await this.generateTokens(user);
    return { ...tokens, user };
  }

  /**
   * Devuelve el usuario real desde la BD (no el payload del JWT). La lógica vive en
   * UsersService.getProfile (lo comparten GET /auth/me y GET /users/me).
   */
  getProfile(userId: string): Promise<User> {
    return this.usersService.getProfile(userId);
  }

  private async generateTokens(user: User): Promise<AuthTokens> {
    const accessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.configService.get<string>('jwt.secret'),
      expiresIn: this.configService.get<string>(
        'jwt.expiresIn',
      ) as JwtSignOptions['expiresIn'],
    });

    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>(
          'jwt.refreshExpiresIn',
        ) as JwtSignOptions['expiresIn'],
      },
    );

    return { accessToken, refreshToken };
  }
}
