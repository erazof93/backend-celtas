import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import { SendTestNotificationDto } from './dto/send-test-notification.dto';
import { NotificationsService } from './notifications.service';

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
}
