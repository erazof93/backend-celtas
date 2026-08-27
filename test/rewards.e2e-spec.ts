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
import {
  limaWallClockDate,
  limaWallClockToUtc,
} from './../src/common/utils/lima-time.util';
import { Category } from './../src/modules/menu/entities/category.entity';
import { MenuItem } from './../src/modules/menu/entities/menu-item.entity';
import {
  Order,
  OrderStatus,
} from './../src/modules/orders/entities/order.entity';
import { RewardMilestone } from './../src/modules/rewards/entities/reward-milestone.entity';
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
  specialReward: boolean;
}

interface RewardsProgressData {
  estrellasDelMes: number;
  hitos: {
    estrellasRequeridas: number;
    alcanzado: boolean;
    esEspecial: boolean;
  }[];
  premiosDisponibles: { id: string; expiresAt: string; esEspecial: boolean }[];
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

interface RewardMilestoneData {
  id: string;
  starsRequired: number;
  isSpecial: boolean;
}

describe('Rewards — programa de estrellas con hitos irregulares (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let addressesRepo: Repository<Address>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let ordersRepo: Repository<Order>;
  let settingsRepo: Repository<Setting>;
  let rewardRedemptionsRepo: Repository<RewardRedemption>;
  let rewardMilestonesRepo: Repository<RewardMilestone>;
  let starPromotionsRepo: Repository<StarPromotion>;
  let rewardsService: RewardsService;
  let businessHoursSnapshot: BusinessHoursSnapshot;

  let adminToken: string;
  let categoryId: string;
  let itemBigId: string; // S/100, ningún catálogo — genera muchas estrellas rápido
  let itemMediumId: string; // S/50, ningún catálogo
  let itemSmallId: string; // S/5, ningún catálogo
  let itemRedeemableId: string; // S/8, catálogo normal (redeemableWithStars)
  let itemRedeemable2Id: string; // S/6, catálogo normal (segundo producto)
  let itemSpecialId: string; // S/20, catálogo especial (specialReward), NO redeemableWithStars
  let itemExclusiveId: string; // S/12, available=false + redeemableWithStars=true — EXCLUSIVO del programa, nunca se vende suelto

  // Hitos de la suite: 5 (normal), 8 (normal), 15 (especial) — el mockup
  // aprobado con el usuario. Se limpia la tabla completa al empezar y se
  // restaura el estado previo al terminar (mismo criterio que
  // `forceBusinessAlwaysOpen`/`restoreBusinessHours`), porque `GET
  // /rewards/progress` lee TODOS los hitos de la tabla, sin scope por suite.
  let preExistingMilestones: RewardMilestone[] = [];
  let milestone5Id: string;
  let milestone8Id: string;
  let milestone15Id: string;

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
    rewardMilestonesRepo = app.get<Repository<RewardMilestone>>(
      getRepositoryToken(RewardMilestone),
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
      flags: {
        redeemableWithStars?: boolean;
        specialReward?: boolean;
        available?: boolean;
      } = {},
    ): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name, price, categoryId, ...flags })
        .expect(201);
      return ((res.body as Envelope).data as MenuItemData).id;
    };

    itemBigId = await mkItem('QA Grande S/100', 100);
    itemMediumId = await mkItem('QA Mediano S/50', 50);
    itemSmallId = await mkItem('QA Chico S/5', 5);
    itemRedeemableId = await mkItem('QA Canjeable S/8', 8, {
      redeemableWithStars: true,
    });
    itemRedeemable2Id = await mkItem('QA Canjeable 2 S/6', 6, {
      redeemableWithStars: true,
    });
    itemSpecialId = await mkItem('QA Especial S/20', 20, {
      specialReward: true,
    });
    itemExclusiveId = await mkItem('QA Exclusivo S/12', 12, {
      redeemableWithStars: true,
      available: false,
    });

    // La tabla reward_milestones no tiene scope por suite: se limpia entera y
    // se restaura al final (mismo criterio que business-hours.helper).
    preExistingMilestones = await rewardMilestonesRepo.find();
    if (preExistingMilestones.length > 0) {
      await rewardMilestonesRepo.remove(preExistingMilestones);
    }

    const m5 = await request(app.getHttpServer())
      .post('/reward-milestones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ starsRequired: 5 })
      .expect(201);
    milestone5Id = ((m5.body as Envelope).data as RewardMilestoneData).id;

    const m8 = await request(app.getHttpServer())
      .post('/reward-milestones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ starsRequired: 8 })
      .expect(201);
    milestone8Id = ((m8.body as Envelope).data as RewardMilestoneData).id;

    const m15 = await request(app.getHttpServer())
      .post('/reward-milestones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ starsRequired: 15, isSpecial: true })
      .expect(201);
    milestone15Id = ((m15.body as Envelope).data as RewardMilestoneData).id;
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

    await rewardMilestonesRepo.delete({
      id: In([milestone5Id, milestone8Id, milestone15Id]),
    });
    if (preExistingMilestones.length > 0) {
      await rewardMilestonesRepo.save(preExistingMilestones);
    }

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

    it('GET /reward-milestones: 401 sin token, 403 para un cliente', async () => {
      const { token } = await register('milestones-forbidden');
      await request(app.getHttpServer()).get('/reward-milestones').expect(401);
      await request(app.getHttpServer())
        .get('/reward-milestones')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
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

  describe('GET /rewards/catalog — dos catálogos EXCLUYENTES', () => {
    it('sin especial: lista solo productos redeemableWithStars=true, nunca el del premio especial', async () => {
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
      expect(ids).not.toContain(itemSpecialId);
    });

    it('incluye productos EXCLUSIVOS del programa (available=false) — available no filtra el catálogo', async () => {
      const { token } = await register('catalog-exclusivo');
      const res = await request(app.getHttpServer())
        .get('/rewards/catalog')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const data = (res.body as Envelope).data as CatalogItemData[];
      const ids = data.map((i) => i.id);
      expect(ids).toContain(itemExclusiveId);
    });

    it('especial=true: lista solo productos specialReward=true, nunca los del catálogo normal', async () => {
      const { token } = await register('catalog-especial');
      const res = await request(app.getHttpServer())
        .get('/rewards/catalog?especial=true')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const data = (res.body as Envelope).data as CatalogItemData[];
      const ids = data.map((i) => i.id);
      expect(ids).toContain(itemSpecialId);
      expect(ids).not.toContain(itemRedeemableId);
      expect(ids).not.toContain(itemRedeemable2Id);
    });
  });

  describe('GET /reward-milestones', () => {
    it('lista los hitos ordenados ASC por starsRequired', async () => {
      const res = await request(app.getHttpServer())
        .get('/reward-milestones')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as RewardMilestoneData[];
      expect(data.map((m) => m.starsRequired)).toEqual([5, 8, 15]);
      expect(data.find((m) => m.starsRequired === 15)!.isSpecial).toBe(true);
      expect(data.find((m) => m.starsRequired === 5)!.isSpecial).toBe(false);
    });

    it('GET /reward-milestones/:id: 404 si no existe', async () => {
      await request(app.getHttpServer())
        .get('/reward-milestones/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('POST /reward-milestones — unicidad de starsRequired', () => {
    it('starsRequired repetido: 400, no un 500 crudo por la constraint de la DB', async () => {
      const res = await request(app.getHttpServer())
        .post('/reward-milestones')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ starsRequired: 5 })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Ya existe un premio configurado para esa cantidad de estrellas',
      );
    });

    it('PATCH a un starsRequired ya usado por otro hito: 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/reward-milestones/${milestone8Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ starsRequired: 5 })
        .expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Ya existe un premio configurado para esa cantidad de estrellas',
      );
    });
  });

  describe('Cálculo de estrellas y estado de cada hito (sin promoción activa)', () => {
    it('S/50 sin envío = 5 estrellas: hito 5 alcanzado, 8 y 15 no, 1 premio disponible (no especial)', async () => {
      const { token } = await register('sin-promo');
      const created = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 },
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;
      await deliverOrder(orderId);

      const progress = await getProgress(token);
      expect(progress.estrellasDelMes).toBe(5);
      expect(progress.hitos).toEqual([
        { estrellasRequeridas: 5, alcanzado: true, esEspecial: false },
        { estrellasRequeridas: 8, alcanzado: false, esEspecial: false },
        { estrellasRequeridas: 15, alcanzado: false, esEspecial: true },
      ]);
      expect(progress.premiosDisponibles).toHaveLength(1);
      expect(progress.premiosDisponibles[0].esEspecial).toBe(false);
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

    it('S/50 pesados x2 = 100 → 10 estrellas → hitos 5 y 8 alcanzados, promocionActiva refleja la promo vigente hoy', async () => {
      const { token } = await register('con-promo');
      const created = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 },
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;
      await deliverOrder(orderId);

      const progress = await getProgress(token);
      expect(progress.estrellasDelMes).toBe(10);
      expect(
        progress.hitos.find((h) => h.estrellasRequeridas === 5)!.alcanzado,
      ).toBe(true);
      expect(
        progress.hitos.find((h) => h.estrellasRequeridas === 8)!.alcanzado,
      ).toBe(true);
      expect(
        progress.hitos.find((h) => h.estrellasRequeridas === 15)!.alcanzado,
      ).toBe(false);
      expect(progress.premiosDisponibles).toHaveLength(2);
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

  describe('Varios hitos alcanzados de una sola vez (20 estrellas con hitos 5/8/15)', () => {
    it('S/200 sin envío = 20 estrellas → los 3 premios (5, 8 y 15-especial) en una sola pasada', async () => {
      const { token } = await register('pedido-grande');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 2 },
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;
      await deliverOrder(orderId);

      const progress = await getProgress(token);
      expect(progress.estrellasDelMes).toBe(20);
      expect(progress.hitos.every((h) => h.alcanzado)).toBe(true);
      expect(progress.premiosDisponibles).toHaveLength(3);
      const especiales = progress.premiosDisponibles.filter(
        (p) => p.esEspecial,
      );
      expect(especiales).toHaveLength(1); // solo el hito de 15 es especial
    });
  });

  describe('El excedente sobre el hito más alto no genera nada extra (tope de un tablero por mes)', () => {
    it('S/1000 sin envío = 100 estrellas → sigue siendo solo 3 premios, no más', async () => {
      const { token, userId } = await register('excedente');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 10 },
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;
      await deliverOrder(orderId);

      const progress = await getProgress(token);
      expect(progress.estrellasDelMes).toBe(100);
      expect(progress.premiosDisponibles).toHaveLength(3);

      // Idempotencia: recalcular de nuevo sin pedidos nuevos no otorga nada extra.
      await rewardsService.recalculateForUser(userId);
      const progressAfter = await getProgress(token);
      expect(progressAfter.premiosDisponibles).toHaveLength(3);
    });
  });

  describe('No regeneración de premios ya otorgados este mes (idempotencia real, no solo un mock)', () => {
    it('un segundo pedido pequeño que no cruza el próximo hito no genera un premio nuevo; uno que sí lo cruza, sí', async () => {
      const { token, userId } = await register('no-regen');
      const first = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 }, // 50 → 5 estrellas → hito 5
      ]).expect(201);
      await deliverOrder(((first.body as Envelope).data as OrderData).id);

      let progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(1);

      const second = await createOrder(token, [
        { menuItemId: itemSmallId, quantity: 1 }, // +5 → 55 → floor(55/10)=5 estrellas, sigue en el hito 5
      ]).expect(201);
      await deliverOrder(((second.body as Envelope).data as OrderData).id);

      progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(1); // no se regeneró
      expect(progress.estrellasDelMes).toBe(5);

      // Llamar recalculateForUser explícitamente sin pedidos nuevos: sigue sin duplicar.
      await rewardsService.recalculateForUser(userId);
      progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(1);

      const third = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 }, // +50 → 105 → 10 estrellas → cruza el hito 8 también
      ]).expect(201);
      await deliverOrder(((third.body as Envelope).data as OrderData).id);

      progress = await getProgress(token);
      expect(progress.premiosDisponibles).toHaveLength(2); // ahora sí, el hito 8 nuevo
    });
  });

  describe('El excedente no se arrastra al mes siguiente (corte de mes)', () => {
    it('un pedido con 20 estrellas entregado el mes pasado no aporta nada al mes actual', async () => {
      const { token, userId } = await register('sin-arrastre');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 2 }, // 200 → normalmente 20 estrellas, 3 premios
      ]).expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;

      // Se entrega "de verdad" el mes PASADO manipulando la fila directamente
      // (no hay forma de retroceder deliveredAt vía la API). Aritmética de
      // año/mes sobre el mes calendario de Lima (mismo criterio que
      // RewardsService.currentMonthRangeInLima): `setUTCMonth(-1)` desborda hacia
      // adelante los días 29-31 cuando el mes anterior no tiene ese día (31 de
      // marzo - 1 mes = 3 de marzo, sigue en el mes actual). Día fijo en 15 al
      // mediodía UTC: existe en cualquier mes y no cruza medianoche en Lima.
      const { year, month } = limaWallClockDate();
      const lastMonthNumber = month === 1 ? 12 : month - 1;
      const lastMonthYear = month === 1 ? year - 1 : year;
      const lastMonth = limaWallClockToUtc(
        lastMonthYear,
        lastMonthNumber,
        15,
        12,
        0,
      );
      await ordersRepo.update(orderId, {
        status: OrderStatus.ENTREGADO,
        deliveredAt: lastMonth,
      });

      await rewardsService.recalculateForUser(userId);

      const progress = await getProgress(token);
      // El mes actual arranca en 0: el excedente del mes pasado no se arrastra.
      expect(progress.estrellasDelMes).toBe(0);
      expect(progress.hitos.every((h) => !h.alcanzado)).toBe(true);
      expect(progress.premiosDisponibles).toHaveLength(0);
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
          milestoneStars: 5,
          isSpecial: false,
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
          milestoneStars: 5,
          isSpecial: false,
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

  describe('Canje inválido / flujo de canje completo (premio normal)', () => {
    it('canjear el premio de OTRO usuario se rechaza con 400 y no crea el pedido', async () => {
      const owner = await register('canje-owner');
      const stranger = await register('canje-stranger');

      const created = await createOrder(owner.token, [
        { menuItemId: itemMediumId, quantity: 1 }, // 50 → hito 5
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
        { menuItemId: itemMediumId, quantity: 1 },
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

    it('canjear con un producto que NO es canjeable con estrellas (ningún catálogo) se rechaza con 400', async () => {
      const { token } = await register('canje-no-redimible');
      const res = await createOrder(token, [
        {
          menuItemId: itemBigId, // ni redeemableWithStars ni specialReward
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
        { menuItemId: itemMediumId, quantity: 1 },
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

    it('canjear un producto EXCLUSIVO del programa (available=false, redeemableWithStars=true) se acepta: el checkout ignora available', async () => {
      const { token } = await register('canje-exclusivo');
      const created = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 }, // 50 → hito 5 (normal)
      ]).expect(201);
      await deliverOrder(((created.body as Envelope).data as OrderData).id);
      const progress = await getProgress(token);
      const rewardId = progress.premiosDisponibles.find(
        (p) => !p.esEspecial,
      )!.id;

      const redeemed = await createOrder(token, [
        {
          menuItemId: itemExclusiveId,
          quantity: 1,
          rewardRedemptionId: rewardId,
        },
      ]).expect(201);
      const order = (redeemed.body as Envelope).data as OrderData;
      expect(order.items[0].unitPrice).toBe(0);

      const stored = await rewardRedemptionsRepo.findOne({
        where: { id: rewardId },
      });
      expect(stored!.usedAt).not.toBeNull();
    });
  });

  describe('Canje del premio ESPECIAL — catálogo exclusivo, nunca el normal', () => {
    it('canjear un premio especial con un producto SOLO redeemableWithStars (no specialReward) se rechaza con 400', async () => {
      const { token } = await register('especial-catalogo-cruzado');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 2 }, // 200 → 20 estrellas → incluye el hito 15 (especial)
      ]).expect(201);
      await deliverOrder(((created.body as Envelope).data as OrderData).id);
      const progress = await getProgress(token);
      const specialRewardId = progress.premiosDisponibles.find(
        (p) => p.esEspecial,
      )!.id;

      const before = await ordersCountFor(token);
      const res = await createOrder(token, [
        {
          menuItemId: itemRedeemableId, // redeemableWithStars=true, specialReward=false
          quantity: 1,
          rewardRedemptionId: specialRewardId,
        },
      ]).expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'El producto seleccionado no es parte del catálogo del premio especial',
      );
      expect(await ordersCountFor(token)).toBe(before);
    });

    it('canjear un premio NORMAL con el producto del catálogo especial (specialReward, no redeemableWithStars) se rechaza con 400', async () => {
      const { token } = await register('normal-catalogo-cruzado');
      const created = await createOrder(token, [
        { menuItemId: itemMediumId, quantity: 1 }, // 50 → hito 5 (normal)
      ]).expect(201);
      await deliverOrder(((created.body as Envelope).data as OrderData).id);
      const progress = await getProgress(token);
      const normalRewardId = progress.premiosDisponibles.find(
        (p) => !p.esEspecial,
      )!.id;

      const res = await createOrder(token, [
        {
          menuItemId: itemSpecialId, // specialReward=true, redeemableWithStars=false
          quantity: 1,
          rewardRedemptionId: normalRewardId,
        },
      ]).expect(400);
      expect((res.body as ErrorResponse).message).toBe(
        'El producto seleccionado no es canjeable con estrellas',
      );
    });

    it('canjear un premio especial con el producto correcto (specialReward=true) funciona: precio forzado a 0', async () => {
      const { token } = await register('especial-ok');
      const created = await createOrder(token, [
        { menuItemId: itemBigId, quantity: 2 }, // 20 estrellas → incluye el hito especial (15)
      ]).expect(201);
      await deliverOrder(((created.body as Envelope).data as OrderData).id);
      const progress = await getProgress(token);
      const specialRewardId = progress.premiosDisponibles.find(
        (p) => p.esEspecial,
      )!.id;

      const redeemed = await createOrder(token, [
        {
          menuItemId: itemSpecialId,
          quantity: 1,
          rewardRedemptionId: specialRewardId,
        },
      ]).expect(201);
      const order = (redeemed.body as Envelope).data as OrderData;
      expect(order.items[0].unitPrice).toBe(0);

      const stored = await rewardRedemptionsRepo.findOne({
        where: { id: specialRewardId },
      });
      expect(stored!.usedAt).not.toBeNull();
      expect(stored!.menuItemId).toBe(itemSpecialId);
    });
  });

  describe('Borrar un RewardMilestone no rompe premios ya otorgados con ese umbral (snapshot, no FK)', () => {
    it('crea un hito temporal, otorga un premio con él, lo borra y confirma que el premio sigue intacto', async () => {
      const temp = await request(app.getHttpServer())
        .post('/reward-milestones')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ starsRequired: 3 })
        .expect(201);
      const tempMilestoneId = (
        (temp.body as Envelope).data as RewardMilestoneData
      ).id;

      const { token, userId } = await register('milestone-borrado');
      const created = await createOrder(token, [
        { menuItemId: itemSmallId, quantity: 6 }, // 30 → 3 estrellas → hito temporal
      ]).expect(201);
      await deliverOrder(((created.body as Envelope).data as OrderData).id);

      let progress = await getProgress(token);
      const grantedId = progress.premiosDisponibles.find(
        (p) => !p.esEspecial,
      )!.id;

      await request(app.getHttpServer())
        .delete(`/reward-milestones/${tempMilestoneId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // El hito ya no existe, pero el premio otorgado (snapshot en milestoneStars) sigue ahí.
      const stillThere = await rewardRedemptionsRepo.findOne({
        where: { id: grantedId },
      });
      expect(stillThere).not.toBeNull();
      expect(stillThere!.milestoneStars).toBe(3);

      progress = await getProgress(token);
      expect(progress.premiosDisponibles.some((p) => p.id === grantedId)).toBe(
        true,
      );

      // recalculateForUser sigue funcionando sin el hito borrado (no revienta).
      await rewardsService.recalculateForUser(userId);
    });
  });

  describe('Distinción createdAt (multiplicador de promoción) vs deliveredAt (mes calendario)', () => {
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
      // 50 * 3 = 150 pesados / 10 = 15 estrellas → cruza los 3 hitos (5/8/15).
      expect(progress.estrellasDelMes).toBe(15);
      expect(progress.premiosDisponibles).toHaveLength(3);

      // La promoción vigente HOY no es esta (es de 2020): "promocionActiva"
      // (para mostrar al cliente) y el peso histórico del multiplicador son
      // cálculos independientes.
      expect(progress.promocionActiva).toBeNull();

      await starPromotionsRepo.update(promoId, { active: false });
    });
  });

  describe('PATCH /menu/items/:id — redeemableWithStars y specialReward', () => {
    it('permite activar ambos switches de forma independiente en un producto existente', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/menu/items/${itemMediumId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ redeemableWithStars: true })
        .expect(200);
      expect((res.body as Envelope).data as MenuItemData).toMatchObject({
        id: itemMediumId,
        redeemableWithStars: true,
        specialReward: false,
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

    it('PATCH parcial de otro campo no pisa redeemableWithStars/specialReward (merge, no Object.assign)', async () => {
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
            startDate: `${year}-04-15`,
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
            endDate: `${year}-04-01`,
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
