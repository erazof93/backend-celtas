import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { App, cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';

/** Payload de una notificación push. `data` son pares clave/valor (valores string). */
export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Módulo Notifications (Firebase Cloud Messaging).
 *
 * CONTRATO CRÍTICO: `sendPushNotification` NUNCA lanza una excepción hacia quien
 * lo llama. Si el usuario no tiene `fcmToken`, no hace nada (no es un error: el
 * usuario simplemente no tiene notificaciones habilitadas). Si el envío falla
 * (token inválido/expirado, error de red, etc.), loguea el error y retorna.
 *
 * Por eso, los módulos que disparan notificaciones (Coupons, Orders, Banners)
 * NO deben envolver la llamada en un try/catch defensivo por su cuenta: el método
 * ya garantiza que no rompe el flujo del caller. Solo deben llamarlo y seguir.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private app: App | null = null;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Inicializa firebase-admin de forma perezosa (solo la primera vez que se envía).
   * La clave privada del .env trae `\n` literales; se reemplazan por saltos de
   * línea reales antes de pasarla al SDK.
   */
  private getApp(): App {
    if (!this.app) {
      const projectId = this.configService.get<string>('firebase.projectId');
      const clientEmail = this.configService.get<string>(
        'firebase.clientEmail',
      );
      // La validación de env (Joi) garantiza que la clave existe; el `?? ''` es
      // solo una red de seguridad para el tipo de TS.
      const privateKey = (
        this.configService.get<string>('firebase.privateKey') ?? ''
      ).replace(/\\n/g, '\n');
      this.app = initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
    }
    return this.app;
  }

  /**
   * Envía una notificación push al usuario. Devuelve `true` si se envió, `false`
   * si el usuario no tiene token o el envío falló. NUNCA lanza (ver contrato arriba).
   */
  async sendPushNotification(
    userId: string,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user?.fcmToken) {
      // Sin token: el usuario no tiene notificaciones habilitadas. No es un error.
      return false;
    }

    try {
      await getMessaging(this.getApp()).send({
        token: user.fcmToken,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
      });
      return true;
    } catch (err) {
      // Token inválido/expirado, error de red, etc. Nunca romper el flujo del caller.
      this.logger.error(
        `No se pudo enviar la notificación push al usuario ${userId}`,
        err as Error,
      );
      return false;
    }
  }
}
