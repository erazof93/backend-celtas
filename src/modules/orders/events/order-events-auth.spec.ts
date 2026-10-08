import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'http';
import type { Response } from 'express';
import type { StreamRequest } from './order-events.guard';
import { UsersService } from '../../users/users.service';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { OrderEventsController } from './order-events.controller';
import { OrderEventsGuard } from './order-events.guard';
import { OrderEventsStreamService } from './order-events-stream.service';
import { TransformInterceptor } from '../../../common/interceptors/transform.interceptor';

describe('Order events HTTP authentication (real JWT strategy, no database)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let role: string;
  let open: jest.Mock<void, [StreamRequest, Response]>;
  beforeAll(async () => {
    jwt = new JwtService({ secret: 'inert-local-order-events-secret' });
    open = jest.fn((_req, response) => {
      response
        .type('text/event-stream')
        .send('event: stream.ready\ndata: {"v":1}\n\n');
    });
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [OrderEventsController],
      providers: [
        JwtStrategy,
        OrderEventsGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            jwt: { secret: 'inert-local-order-events-secret' },
          }),
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(() =>
              Promise.resolve({
                id: 'admin-id',
                email: 'fake@test.local',
                role,
              }),
            ),
          },
        },
        { provide: OrderEventsStreamService, useValue: { open } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });
  beforeEach(() => {
    role = 'admin';
    open.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });
  const token = (options = {}) =>
    jwt.sign(
      { sub: 'admin-id', role: 'admin' },
      { expiresIn: '1m', ...options },
    );

  it('requires bearer and rejects invalid and expired JWTs', async () => {
    for (const bearer of [undefined, 'invalid', token({ expiresIn: -1 })]) {
      const call = request(app.getHttpServer() as Server).get(
        '/admin/orders/events',
      );
      if (bearer) call.set('Authorization', `Bearer ${bearer}`);
      await call.expect(401);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects JWTs in query strings even with a valid bearer', async () => {
    await request(app.getHttpServer() as Server)
      .get('/admin/orders/events?token=redacted')
      .set('Authorization', `Bearer ${token()}`)
      .expect(400);
  });

  it('uses the actual user role instead of the role claim', async () => {
    role = 'cliente';
    await request(app.getHttpServer() as Server)
      .get('/admin/orders/events')
      .set('Authorization', `Bearer ${token()}`)
      .expect(403);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not wrap SSE in the REST success envelope', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/admin/orders/events')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(response.text).toBe('event: stream.ready\ndata: {"v":1}\n\n');
    expect(open.mock.calls[0][0].user.expiresAt).toBeGreaterThan(Date.now());
  });
});
