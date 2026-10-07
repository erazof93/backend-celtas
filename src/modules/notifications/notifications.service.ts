import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { App, cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { IsNull, Not, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { MarketingNotification } from './entities/marketing-notification.entity';

/** Límite de tokens por llamada a `sendEachForMulticast` (restricción de FCM). */
const MULTICAST_BATCH_SIZE = 500;

/**
 * Código que devuelve Firebase cuando un token ya no es válido para ningún envío futuro
 * (app desinstalada, o el registro local del dispositivo quedó huérfano — ver caso real
 * documentado en el proyecto: restauración de Android Auto Backup sobre datos viejos de
 * Firebase Installations). No es un error transitorio (red, backend caído): reintentar
 * contra el mismo token nunca va a funcionar, así que se limpia de la BD.
 */
const FCM_TOKEN_NOT_REGISTERED_CODE =
  'messaging/registration-token-not-registered';

/** Payload de una notificación push. `data` son pares clave/valor (valores string). */
export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  link?: string;
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
    @InjectRepository(MarketingNotification)
    private readonly marketingNotificationsRepository: Repository<MarketingNotification>,
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
    let failedToken: string | null = null;
    try {
      const user = await this.usersRepository.findOne({
        where: { id: userId },
      });
      failedToken = user?.fcmToken ?? null;
      if (!failedToken) {
        // Sin token: el usuario no tiene notificaciones habilitadas. No es un error.
        return false;
      }

      await getMessaging(this.getApp()).send({
        token: failedToken,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
      });
      return true;
    } catch (err) {
      // Token inválido/expirado, error de red, etc. Nunca romper el flujo del caller.
      this.logDeliveryError(
        `No se pudo enviar la notificación push al usuario ${userId}`,
        err,
      );
      // `UNREGISTERED` es definitivo (ver constante arriba): se limpia el token para no
      // reintentar contra algo que Firebase ya descartó. Cualquier otro error (red,
      // backend caído, etc.) se deja como está — puede ser transitorio.
      if (
        failedToken &&
        (err as { code?: string })?.code === FCM_TOKEN_NOT_REGISTERED_CODE
      ) {
        // Try/catch propio: esta limpieza es "best effort". Si la escritura a la BD
        // falla (timeout, pool agotado), NO puede propagarse — rompería el contrato
        // "nunca lanza" de este método para callers que no esperan un try/catch propio
        // (ej. SettingsService.notifyBusinessHoursChange). Un token que no se pudo
        // limpiar ahora se vuelve a intentar limpiar en el próximo envío fallido.
        try {
          await this.usersRepository.update(
            { id: userId, fcmToken: failedToken },
            { fcmToken: null },
          );
        } catch (cleanupErr) {
          this.logDeliveryError(
            `No se pudo limpiar el fcmToken del usuario ${userId} tras UNREGISTERED`,
            cleanupErr,
          );
        }
      }
      return false;
    }
  }

  /**
   * Envía la misma notificación a TODOS los usuarios con `fcmToken`. Mismo
   * contrato que `sendPushNotification`: NUNCA lanza hacia el caller. Un token
   * inválido/expirado individual se loguea y no frena el resto del envío.
   * FCM limita `sendEachForMulticast` a 500 tokens por llamada, así que se
   * divide en lotes. Devuelve cuántos se mandaron de verdad vs. el total de
   * usuarios con token.
   */
  async broadcastPushNotification(
    payload: PushNotificationPayload,
  ): Promise<{ sent: number; total: number }> {
    let sent = 0;
    let total = 0;
    try {
      const users = await this.usersRepository.find({
        where: { fcmToken: Not(IsNull()) },
        select: { id: true, fcmToken: true },
      });
      // Se mantiene el par (userId, token) unido desde el arranque: así, si un token falla
      // con UNREGISTERED más abajo, sabemos exactamente a qué usuario limpiarle el campo
      // sin depender de que los índices de dos arrays separados sigan alineados.
      const entries = users
        .filter((user): user is User & { fcmToken: string } => !!user.fcmToken)
        .map((user) => ({ userId: user.id, token: user.fcmToken }));
      total = entries.length;

      if (entries.length === 0) {
        return { sent: 0, total: 0 };
      }

      const data: Record<string, string> = { ...payload.data };
      if (payload.link) {
        data.link = payload.link;
      }

      const staleTokens: { id: string; fcmToken: string }[] = [];
      for (let i = 0; i < entries.length; i += MULTICAST_BATCH_SIZE) {
        const batch = entries.slice(i, i + MULTICAST_BATCH_SIZE);
        try {
          const response = await getMessaging(
            this.getApp(),
          ).sendEachForMulticast({
            tokens: batch.map((entry) => entry.token),
            notification: { title: payload.title, body: payload.body },
            data: Object.keys(data).length > 0 ? data : undefined,
          });
          sent += response.successCount;
          response.responses.forEach((result, index) => {
            if (!result.success) {
              this.logDeliveryError(
                `No se pudo enviar la notificación push al usuario ${batch[index].userId}`,
                result.error,
              );
              // Mismo criterio que en `sendPushNotification`: UNREGISTERED es definitivo,
              // se limpia; cualquier otro error se deja (puede ser transitorio).
              if (result.error?.code === FCM_TOKEN_NOT_REGISTERED_CODE) {
                staleTokens.push({
                  id: batch[index].userId,
                  fcmToken: batch[index].token,
                });
              }
            }
          });
        } catch (err) {
          // Fallo del lote completo (ej. error de red): no frena los siguientes lotes.
          this.logDeliveryError(
            'Fallo el envío masivo de notificaciones push (lote completo)',
            err,
          );
        }
      }

      if (staleTokens.length > 0) {
        // Mismo criterio que en `sendPushNotification`: best effort, nunca puede propagar
        // (ej. `SettingsService.notifyBusinessHoursChange` llama a este método sin try/catch
        // propio, confiando en que nunca lanza).
        try {
          await this.usersRepository.update(staleTokens, { fcmToken: null });
        } catch (cleanupErr) {
          this.logDeliveryError(
            'No se pudieron limpiar los fcmToken de usuarios con token UNREGISTERED',
            cleanupErr,
          );
        }
      }

      return { sent, total: entries.length };
    } catch (err) {
      this.logDeliveryError(
        'No se pudo preparar el envío masivo de notificaciones push',
        err,
      );
      return { sent, total };
    }
  }

  /** Provider messages/stacks can contain tokens; log only a bounded FCM code. */
  private logDeliveryError(message: string, error: unknown): void {
    const code = (error as { code?: unknown } | null)?.code;
    const detail =
      typeof code === 'string' && /^messaging\/[a-z-]{1,80}$/.test(code)
        ? code
        : 'notification_delivery_failed';
    this.logger.error(`${message} (${detail})`);
  }

  /**
   * Notificación de marketing/fidelización: envía a TODOS los usuarios con
   * token (vía `broadcastPushNotification`) y deja registro en el historial
   * (`MarketingNotification`) con quién la mandó y el resultado (sent/total).
   */
  async sendMarketingBroadcast(
    adminId: string,
    payload: PushNotificationPayload,
  ): Promise<{ sent: number; total: number }> {
    const { sent, total } = await this.broadcastPushNotification(payload);

    await this.marketingNotificationsRepository.save(
      this.marketingNotificationsRepository.create({
        title: payload.title,
        body: payload.body,
        link: payload.link ?? null,
        adminId,
        sentCount: sent,
        totalCount: total,
      }),
    );

    return { sent, total };
  }

  /** Historial de campañas de marketing, más recientes primero. */
  async getBroadcastHistory(): Promise<MarketingNotification[]> {
    return this.marketingNotificationsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }
}
