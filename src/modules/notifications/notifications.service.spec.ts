import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from './notifications.service';

// Mock de firebase-admin (API modular). Se mockea antes de importar el servicio.
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(() => ({ name: 'mock-app' })),
  cert: jest.fn((cred: unknown) => cred),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ send: jest.fn() })),
}));

import { initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let usersRepo: { findOne: jest.Mock };
  let configService: { get: jest.Mock };
  const sendMock = jest.fn();

  const makeUser = (overrides: Partial<User> = {}) =>
    ({
      id: 'user-1',
      email: 'cliente@example.com',
      fcmToken: null,
      ...overrides,
    }) as User;

  beforeEach(async () => {
    usersRepo = { findOne: jest.fn() };
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

    // Reset del mock de send y de la app (para que getApp reinicialice).
    sendMock.mockReset();
    (getMessaging as jest.Mock).mockReturnValue({ send: sendMock });
    (initializeApp as jest.Mock).mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
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
});
