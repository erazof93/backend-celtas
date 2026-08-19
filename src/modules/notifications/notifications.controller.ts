import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { SendTestNotificationDto } from './dto/send-test-notification.dto';
import { NotificationsService } from './notifications.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Enviar una notificación de prueba a un usuario (admin)',
    description:
      'Útil para probar el flujo de FCM antes de tener el frontend Flutter listo. Devuelve si el envío se realizó (el usuario debe tener fcmToken guardado).',
  })
  @ApiResponse({
    status: 201,
    description: 'Notificación procesada (sent: true si se envió, false si no)',
  })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  async sendTest(@Body() dto: SendTestNotificationDto) {
    const sent = await this.notificationsService.sendPushNotification(
      dto.userId,
      { title: dto.title, body: dto.body },
    );
    return { sent };
  }

  @Post('broadcast')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Enviar una notificación de marketing/fidelización a TODOS los usuarios con token (admin)',
    description:
      'Envío manual e inmediato (sin scheduler). Ej.: "A pocos días del día del padre y Celtas lo sabe". Reutiliza el mismo envío masivo por lotes de 500 tokens que ya usa el resto del sistema, y deja registro en el historial.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Envío procesado. sent/total: cuántos dispositivos lo recibieron de cuántos tenían token.',
  })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  async broadcast(
    @Req() req: AuthenticatedRequest,
    @Body() dto: BroadcastNotificationDto,
  ) {
    return this.notificationsService.sendMarketingBroadcast(req.user.userId, {
      title: dto.title,
      body: dto.body,
    });
  }

  @Get('broadcast-history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Historial de campañas de marketing enviadas (admin)',
    description: 'Más recientes primero.',
  })
  @ApiResponse({ status: 200, description: 'Lista del historial de envíos' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  async broadcastHistory() {
    return this.notificationsService.getBroadcastHistory();
  }
}
