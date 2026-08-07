import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { GoogleAuthService } from './google-auth.service';

// Mock del OAuth2Client de google-auth-library: la lógica real de verifyIdToken
// (validación de payload, email_verified y manejo de errores) se testea aquí.
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let client: { verifyIdToken: jest.Mock };

  const configService = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        'google.clientId': 'client-id-123',
      };
      return map[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GoogleAuthService(configService);
    client = (OAuth2Client as unknown as jest.Mock).mock.results[0].value as {
      verifyIdToken: jest.Mock;
    };
  });

  it('devuelve el perfil si el idToken es válido y el email está verificado', async () => {
    client.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-id-123',
        email: 'cliente@example.com',
        name: 'Juan Pérez',
        email_verified: true,
      }),
    });

    const profile = await service.verifyIdToken('id-token');

    expect(client.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: 'client-id-123',
    });
    expect(profile).toEqual({
      googleId: 'google-id-123',
      email: 'cliente@example.com',
      name: 'Juan Pérez',
    });
  });

  it('rechaza con 401 si el payload no tiene sub o email', async () => {
    client.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email_verified: true }),
    });

    await expect(service.verifyIdToken('id-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza con 401 si el email no está verificado', async () => {
    client.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'user-id-123',
        email: 'cliente@example.com',
        email_verified: false,
      }),
    });

    await expect(service.verifyIdToken('id-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza con 401 si verifyIdToken lanza (token inválido/expirado)', async () => {
    client.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

    await expect(service.verifyIdToken('id-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('repropaga UnauthorizedException sin envolverla de nuevo', async () => {
    client.verifyIdToken.mockRejectedValue(
      new UnauthorizedException(
        'El email de la cuenta de Google no está verificado',
      ),
    );

    await expect(service.verifyIdToken('id-token')).rejects.toMatchObject({
      status: 401,
      message: 'El email de la cuenta de Google no está verificado',
    });
  });
});
