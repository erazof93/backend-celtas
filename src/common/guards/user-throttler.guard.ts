import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limit por usuario autenticado en vez de por IP. Debe ejecutarse DESPUÉS de
 * JwtAuthGuard (que deja el usuario en req.user): `@UseGuards(JwtAuthGuard, UserThrottlerGuard)`.
 *
 * Por qué no por IP: en datos móviles peruanos muchos clientes salen por la misma IP
 * pública (CGNAT), y un límite por IP castigaría a usuarios que no hicieron nada. Sin
 * req.user (guard mal ordenado) cae a la IP, igual que ThrottlerGuard.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const userId = (req.user as { userId?: string } | undefined)?.userId;
    return Promise.resolve(userId ? `user:${userId}` : (req.ip as string));
  }
}
