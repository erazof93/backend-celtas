import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard de autenticación JWT. Se usa en endpoints protegidos:
 *   @UseGuards(JwtAuthGuard)
 * Devuelve 401 si el access token falta, está expirado o es inválido.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
