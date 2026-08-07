import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
}

/**
 * Verificación del idToken de Google con google-auth-library.
 * No confía ciegamente en el payload: `verifyIdToken` valida la firma, la audiencia
 * (GOOGLE_CLIENT_ID) y la expiración contra Google, y además exigimos email verificado.
 */
@Injectable()
export class GoogleAuthService {
  private readonly client: OAuth2Client;
  private readonly clientId: string;

  constructor(configService: ConfigService) {
    this.clientId = configService.get<string>('google.clientId') as string;
    this.client = new OAuth2Client(this.clientId);
  }

  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        throw new UnauthorizedException('Token de Google inválido');
      }
      if (payload.email_verified !== true) {
        throw new UnauthorizedException(
          'El email de la cuenta de Google no está verificado',
        );
      }

      return {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name ?? '',
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token de Google inválido o expirado');
    }
  }
}
