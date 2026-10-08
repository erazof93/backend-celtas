import {
  ConflictException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import request from 'supertest';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddressesService } from './addresses.service';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Real service/controller; serialized transactional repository double, NOT PostgreSQL. */
describe('Persistent FCM generation protocol', () => {
  let app: INestApplication;
  let service: UsersService;
  let users: Map<string, User>;
  let generations: Map<string, Date | null>;
  let beforeUpdate: (() => Promise<void>) | undefined;
  let lockedReads: number;

  beforeEach(async () => {
    users = new Map(
      ['a', 'b'].map((id) => [
        id,
        { id, fcmToken: null, fcmGeneration: null } as User,
      ]),
    );
    generations = new Map();
    beforeUpdate = undefined;
    lockedReads = 0;
    const repository = {
      findOne: jest.fn(
        ({
          where,
          lock,
        }: {
          where: { id: string };
          lock?: { mode: string };
        }) => {
          if (lock?.mode === 'pessimistic_write') lockedReads++;
          return Promise.resolve({
            ...users.get(where.id)!,
          });
        },
      ),
      update: jest.fn(
        async (criteria: string | Partial<User>, patch: Partial<User>) => {
          if (beforeUpdate) await beforeUpdate();
          const user = users.get(
            typeof criteria === 'string' ? criteria : criteria.id!,
          )!;
          if (
            typeof criteria === 'string' ||
            Object.entries(criteria).every(([key, value]) =>
              value instanceof FindOperator && value.type === 'isNull'
                ? user[key as keyof User] === null
                : user[key as keyof User] === value,
            )
          )
            Object.assign(user, patch);
          return { affected: 1 };
        },
      ),
      manager: {} as unknown,
    };
    let queue = Promise.resolve();
    repository.manager = {
      transaction: (callback: (manager: unknown) => Promise<unknown>) => {
        const run = queue.then(async () => {
          const oldUsers = new Map(
            [...users].map(([key, user]) => [key, { ...user }]),
          );
          const oldGenerations = new Map(generations);
          try {
            return await callback({
              getRepository: () => repository,
              query: (sql: string, [userId, generation]: string[]) => {
                const key = `${userId}:${generation}`;
                if (sql.startsWith('INSERT')) {
                  if (!generations.has(key)) generations.set(key, null);
                  return [];
                }
                if (sql.startsWith('UPDATE')) {
                  generations.set(key, generations.get(key) ?? new Date());
                  return [];
                }
                return [{ revokedAt: generations.get(key) }];
              },
            });
          } catch (error) {
            users = oldUsers;
            generations = oldGenerations;
            throw error;
          }
        });
        queue = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    };
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: AddressesService, useValue: {} },
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => {
              user: unknown;
              headers: Record<string, string>;
            };
          };
        }) => {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: req.headers['x-test-user'] ?? 'a' };
          return true;
        },
      })
      .compile();
    service = module.get(UsersService);
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

  it('revocation before creation rejects first PATCH and every retry', async () => {
    await service.clearFcmToken('a', undefined, first);
    for (let i = 0; i < 2; i++)
      await expect(
        service.updateFcmToken('a', 'old', first),
      ).rejects.toBeInstanceOf(ConflictException);
    expect(users.get('a')!.fcmToken).toBeNull();
    expect(generations.get(`a:${first}`)).toBeInstanceOf(Date);
    expect(lockedReads).toBe(3);
  });
  it('PATCH holding the transaction lock completes before concurrent DELETE clears it', async () => {
    const entered = deferred();
    const finish = deferred();
    beforeUpdate = async () => {
      entered.resolve();
      await finish.promise;
    };
    const patch = service.updateFcmToken('a', 'old', first);
    await entered.promise;
    const remove = service.clearFcmToken('a', undefined, first);
    finish.resolve();
    await Promise.all([patch, remove]);
    expect(users.get('a')!.fcmToken).toBeNull();
    await expect(
      service.updateFcmToken('a', 'old', first),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('DELETE obtains the lock first: concurrent PATCH is rejected', async () => {
    const remove = service.clearFcmToken('a', undefined, first);
    const patch = service.updateFcmToken('a', 'old', first);
    await remove;
    await expect(patch).rejects.toBeInstanceOf(ConflictException);
  });
  it('new login survives repeated old DELETE even with identical Firebase token', async () => {
    await service.updateFcmToken('a', 'same', first);
    await service.clearFcmToken('a', undefined, first);
    await service.updateFcmToken('a', 'same', second);
    await service.clearFcmToken('a', 'same', first);
    expect(users.get('a')!.fcmGeneration).toBe(second);
    expect(users.get('a')!.fcmToken).toBe('same');
  });
  it('isolates revocations between identities', async () => {
    await service.clearFcmToken('a', undefined, first);
    await service.updateFcmToken('b', 'b-token', first);
    expect(users.get('b')!.fcmToken).toBe('b-token');
  });

  it('legacy PATCH detaches ownership so an old generation DELETE cannot clear its token', async () => {
    await service.updateFcmToken('a', 'enhanced', first);
    await service.updateFcmToken('a', 'legacy');
    await service.clearFcmToken('a', undefined, first);
    expect(users.get('a')!.fcmToken).toBe('legacy');
    expect(users.get('a')!.fcmGeneration).toBeNull();
  });

  it('clears pre-migration ownership only for the exact supplied token', async () => {
    await service.updateFcmToken('a', 'legacy');
    await service.clearFcmToken('a', 'different', first);
    expect(users.get('a')!.fcmToken).toBe('legacy');
    await service.clearFcmToken('a', 'legacy', first);
    expect(users.get('a')!.fcmToken).toBeNull();
  });
  it('same generation permits token renewal without creating another generation', async () => {
    await service.updateFcmToken('a', 'one', first);
    await service.updateFcmToken('a', 'two', first);
    expect(generations.size).toBe(1);
    expect(users.get('a')!.fcmToken).toBe('two');
  });

  it('a failed transaction rolls back creation and can retry without resurrecting a revocation', async () => {
    beforeUpdate = () =>
      Promise.reject(new Error('synthetic persistence failure'));
    await expect(service.updateFcmToken('a', 'one', first)).rejects.toThrow(
      'synthetic persistence failure',
    );
    expect(generations.size).toBe(0);
    expect(users.get('a')!.fcmToken).toBeNull();
    beforeUpdate = undefined;
    await service.updateFcmToken('a', 'one', first);
    await service.clearFcmToken('a', undefined, first);
    await expect(
      service.updateFcmToken('a', 'retry', first),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('HTTP generation-only DELETE fences late creation/PATCH and preserves envelope', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const response = await request(server)
      .delete('/users/me/fcm-token')
      .send({ generation: first })
      .expect(200);
    expect((response.body as { success: boolean }).success).toBe(true);
    await request(server)
      .patch('/users/me/fcm-token')
      .send({ fcmToken: 'late', generation: first })
      .expect(409);
    await request(server)
      .patch('/users/me/fcm-token')
      .send({ fcmToken: 'new', generation: second })
      .expect(200);
    await request(server)
      .delete('/users/me/fcm-token')
      .send({ generation: first })
      .expect(200);
    expect(users.get('a')!.fcmToken).toBe('new');
  });
  it.each([null, '', 'invalid', 123])(
    'HTTP rejects invalid generation %j',
    async (generation) => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      await request(server)
        .delete('/users/me/fcm-token')
        .send({ generation })
        .expect(400);
      await request(server)
        .patch('/users/me/fcm-token')
        .send({ fcmToken: 'token', generation })
        .expect(400);
      expect(generations.size).toBe(0);
    },
  );
  it('legacy PATCH and bodyless DELETE remain supported', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server)
      .patch('/users/me/fcm-token')
      .send({ fcmToken: 'legacy' })
      .expect(200);
    await request(server).delete('/users/me/fcm-token').expect(200);
    expect(users.get('a')!.fcmToken).toBeNull();
    expect(generations.size).toBe(0);
  });
});
