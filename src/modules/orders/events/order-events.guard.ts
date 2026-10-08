import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Request } from 'express';

export interface StreamRequest extends Request {
  user: { userId: string; role: string; expiresAt: number };
}

@Injectable()
export class OrderEventsGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StreamRequest>();
    if (Object.keys(request.query).length) {
      throw new BadRequestException(
        'El stream no acepta parámetros de consulta. Usa Authorization Bearer.',
      );
    }
    await super.canActivate(context);
    if (
      !Number.isFinite(request.user.expiresAt) ||
      request.user.expiresAt <= Date.now()
    ) {
      throw new UnauthorizedException('Sesión expirada');
    }
    return true;
  }
}
