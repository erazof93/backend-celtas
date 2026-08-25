import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { limaWallClockDate } from './../src/common/utils/lima-time.util';
import { Category } from './../src/modules/menu/entities/category.entity';
import { MenuItem } from './../src/modules/menu/entities/menu-item.entity';
import {
  Order,
  OrderStatus,
} from './../src/modules/orders/entities/order.entity';
import { RewardRedemption } from './../src/modules/rewards/entities/reward-redemption.entity';
import { StarPromotion } from './../src/modules/rewards/entities/star-promotion.entity';
import { RewardsService } from './../src/modules/rewards/rewards.service';
import { Setting } from './../src/modules/settings/entities/setting.entity';
import { Address } from './../src/modules/users/entities/address.entity';
import {
  User,
  UserProvider,
  UserRole,
} from './../src/modules/users/entities/user.entity';
import {
  BusinessHoursSnapshot,
  forceBusinessAlwaysOpen,
  restoreBusinessHours,
} from './helpers/business-hours.helper';

interface AuthTokensResponse {
  success: boolean;
  data: { accessToken: string };
}

interface ErrorResponse {
  success: boolean;
  message: string;
  statusCode: number;
}

interface Envelope {
  data: unknown;
}

interface OrderData {
  id: string;
  status: string;
  total: number;
  items: { unitPrice: number; subtotal: number; menuItemId: string }[];
}

interface MenuItemData {
  id: string;
  name: string;
  price: number;
  redeemableWithStars: boolean;
}

interface RewardsProgressData {
  estrellasParaProximoPremio: number;
  estrellasPorPremio: number;
  premiosDisponibles: { id: string; expiresAt: string }[];
  promocionActiva: {
    label: string;
    multiplier: number;
    endDate: string;
  } | null;
}

interface CatalogItemData {
  id: string;
  name: string;
  price: number;
}

interface StarPromotionData {
  id: string;
  label: string;
  multiplier: number;
  startDate: string;
  endDate: string;
  active: boolean;
}

describe('Rewards — programa de estrellas (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let addressesRepo: Repository<Address>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let ordersRepo: Repository<Order>;
  let settingsRepo: Repository<Setting>;
  let rewardRedemptionsRepo: Repository<RewardRedemption>;
  let starPromotionsRepo: Repository<StarPromotion>;
  let rewardsService: RewardsService;
  let businessHoursSnapshot: BusinessHoursSnapshot;

  let adminToken: string;
  let categoryId: string;
  let itemBigId: string; // S/100, no canjeable — genera muchas estrellas rápido
  let itemMediumId: string; // S/50, no canjeable
  let itemSmallId: string; // S/5, no canjeable — para "no regenerar" sin cruzar umbral
  let itemRedeemableId: string; // S/8, canjeable
  let itemRedeemable2Id: string; // S/6, canjeable (segundo producto canjeable)

  const suffix = Date.now();
  const password = 'password123';
  const adminEmail = `qa-rewards-admin-${suffix}@test.com`;
  const genericAddress =
    '{"fullAddress":"Av. Prueba de Estrellas 1","district":"SJM"}';
  const createdUserEmails: string[] = [];
  const createdPromotionIds: string[] = [];

  const register = async (
    label: string,
  ): Promise<{ token: string; email: string; userId: string }> => {
    const email = `qa-rewards-${label}-${suffix}@test.com`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName: `Cliente ${label}` })
      .expect(201);
    const token = (res.body as AuthTokensResponse).data.accessToken;
    const user = await usersRepo.findOne({ where: { email } });
    return { token, email, userId: user!.id };
  };

  const createOrder = (token: string, items: Record<string, unknown>[]) =>
    request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressSnapshot: genericAddress, items });

  /** Lleva un pedido de pendiente a entregado (dispara recalculateForUser). */
  const deliverOrder = async (orderId: string): Promise<void> => {
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'confirmado' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'en_camino' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'entregado' })
      .expect(200);
  };

  const getProgress = async (token: string): Promise<RewardsProgressData> => {
    const res = await request(app.getHttpServer())
      .get('/rewards/progress')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as Envelope).data as RewardsProgressData;
  };

  const ordersCountFor = async (token: string): Promise<number> => {
    const res = await request(app.getHttpServer())
      .get('/orders/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return ((res.body as Envelope).data as OrderData[]).length;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new TransformInterceptor(),
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    usersRepo = app.get<Repository<User>>(getRepositoryToken(User));
    addressesRepo = app.get<Repository<Address>>(getRepositoryToken(Address));
    categoriesRepo = app.get<Repository<Category>>(
      getRepositoryToken(Category),
    );
    itemsRepo = app.get<Repository<MenuItem>>(getRepositoryToken(MenuItem));
    ordersRepo = app.get<Repository<Order>>(getRepositoryToken(Order));
    settingsRepo = app.get<Repository<Setting>>(getRepositoryToken(Setting));
    rewardRedemptionsRepo = app.get<Repository<RewardRedemption>>(
      getRepositoryToken(RewardRedemption),
    );
    starPromotionsRepo = app.get<Repository<StarPromotion>>(
      getRepositoryToken(StarPromotion),
    );
    rewardsService = app.get(RewardsService);

    businessHoursSnapshot = await forceBusinessAlwaysOpen(settingsRepo);

    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Rewards QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;

    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Rewards QA ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;

    const mkItem = async (
      name: string,
      price: number,
      redeemableWithStars = false,
    ): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name, price, categoryId, redeemableWithStars })
        .expect(201);
      return ((res.body as Envelope).data as MenuItemData).id;
    };

    itemBigId = await mkItem('QA Grande S/100', 100);
    itemMediumId = await mkItem('QA Mediano S/50', 50);
    itemSmallId = await mkItem('QA Chico S/5', 5);
    itemRedeemableId = await mkItem('QA Canjeable S/8', 8, true);
    itemRedeemable2Id = await mkItem('QA Canjeable 2 S/6', 6, true);
  });

  afterAll(async () => {
    const users = await usersRepo.find({
      where: createdUserEmails.map((email) => ({ email })),
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await rewardRedemptionsRepo.delete({ userId: In(ids) });
      await ordersRepo.delete({ userId: In(ids) });
      await addressesRepo.delete({ userId: In(ids) });
    }
    if (createdPromotionIds.length > 0) {
      await starPromotionsRepo.delete({ id: In(createdPromotionIds) });
    }
    await itemsRepo.delete({ categoryId });
    await categoriesRepo.delete({ id: categoryId });
    for (const email of createdUserEmails) {
      await usersRepo.delete({ email });
    }
    await usersRepo.delete({ email: adminEmail });
    await restoreBusinessHours(settingsRepo, businessHoursSnapshot);
    await app.close();
  });

  describe('Autenticación / autorización', () => {
    it('GET /rewards/progress: 401 sin token', async () => {
      await request(app.getHttpServer()).get('/rewards/progress').expect(401);
    });

    it('GET /rewards/catalog: 401 sin token', async () => {
      await request(app.getHttpServer()).get('/rewards/catalog').expect(401);
    });

    it('POST /star-promotions: 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/star-promotions')
        .send({
          label: 'x',
          multiplier: 2,
          startDate: '2099-01-01',
          endDate: '2099-01-02',
        })
        .expect(401);
    });
  });

  describe('GET /rewards/catalog', () => {
    it('lista solo productos redeemableWithStars=true y available=true, no expone los demás', async () => {
      const { token } = await register('catalog');
      const res = await request(app.getHttpServer())
        .get('/rewards/catalog')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const data = (res.body as Envelope).data as CatalogItemData[];
      const ids = data.map((i) => i.id);
      expect(ids).toContain(itemRedeemableId);
      expect(ids).toContain(itemRedeemable2Id);
      expect(ids).not.toContain(itemBigId);
      expect(ids).not.toContain(itemMediumId);
      expect(ids).not.toContain(itemSmallId);
    });
  });

  describe('Cálculo de estrellas sin promoción activa', () => {
    it('S/50 sin envío = 5 estrellas, sin premio (10 soles/estrella, 10 estrellas/premio por default)', async () => {
      const { token } = await register('sin-promo');
      const created = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 },
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;
      await deliverOrder(orderId);

      const progress = await getProgress(token);
      expect(progress.estrellasParaProximoPremio).toBe(5);
      expect(progress.estrellasPorPremio).toBe(10);
      expect(progress.premiosDisponibles).toHaveLength(0);
      expect(progress.promocionActiva).toBeNull();
    });
  });

  describe('Cálculo de estrellas con promoción de estrellas dobles activa', () => {
    let promoId: string;

    it('crea la promoción cubriendo el mes actual', async () => {
      const { year, month } = limaWallClockDate();
      const pad = (n: number) => String(n).padStart(2, '0');
      const startDate = `${year}-${pad(month)}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${pad(month)}-${pad(lastDay)}`;

      const res = await request(app.getHttpServer())
        .post('/star-promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: 'QA doble estrella',
          multiplier: 2,
          startDate,
          endDate,
        })
        .expect(201);
      const data = (res.body as Envelope).data as StarPromotionData;
      promoId = data.id;
      createdPromotionIds.push(promoId);
      expect(data.active).toBe(true);
    });

    it('S/50 pesados x2 = 100 → 10 estrellas → genera 1 premio, y promocionActiva refleja la promo vigente hoy', async () => {
      const { token } = await register('con-promo');
      const created = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 },
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;
      await deliverOrder(orderId);

      const progress = await getProgress(token);
      expect(progress.estrellasParaProximoPremio).toBe(0);
      expect(progress.premiosDisponibles).toHaveLength(1);
      expect(progress.promocionActiva).toMatchObject({
        label: 'QA doble estrella',
        multiplier: 2,
      });

      const expectedExpiry = Date.now() + 15 * 24 * 60 * 60 * 1000;
      const actualExpiry = new Date(
        progress.premiosDisponibles[0].expiresAt,
      ).getTime();
      expect(actualExpiry).toBeGreaterThan(expectedExpiry - 60_000);
      expect(actualExpiry).toBeLessThan(expectedExpiry + 60_000);
    });

    it('desactiva la promoción para no interferir con el resto de la suite', async () => {
      await request(app.getHttpServer())
        .patch(`/star-promotions/${promoId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);
    });
  });

  describe('Generación de más de un premio de una sola vez (pedido grande)', () => {
    it('S/300 sin envío = 30 estrellas → 3 premios en una sola pasada', async () => {
      const { token } = await register('pedido-grande');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 3 },
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;
      await deliverOrder(orderId);

      const progress = await getProgress(token);
      expect(progress.estrellasParaProximoPremio).toBe(0);
      expect(progress.premiosDisponibles).toHaveLength(3);
    });
  });

  describe('No regeneración de premios ya contados este mes', () => {
    it('un segundo pedido pequeño que no cruza el próximo umbral no genera un premio nuevo', async () => {
      const { token } = await register('no-regen');
      const first = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 1 }, // 100 → 10 estrellas → 1 premio
      ]).expect(201);
      await deliverOrder(((first.body as Envelope).data as OrderData).id);

      let progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(1);

      const second = await createOrder(token, [
        { menuItemId: itemSmallId, quantity: 1 }, // +5 → 105 → floor(105/10)=10 → sigue en 1 premio
      ]).expect(201);
      await deliverOrder(((second.body as Envelope).data as OrderData).id);

      progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(1); // no se regeneró
      expect(progress.estrellasParaProximoPremio).toBe(0);

      const third = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 1 }, // +100 → 205 → floor(205/10)=20 → 2 premios
      ]).expect(201);
      await deliverOrder(((third.body as Envelope).data as OrderData).id);

      progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(2); // ahora sí, uno nuevo
    });
  });

  describe('Expiración de premios', () => {
    it('un RewardRedemption con expiresAt en el pasado no aparece en premiosDisponibles', async () => {
      const { token, userId } = await register('expirado');
      const expired = await rewardRedemptionsRepo.save(
        rewardRedemptionsRepo.create({
          userId,
          earnedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000),
          usedAt: null,
          usedInOrderId: null,
          menuItemId: null,
        } as Partial<RewardRedemption>),
      );

      const progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(0);
      expect(progress.premiosDisponibles.some((r) => r.id === expired.id)).toBe(
        false,
      );
    });

    it('canjear un premio vencido se rechaza con 400 y no crea el pedido', async () => {
      const { token, userId } = await register('canje-vencido');
      const expired = await rewardRedemptionsRepo.save(
        rewardRedemptionsRepo.create({
          userId,
          earnedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000),
          usedAt: null,
          usedInOrderId: null,
          menuItemId: null,
        } as Partial<RewardRedemption>),
      );

      const before = await ordersCountFor(token);
      const res = await createOrder(token, [
        {
          menuItemId: itemRedeemableId,
          quantity: 1,
          rewardRedemptionId: expired.id,
        },
      ]).expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Este premio ha expirado',
      );
      expect(await ordersCountFor(token)).toBe(before);
    });
  });

  describe('Canje inválido / flujo de canje completo', () => {
    it('canjear el premio de OTRO usuario se rechaza con 400 y no crea el pedido', async () => {
      const owner = await register('canje-owner');
      const stranger = await register('canje-stranger');

      const created = await createOrder(owner.token, [
        { menuItemId: itemBigId, quantity: 1 }, // 100 → 1 premio
      ]).expect(201);
      await deliverOrder(((created.body as Envelope).data as OrderData).id);
      const progress = await getProgress(owner.token);
      const rewardId = progress.premiosDisponibles[0].id;

      const before = await ordersCountFor(stranger.token);
      const res = await createOrder(stranger.token, [
        {
          menuItemId: itemRedeemableId,
          quantity: 1,
          rewardRedemptionId: rewardId,
        },
      ]).expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Este premio no pertenece a tu cuenta',
      );
      expect(await ordersCountFor(stranger.token)).toBe(before);

      // El dueño real sí puede canjearlo: precio forzado a 0, se marca usado.
      const redeemed = await createOrder(owner.token, [
        {
          menuItemId: itemRedeemableId,
          quantity: 1,
          rewardRedemptionId: rewardId,
        },
      ]).expect(201);
      const order = (redeemed.body as Envelope).data as OrderData;
      expect(order.items[0].unitPrice).toBe(0);
      expect(order.items[0].subtotal).toBe(0);

      const stored = await rewardRedemptionsRepo.findOne({
        where: { id: rewardId },
      });
      expect(stored!.usedAt).not.toBeNull();
      expect(stored!.usedInOrderId).toBe(order.id);
      expect(stored!.menuItemId).toBe(itemRedeemableId);

      // Reintentar canjear el mismo premio: ya fue usado.
      const beforeRetry = await ordersCountFor(owner.token);
      const retry = await createOrder(owner.token, [
        {
          menuItemId: itemRedeemableId,
          quantity: 1,
          rewardRedemptionId: rewardId,
        },
      ]).expect(400);
      expect((retry.body as ErrorResponse).message).toBe(
        'Este premio ya fue canjeado',
      );
      expect(await ordersCountFor(owner.token)).toBe(beforeRetry);

      // Cancelar el pedido que lo canjeó reactiva el premio.
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado' })
        .expect(200);
      const afterCancel = await rewardRedemptionsRepo.findOne({
        where: { id: rewardId },
      });
      expect(afterCancel!.usedAt).toBeNull();
      expect(afterCancel!.usedInOrderId).toBeNull();
      expect(afterCancel!.menuItemId).toBeNull();
      const progressAfterCancel = await getProgress(owner.token);
      expect(
        progressAfterCancel.premiosDisponibles.some((r) => r.id === rewardId),
      ).toBe(true);
    });

    it('quantity distinto de 1 en un ítem canjeado se rechaza con 400 y no crea el pedido', async () => {
      const { token } = await register('canje-qty');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 1 },
      ]).expect(201);
      await deliverOrder(((created.body as Envelope).data as OrderData).id);
      const progress = await getProgress(token);
      const rewardId = progress.premiosDisponibles[0].id;

      const before = await ordersCountFor(token);
      const res = await createOrder(token, [
        {
          menuItemId: itemRedeemableId,
          quantity: 2,
          rewardRedemptionId: rewardId,
        },
      ]).expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Un premio canjeado solo habilita 1 unidad del producto',
      );
      expect(await ordersCountFor(token)).toBe(before);

      const progressAfter = await getProgress(token);
      expect(
        progressAfter.premiosDisponibles.some((r) => r.id === rewardId),
      ).toBe(true);
    });

    it('canjear con un producto que NO es canjeable con estrellas se rechaza con 400', async () => {
      const { token } = await register('canje-no-redimible');
      const res = await createOrder(token, [
        {
          menuItemId: itemBigId, // no redeemableWithStars
          quantity: 1,
          rewardRedemptionId: '11111111-1111-4111-8111-111111111111',
        },
      ]).expect(400);
      expect((res.body as ErrorResponse).message).toContain(
        'no es canjeable con estrellas',
      );
    });

    it('repetir el mismo rewardRedemptionId en dos ítems del mismo pedido se rechaza con 400', async () => {
      const { token } = await register('canje-repetido');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 1 },
      ]).expect(201);
      await deliverOrder(((created.body as Envelope).data as OrderData).id);
      const progress = await getProgress(token);
      const rewardId = progress.premiosDisponibles[0].id;

      const before = await ordersCountFor(token);
      const res = await createOrder(token, [
        {
          menuItemId: itemRedeemableId,
          quantity: 1,
          rewardRedemptionId: rewardId,
        },
        {
          menuItemId: itemRedeemable2Id,
          quantity: 1,
          rewardRedemptionId: rewardId,
        },
      ]).expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'No puedes usar el mismo premio más de una vez en el mismo pedido',
      );
      expect(await ordersCountFor(token)).toBe(before);

      const stored = await rewardRedemptionsRepo.findOne({
        where: { id: rewardId },
      });
      expect(stored!.usedAt).toBeNull();
    });
  });

  describe('Distinción createdAt (multiplicador de promoción) vs deliveredAt (mes calendario)', () => {
    it('un pedido entregado FUERA del mes actual no cuenta, aunque se haya creado hoy', async () => {
      const { token, userId } = await register('temporal-fuera-mes');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 1 }, // 100 → normalmente 1 premio
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;

      // Se entrega "de verdad" (fuera del mes actual) manipulando la fila
      // directamente: no hay forma de retroceder deliveredAt vía la API.
      const outsideCurrentMonth = new Date();
      outsideCurrentMonth.setUTCMonth(outsideCurrentMonth.getUTCMonth() - 2);
      await ordersRepo.update(orderId, {
        status: OrderStatus.ENTREGADO,
        deliveredAt: outsideCurrentMonth,
      });

      await rewardsService.recalculateForUser(userId);

      const progress = await getProgress(token);
      expect(progress.estrellasParaProximoPremio).toBe(0);
      expect(progress.premiosDisponibles).toHaveLength(0);
    });

    it('un pedido con createdAt viejo pero deliveredAt de este mes SÍ cuenta (el mes lo decide deliveredAt)', async () => {
      const { token, userId } = await register('temporal-createdat-viejo');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 1 },
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;

      const oldCreatedAt = new Date('2020-03-10T12:00:00.000Z');
      await ordersRepo.update(orderId, {
        status: OrderStatus.ENTREGADO,
        deliveredAt: new Date(),
        createdAt: oldCreatedAt,
      });

      await rewardsService.recalculateForUser(userId);

      const progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(1);
    });

    it('el multiplicador de una promoción se aplica según createdAt (día de la compra), no deliveredAt (día de entrega)', async () => {
      const promoStart = '2020-06-01';
      const promoEnd = '2020-06-30';
      const promo = await request(app.getHttpServer())
        .post('/star-promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: 'QA promo histórica junio 2020',
          multiplier: 3,
          startDate: promoStart,
          endDate: promoEnd,
        })
        .expect(201);
      const promoId = ((promo.body as Envelope).data as StarPromotionData).id;
      createdPromotionIds.push(promoId);

      const { token, userId } = await register('temporal-multiplicador');
      const created = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 }, // 50 soles
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;

      // createdAt cae DENTRO del rango de la promo (junio 2020); deliveredAt
      // es HOY (fuera del rango de la promo, dentro del mes calendario
      // actual). Si el código usara deliveredAt para pesar el multiplicador,
      // esto daría 5 estrellas (sin multiplicador) en vez de 15 (50*3/10).
      await ordersRepo.update(orderId, {
        status: OrderStatus.ENTREGADO,
        deliveredAt: new Date(),
        createdAt: new Date('2020-06-15T12:00:00.000Z'),
      });

      await rewardsService.recalculateForUser(userId);

      const progress = await getProgress(token);
      // 50 * 3 = 150 pesados / 10 = 15 estrellas → floor(15/10) = 1 premio.
      expect(progress.premiosDisponibles).toHaveLength(1);
      expect(progress.estrellasParaProximoPremio).toBe(5); // 15 % 10

      // La promoción vigente HOY no es esta (es de 2020): "promocionActiva"
      // (para mostrar al cliente) y el peso histórico del multiplicador son
      // cálculos independientes.
      expect(progress.promocionActiva).toBeNull();

      await starPromotionsRepo.update(promoId, { active: false });
    });
  });

  describe('PATCH /menu/items/:id — redeemableWithStars', () => {
    it('permite activar redeemableWithStars en un producto existente', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/menu/items/${itemMediumId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ redeemableWithStars: true })
        .expect(200);
      expect((res.body as Envelope).data as MenuItemData).toMatchObject({
        id: itemMediumId,
        redeemableWithStars: true,
      });

      const list = await request(app.getHttpServer())
        .get('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const item = ((list.body as Envelope).data as MenuItemData[]).find(
        (i) => i.id === itemMediumId,
      );
      expect(item!.redeemableWithStars).toBe(true);
    });

    it('PATCH parcial de otro campo no pisa redeemableWithStars (merge, no Object.assign)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/menu/items/${itemMediumId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'Ahora canjeable con estrellas' })
        .expect(200);
      expect((res.body as Envelope).data as MenuItemData).toMatchObject({
        redeemableWithStars: true,
      });
    });

    it('permite desactivar redeemableWithStars de nuevo', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/menu/items/${itemMediumId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ redeemableWithStars: false })
        .expect(200);
      expect((res.body as Envelope).data as MenuItemData).toMatchObject({
        redeemableWithStars: false,
      });
    });
  });

  describe('StarPromotions — CRUD admin y validación de solapamiento', () => {
    // Año derivado de `suffix` (no un fijo "año actual + 5"): un valor fijo
    // colisiona con cualquier promoción activa que haya quedado de una corrida
    // anterior interrumpida (o de pruebas manuales) en esa misma ventana de
    // fechas, ya que esta suite nunca vuelve a limpiar promociones que no creó
    // ella misma. Con esto, cada corrida usa su propia ventana de fechas real,
    // igual que ya hace el resto del archivo con los emails vía `suffix`.
    const year = 2030 + (suffix % 500);

    it('401 sin token, 403 para un cliente', async () => {
      const { token } = await register('promo-forbidden');
      await request(app.getHttpServer()).get('/star-promotions').expect(401);
      await request(app.getHttpServer())
        .get('/star-promotions')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('crea una promoción válida', async () => {
      const res = await request(app.getHttpServer())
        .post('/star-promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: 'QA base',
          multiplier: 2,
          startDate: `${year}-01-01`,
          endDate: `${year}-01-31`,
        })
        .expect(201);
      const data = (res.body as Envelope).data as StarPromotionData;
      createdPromotionIds.push(data.id);
      expect(data.active).toBe(true);
    });

    it('400 si startDate es posterior a endDate', async () => {
      const res = await request(app.getHttpServer())
        .post('/star-promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: 'QA invalida',
          multiplier: 2,
          startDate: `${year}-03-15`,
          endDate: `${year}-03-01`,
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si el rango se solapa con la promoción activa existente', async () => {
      const res = await request(app.getHttpServer())
        .post('/star-promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: 'QA solapada',
          multiplier: 1.5,
          startDate: `${year}-01-20`,
          endDate: `${year}-02-10`,
        })
        .expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Ya existe una promoción activa en ese rango de fechas',
      );
    });

    it('201 si el rango NO se solapa (mes siguiente)', async () => {
      const res = await request(app.getHttpServer())
        .post('/star-promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: 'QA febrero',
          multiplier: 1.5,
          startDate: `${year}-02-01`,
          endDate: `${year}-02-28`,
        })
        .expect(201);
      const data = (res.body as Envelope).data as StarPromotionData;
      createdPromotionIds.push(data.id);
    });

    it('PATCH que hace que el rango se solape con otra promoción activa se rechaza con 400', async () => {
      const febPromoId = createdPromotionIds[createdPromotionIds.length - 1];
      const res = await request(app.getHttpServer())
        .patch(`/star-promotions/${febPromoId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startDate: `${year}-01-25` })
        .expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Ya existe una promoción activa en ese rango de fechas',
      );
    });

    it('PATCH active:false no valida solapamiento aunque las fechas se solapen', async () => {
      const febPromoId = createdPromotionIds[createdPromotionIds.length - 1];
      const res = await request(app.getHttpServer())
        .patch(`/star-promotions/${febPromoId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false, startDate: `${year}-01-25` })
        .expect(200);
      expect((res.body as Envelope).data as StarPromotionData).toMatchObject({
        active: false,
      });
    });

    describe('Caso límite: fechas que se tocan en un mismo día', () => {
      // Mutation testing del @tester encontró que invertir los operadores de
      // `assertNoOverlap` (<=/>= por </>) dejaba la suite completa en verde
      // (31/31) — ningún test cubría el caso exacto en que el endDate de una
      // promoción coincide con el startDate de otra. El criterio de negocio
      // (comparación inclusiva: se consideran solapadas) no cambia, esto solo
      // cierra el gap de cobertura.
      let baseId: string;

      it('crea la promoción base del caso límite (1-15 de abril)', async () => {
        const res = await request(app.getHttpServer())
          .post('/star-promotions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            label: 'QA límite base',
            multiplier: 2,
            startDate: `${year}-04-01`,
            endDate: `${year}-04-15`,
          })
          .expect(201);
        baseId = ((res.body as Envelope).data as StarPromotionData).id;
        createdPromotionIds.push(baseId);
      });

      it('rechaza si el startDate de la nueva promoción es igual al endDate de la base (se tocan por la derecha)', async () => {
        const res = await request(app.getHttpServer())
          .post('/star-promotions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            label: 'QA límite toca por la derecha',
            multiplier: 1.5,
            startDate: `${year}-04-15`, // mismo día que el endDate de la base
            endDate: `${year}-04-20`,
          })
          .expect(400);
        expect((res.body as ErrorResponse).message).toBe(
          'Ya existe una promoción activa en ese rango de fechas',
        );
      });

      it('rechaza si el endDate de la nueva promoción es igual al startDate de la base (se tocan por la izquierda)', async () => {
        const res = await request(app.getHttpServer())
          .post('/star-promotions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            label: 'QA límite toca por la izquierda',
            multiplier: 1.5,
            startDate: `${year}-03-25`,
            endDate: `${year}-04-01`, // mismo día que el startDate de la base
          })
          .expect(400);
        expect((res.body as ErrorResponse).message).toBe(
          'Ya existe una promoción activa en ese rango de fechas',
        );
      });
    });

    it('GET /star-promotions/:id: 404 si no existe', async () => {
      await request(app.getHttpServer())
        .get('/star-promotions/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('GET /star-promotions lista las promociones creadas', async () => {
      const res = await request(app.getHttpServer())
        .get('/star-promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as StarPromotionData[];
      expect(data.some((p) => p.label === 'QA base')).toBe(true);
    });
  });
});
