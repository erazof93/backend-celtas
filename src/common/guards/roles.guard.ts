import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../modules/users/entities/user.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Guard de autorización por rol. Debe ejecutarse DESPUÉS de JwtAuthGuard
 * (que deja el usuario en req.user).
 *
 * Sin roles declarados deja pasar (no restringe); con roles, devuelve 403
 * si el rol del usuario autenticado no coincide con ninguno requerido.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    const user = request.user;
    if (!user || !requiredRoles.some((role) => user.role === role)) {
      throw new ForbiddenException(
        'No tienes permisos para acceder a este recurso',
      );
    }

    return true;
  }
}
