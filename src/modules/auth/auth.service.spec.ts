import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

// bcrypt v6 exporta propiedades no-configurables, así que se mockea el módulo completo.
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
import * as bcrypt from 'bcrypt';
const bcryptHash = bcrypt.hash as jest.Mock;
const bcryptCompare = bcrypt.compare as jest.Mock;

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let configService: { get: jest.Mock };

  const baseUser = {
    id: 'user-1',
    email: 'cliente@example.com',
    password: '$2b$10$hashed',
    fullName: 'Juan Pérez',
    provider: 'local',
    googleId: null,
    phone: null,
    totalSpent: 0,
    role: 'cliente',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  beforeEach(() => {
    bcryptHash.mockReset();
    bcryptCompare.mockReset();
    bcryptHash.mockResolvedValue('$2b$10$hashed-password');

    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      verifyAsync: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          'jwt.secret': 'access-secret',
          'jwt.refreshSecret': 'refresh-secret',
          'jwt.expiresIn': '15m',
          'jwt.refreshExpiresIn': '7d',
        };
        return map[key];
      }),
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  describe('register', () => {
    it('hashea el password con bcrypt y guarda el hash (nunca texto plano)', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation(
        (data: { email: string; password: string }) => ({
          ...baseUser,
          email: data.email,
          password: data.password,
        }),
      );

      const result = await service.register({
        email: 'cliente@example.com',
        password: 'password123',
        fullName: 'Juan Pérez',
      });

      expect(bcryptHash).toHaveBeenCalledWith('password123', 10);
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          password: '$2b$10$hashed-password',
          provider: 'local',
        }),
      );
      // El password guardado es el hash, nunca el texto plano.
      expect(result.user.password).toBe('$2b$10$hashed-password');
      expect(result.user.password).not.toBe('password123');
    });

    it('rechaza con 409 si el email ya está registrado', async () => {
      usersService.findByEmail.mockResolvedValue(baseUser);
      await expect(
        service.register({
          email: 'cliente@example.com',
          password: 'password123',
          fullName: 'Juan Pérez',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('devuelve accessToken, refreshToken y el usuario', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(baseUser);
      const result = await service.register({
        email: 'cliente@example.com',
        password: 'password123',
        fullName: 'Juan Pérez',
      });
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(result.user).toBe(baseUser);
    });
  });

  describe('login', () => {
    it('falla con 401 si el email no existe', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(
        service.login({ email: 'no-existe@example.com', password: 'x' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(bcryptCompare).not.toHaveBeenCalled();
    });

    it('falla con 401 si el usuario no tiene password (cuenta sin password)', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...baseUser,
        provider: 'local',
        password: null,
      });
      await expect(
        service.login({ email: 'cliente@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(bcryptCompare).not.toHaveBeenCalled();
    });

    it('falla con 401 y mensaje claro si el usuario es provider=google', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...baseUser,
        provider: 'google',
        password: null,
      });
      await expect(
        service.login({ email: 'google@example.com', password: 'x' }),
      ).rejects.toMatchObject({
        status: 401,
        message:
          'Esta cuenta usa Google. Inicia sesión con el botón de Google.',
      });
    });

    it('falla con 401 si el password no coincide', async () => {
      usersService.findByEmail.mockResolvedValue(baseUser);
      bcryptCompare.mockResolvedValue(false);
      await expect(
        service.login({ email: 'cliente@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('devuelve tokens si el password coincide', async () => {
      usersService.findByEmail.mockResolvedValue(baseUser);
      bcryptCompare.mockResolvedValue(true);
      const result = await service.login({
        email: 'cliente@example.com',
        password: 'password123',
      });
      expect(bcryptCompare).toHaveBeenCalledWith(
        'password123',
        '$2b$10$hashed',
      );
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
    });
  });

  describe('refresh', () => {
    it('verifica el refresh token con el refresh secret y emite nuevos tokens', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      usersService.findById.mockResolvedValue(baseUser);
      const result = await service.refresh({ refreshToken: 'valid-refresh' });
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-refresh', {
        secret: 'refresh-secret',
      });
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
    });

    it('rechaza con 401 un refresh token inválido o expirado', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));
      await expect(
        service.refresh({ refreshToken: 'bad-refresh' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza con 401 si el usuario del token ya no existe', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'no-existe' });
      usersService.findById.mockResolvedValue(null);
      await expect(
        service.refresh({ refreshToken: 'valid-refresh' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
