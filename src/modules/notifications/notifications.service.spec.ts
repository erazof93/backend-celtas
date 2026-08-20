import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { MarketingNotification } from './entities/marketing-notification.entity';
import { NotificationsService } from './notifications.service';

// Mock de firebase-admin (API modular). Se mockea antes de importar el servicio.
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(() => ({ name: 'mock-app' })),
  cert: jest.fn((cred: unknown) => cred),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({
    send: jest.fn(),
    sendEachForMulticast: jest.fn(),
  })),
}));

import { initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let usersRepo: { findOne: jest.Mock; find: jest.Mock; update: jest.Mock };
  let marketingNotificationsRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let configService: { get: jest.Mock };
  const sendMock = jest.fn();
  const multicastMock = jest.fn();

  const makeUser = (overrides: Partial<User> = {}) =>
    ({
      id: 'user-1',
      email: 'cliente@example.com',
      fcmToken: null,
      ...overrides,
    }) as User;

  beforeEach(async () => {
    usersRepo = { findOne: jest.fn(), find: jest.fn(), update: jest.fn() };
    marketingNotificationsRepo = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn((data: unknown) => Promise.resolve(data)),
      find: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'firebase.projectId') return 'proyecto-test';
        if (key === 'firebase.clientEmail')
          return 'admin@test.iam.gserviceaccount.com';
        if (key === 'firebase.privateKey')
          return '-----BEGIN KEY-----\\nlinea1\\nlinea2\\n-----END KEY-----';
        return undefined;
      }),
    };

    // Reset de los mocks de envío y de la app (para que getApp reinicialice).
    sendMock.mockReset();
    multicastMock.mockReset();
    (getMessaging as jest.Mock).mockReturnValue({
      send: sendMock,
      sendEachForMulticast: multicastMock,
    });
    (initializeApp as jest.Mock).mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        {
          provide: getRepositoryToken(MarketingNotification),
          useValue: marketingNotificationsRepo,
        },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('sendPushNotification', () => {
    it('no hace nada (false) si el usuario no tiene fcmToken', async () => {
      usersRepo.findOne.mockResolvedValue(makeUser());

      const result = await service.sendPushNotification('user-1', {
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('no hace nada (false) si el usuario no existe', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      const result = await service.sendPushNotification('user-1', {
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('envía y devuelve true si el usuario tiene token', async () => {
      usersRepo.findOne.mockResolvedValue(makeUser({ fcmToken: 'token-ok' }));
      sendMock.mockResolvedValue('message-id');

      const result = await service.sendPushNotification('user-1', {
        title: 'Hola',
        body: 'Mundo',
        data: { orderId: '123' },
      });

      expect(result).toBe(true);
      expect(sendMock).toHaveBeenCalledWith({
        token: 'token-ok',
        notification: { title: 'Hola', body: 'Mundo' },
        data: { orderId: '123' },
      });
    });

    it('NO lanza si el envío falla: loguea y devuelve false', async () => {
      usersRepo.findOne.mockResolvedValue(makeUser({ fcmToken: 'token-roto' }));
      sendMock.mockRejectedValue(new Error('token inválido'));

      // No debe lanzar hacia el caller.
      const result = await service.sendPushNotification('user-1', {
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toBe(false);
    });

    it('un error transitorio (no UNREGISTERED) NO limpia el fcmToken', async () => {
      usersRepo.findOne.mockResolvedValue(makeUser({ fcmToken: 'token-roto' }));
      sendMock.mockRejectedValue(new Error('fallo de red'));

      await service.sendPushNotification('user-1', {
        title: 'Hola',
        body: 'Mundo',
      });

      expect(usersRepo.update).not.toHaveBeenCalled();
    });

    it('si Firebase devuelve UNREGISTERED, limpia el fcmToken del usuario (token muerto, no reintentable)', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({ id: 'user-1', fcmToken: 'token-fantasma' }),
      );
      sendMock.mockRejectedValue(
        Object.assign(new Error('NotRegistered'), {
          code: 'messaging/registration-token-not-registered',
        }),
      );

      const result = await service.sendPushNotification('user-1', {
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toBe(false);
      expect(usersRepo.update).toHaveBeenCalledWith('user-1', {
        fcmToken: null,
      });
    });

    it('reemplaza los \\n literales de la clave privada por saltos de línea reales', async () => {
      usersRepo.findOne.mockResolvedValue(makeUser({ fcmToken: 'token-ok' }));
      sendMock.mockResolvedValue('message-id');

      await service.sendPushNotification('user-1', {
        title: 'Hola',
        body: 'Mundo',
      });

      expect(initializeApp).toHaveBeenCalledWith({
        credential: {
          projectId: 'proyecto-test',
          clientEmail: 'admin@test.iam.gserviceaccount.com',
          privateKey: '-----BEGIN KEY-----\nlinea1\nlinea2\n-----END KEY-----',
        },
      });
    });
  });

  describe('broadcastPushNotification', () => {
    it('cuenta sent/total correctamente y un token inválido no frena a los demás', async () => {
      usersRepo.find.mockResolvedValue([
        makeUser({ id: 'u1', fcmToken: 'token-a' }),
        makeUser({ id: 'u2', fcmToken: 'token-b' }),
        makeUser({ id: 'u3', fcmToken: 'token-c' }),
      ]);
      multicastMock.mockResolvedValue({
        successCount: 2,
        failureCount: 1,
        responses: [
          { success: true },
          { success: false, error: new Error('token inválido') },
          { success: true },
        ],
      });

      const result = await service.broadcastPushNotification({
        title: 'Celtas está cerrado temporalmente',
        body: 'Motivo de prueba',
      });

      expect(result).toEqual({ sent: 2, total: 3 });
      expect(multicastMock).toHaveBeenCalledTimes(1);
      expect(multicastMock).toHaveBeenCalledWith({
        tokens: ['token-a', 'token-b', 'token-c'],
        notification: {
          title: 'Celtas está cerrado temporalmente',
          body: 'Motivo de prueba',
        },
        data: undefined,
      });
    });

    it('sin usuarios con token → { sent: 0, total: 0 } sin llamar a FCM', async () => {
      usersRepo.find.mockResolvedValue([]);

      const result = await service.broadcastPushNotification({
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toEqual({ sent: 0, total: 0 });
      expect(multicastMock).not.toHaveBeenCalled();
    });

    it('divide en lotes de máximo 500 tokens por llamada a FCM', async () => {
      const users = Array.from({ length: 750 }, (_, i) =>
        makeUser({ id: `u${i}`, fcmToken: `token-${i}` }),
      );
      usersRepo.find.mockResolvedValue(users);
      multicastMock.mockImplementation((message: { tokens: string[] }) =>
        Promise.resolve({
          successCount: message.tokens.length,
          failureCount: 0,
          responses: message.tokens.map(() => ({ success: true })),
        }),
      );

      const result = await service.broadcastPushNotification({
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toEqual({ sent: 750, total: 750 });
      expect(multicastMock).toHaveBeenCalledTimes(2);
      expect(
        (multicastMock.mock.calls[0] as [{ tokens: string[] }])[0].tokens,
      ).toHaveLength(500);
      expect(
        (multicastMock.mock.calls[1] as [{ tokens: string[] }])[0].tokens,
      ).toHaveLength(250);
    });

    it('NO lanza si un lote completo falla (ej. error de red): loguea y sigue con el resto', async () => {
      usersRepo.find.mockResolvedValue([
        makeUser({ id: 'u1', fcmToken: 'token-a' }),
        makeUser({ id: 'u2', fcmToken: 'token-b' }),
      ]);
      multicastMock.mockRejectedValue(new Error('fallo de red'));

      const result = await service.broadcastPushNotification({
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toEqual({ sent: 0, total: 2 });
    });

    it('limpia el fcmToken solo de los usuarios cuyo token devolvió UNREGISTERED, no de otros fallos', async () => {
      usersRepo.find.mockResolvedValue([
        makeUser({ id: 'u1', fcmToken: 'token-a' }),
        makeUser({ id: 'u2', fcmToken: 'token-fantasma' }),
        makeUser({ id: 'u3', fcmToken: 'token-c' }),
      ]);
      multicastMock.mockResolvedValue({
        successCount: 2,
        failureCount: 1,
        responses: [
          { success: true },
          {
            success: false,
            error: {
              code: 'messaging/registration-token-not-registered',
              message: 'NotRegistered',
            },
          },
          { success: true },
        ],
      });

      const result = await service.broadcastPushNotification({
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toEqual({ sent: 2, total: 3 });
      expect(usersRepo.update).toHaveBeenCalledTimes(1);
      expect(usersRepo.update).toHaveBeenCalledWith(['u2'], {
        fcmToken: null,
      });
    });

    it('un fallo por error transitorio (no UNREGISTERED) en el broadcast NO limpia el fcmToken', async () => {
      usersRepo.find.mockResolvedValue([
        makeUser({ id: 'u1', fcmToken: 'token-a' }),
        makeUser({ id: 'u2', fcmToken: 'token-b' }),
      ]);
      multicastMock.mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true },
          {
            success: false,
            error: { code: 'messaging/internal-error', message: 'boom' },
          },
        ],
      });

      await service.broadcastPushNotification({ title: 'Hola', body: 'Mundo' });

      expect(usersRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('sendMarketingBroadcast', () => {
    it('envía el broadcast y guarda el historial con adminId, sent y total', async () => {
      usersRepo.find.mockResolvedValue([
        makeUser({ id: 'u1', fcmToken: 'token-a' }),
        makeUser({ id: 'u2', fcmToken: 'token-b' }),
      ]);
      multicastMock.mockResolvedValue({
        successCount: 2,
        failureCount: 0,
        responses: [{ success: true }, { success: true }],
      });

      const result = await service.sendMarketingBroadcast('admin-1', {
        title: 'A pocos días del día del padre y Celtas lo sabe',
        body: 'Promos especiales',
      });

      expect(result).toEqual({ sent: 2, total: 2 });
      expect(marketingNotificationsRepo.create).toHaveBeenCalledWith({
        title: 'A pocos días del día del padre y Celtas lo sabe',
        body: 'Promos especiales',
        adminId: 'admin-1',
        sentCount: 2,
        totalCount: 2,
      });
      expect(marketingNotificationsRepo.save).toHaveBeenCalledTimes(1);
    });

    it('guarda el historial también cuando no hay usuarios con token (0/0)', async () => {
      usersRepo.find.mockResolvedValue([]);

      const result = await service.sendMarketingBroadcast('admin-1', {
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result).toEqual({ sent: 0, total: 0 });
      expect(marketingNotificationsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sentCount: 0, totalCount: 0 }),
      );
    });
  });

  describe('getBroadcastHistory', () => {
    it('devuelve el historial ordenado por fecha descendente', async () => {
      const history = [
        { id: 'm2', title: 'Segundo' },
        { id: 'm1', title: 'Primero' },
      ];
      marketingNotificationsRepo.find.mockResolvedValue(history);

      const result = await service.getBroadcastHistory();

      expect(result).toBe(history);
      expect(marketingNotificationsRepo.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
    });
  });
});
