import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { Server } from 'node:http';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddressesService } from './addresses.service';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** HTTP + service integration with an in-memory repository, not PostgreSQL. */
describe('FCM logout HTTP contract', () => {
  let app: INestApplication;
  let users: Map<string, User>;
  let update: jest.Mock;

  beforeEach(async () => {
    users = new Map([
      ['a', { id: 'a', fcmToken: 'old' } as User],
      ['b', { id: 'b', fcmToken: 'other' } as User],
    ]);
    update = jest.fn(
      (
        criteria: string | { id: string; fcmToken: string },
        patch: Partial<User>,
      ) => {
        const user = users.get(
          typeof criteria === 'string' ? criteria : criteria.id,
        );
        if (
          user &&
          (typeof criteria === 'string' || user.fcmToken === criteria.fcmToken)
        ) {
          Object.assign(user, patch);
        }
        return Promise.resolve({ affected: 1 });
      },
    );
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: AddressesService, useValue: {} },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: ({ where }: { where: { id: string } }) =>
              Promise.resolve(users.get(where.id)),
            update,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { user: { userId: string } };
          };
        }) => {
          context.switchToHttp().getRequest().user = { userId: 'a' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('preserves bodyless legacy logout and envelope', async () => {
    const response = await request(app.getHttpServer() as Server)
      .delete('/users/me/fcm-token')
      .expect(200);
    expect(response.body).toEqual({
      success: true,
      data: { id: 'a', fcmToken: null },
    });
  });

  it('clears matching token and remains idempotent', async () => {
    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer() as Server)
        .delete('/users/me/fcm-token')
        .send({ fcmToken: 'old' })
        .expect(200);
    }
    expect(users.get('a')?.fcmToken).toBeNull();
    expect(update).toHaveBeenCalledWith(
      { id: 'a', fcmToken: 'old' },
      { fcmToken: null },
    );
  });

  it('does not clear another token or another user', async () => {
    await request(app.getHttpServer() as Server)
      .delete('/users/me/fcm-token')
      .send({ fcmToken: 'other' })
      .expect(200);
    expect(users.get('a')?.fcmToken).toBe('old');
    expect(users.get('b')?.fcmToken).toBe('other');
  });

  it('accepts a stored null token', async () => {
    users.get('a')!.fcmToken = null;
    await request(app.getHttpServer() as Server)
      .delete('/users/me/fcm-token')
      .send({ fcmToken: 'old' })
      .expect(200);
    expect(users.get('a')?.fcmToken).toBeNull();
  });

  it('a token updated after the initial read survives a late DELETE', async () => {
    const applyUpdate = update.getMockImplementation()! as (
      criteria: unknown,
      patch: unknown,
    ) => Promise<{ affected: number }>;
    update.mockImplementationOnce((criteria: unknown, patch: unknown) => {
      users.get('a')!.fcmToken = 'new';
      return applyUpdate(criteria, patch);
    });
    const response = await request(app.getHttpServer() as Server)
      .delete('/users/me/fcm-token')
      .send({ fcmToken: 'old' })
      .expect(200);
    expect(response.body as unknown).toEqual({
      success: true,
      data: { id: 'a', fcmToken: 'new' },
    });
  });

  it.each([
    {},
    [],
    { fcmToken: '' },
    { fcmToken: '   ' },
    { fcmToken: null },
    { fcmToken: 12 },
    { fcmToken: [] },
    { userId: 'b' },
  ])('rejects invalid body %j without writing', async (body) => {
    await request(app.getHttpServer() as Server)
      .delete('/users/me/fcm-token')
      .send(body)
      .expect(400);
    expect(update).not.toHaveBeenCalled();
  });
});
