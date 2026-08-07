import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';

describe('AuthService.googleLogin', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    findByGoogleId: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let configService: { get: jest.Mock };
  let googleAuthService: { verifyIdToken: jest.Mock };

  const baseUser = {
    id: 'user-1',
    email: 'cliente@example.com',
    password: null,
    fullName: 'Juan Pérez',
    provider: 'google',
    googleId: 'google-id-123',
    phone: null,
    totalSpent: 0,
    role: 'cliente',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      findByGoogleId: jest.fn(),
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
    googleAuthService = {
      verifyIdToken: jest.fn().mockResolvedValue({
        googleId: 'google-id-123',
        email: 'cliente@example.com',
        name: 'Juan Pérez',
      }),
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      googleAuthService as unknown as GoogleAuthService,
    );
  });

  it('crea un usuario nuevo con provider google y password null si no existe', async () => {
    usersService.findByGoogleId.mockResolvedValue(null);
    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue(baseUser);

    const result = await service.googleLogin({ idToken: 'id-token' });

    expect(googleAuthService.verifyIdToken).toHaveBeenCalledWith('id-token');
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'cliente@example.com',
        password: null,
        provider: 'google',
        googleId: 'google-id-123',
      }),
    );
    expect(result.accessToken).toBe('signed-token');
    expect(result.refreshToken).toBe('signed-token');
  });

  it('hace login directo si ya existe un usuario con ese googleId (no duplica)', async () => {
    usersService.findByGoogleId.mockResolvedValue(baseUser);

    const result = await service.googleLogin({ idToken: 'id-token' });

    expect(usersService.create).not.toHaveBeenCalled();
    expect(result.user).toBe(baseUser);
  });

  it('rechaza con 409 si el email ya existe como cuenta local (no fusiona cuentas)', async () => {
    usersService.findByGoogleId.mockResolvedValue(null);
    usersService.findByEmail.mockResolvedValue({
      ...baseUser,
      provider: 'local',
      password: '$2b$10$hash',
    });

    await expect(
      service.googleLogin({ idToken: 'id-token' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si el email ya está asociado a otra cuenta de Google', async () => {
    usersService.findByGoogleId.mockResolvedValue(null);
    usersService.findByEmail.mockResolvedValue({
      ...baseUser,
      googleId: 'otro-google-id',
    });

    await expect(
      service.googleLogin({ idToken: 'id-token' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('propaga UnauthorizedException si la verificación del idToken falla', async () => {
    googleAuthService.verifyIdToken.mockRejectedValue(
      new UnauthorizedException('Token de Google inválido o expirado'),
    );

    await expect(
      service.googleLogin({ idToken: 'token-malo' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.create).not.toHaveBeenCalled();
  });
});
