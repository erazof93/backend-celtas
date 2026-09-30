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
import { getMetadataStorage } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { CreateBannerDto } from './../src/modules/banners/dto/create-banner.dto';
import { UpdateBannerDto } from './../src/modules/banners/dto/update-banner.dto';
import { CreateBeverageDto } from './../src/modules/beverages/dto/create-beverage.dto';
import { UpdateBeverageDto } from './../src/modules/beverages/dto/update-beverage.dto';
import { CreateExtraPortionDto } from './../src/modules/extra-portions/dto/create-extra-portion.dto';
import { UpdateExtraPortionDto } from './../src/modules/extra-portions/dto/update-extra-portion.dto';
import { CreateCategoryDto } from './../src/modules/menu/dto/create-category.dto';
import { CreateMenuItemDto } from './../src/modules/menu/dto/create-menu-item.dto';
import { UpdateCategoryDto } from './../src/modules/menu/dto/update-category.dto';
import { UpdateMenuItemDto } from './../src/modules/menu/dto/update-menu-item.dto';
import { CreateRewardMilestoneDto } from './../src/modules/rewards/dto/create-reward-milestone.dto';
import { CreateStarPromotionDto } from './../src/modules/rewards/dto/create-star-promotion.dto';
import { UpdateRewardMilestoneDto } from './../src/modules/rewards/dto/update-reward-milestone.dto';
import { UpdateStarPromotionDto } from './../src/modules/rewards/dto/update-star-promotion.dto';
import { CreateSauceDto } from './../src/modules/sauces/dto/create-sauce.dto';
import { UpdateSauceDto } from './../src/modules/sauces/dto/update-sauce.dto';
import { CreateAddressDto } from './../src/modules/users/dto/create-address.dto';
import { UpdateAddressDto } from './../src/modules/users/dto/update-address.dto';
import { UpdateProfileDto } from './../src/modules/users/dto/update-profile.dto';
import {
  User,
  UserProvider,
  UserRole,
} from './../src/modules/users/entities/user.entity';

interface Envelope {
  data: { id: string; accessToken: string };
}

/** Todos los campos con validación del DTO (incluye los heredados vía PartialType). */
const dtoFields = (dto: new () => object): string[] => [
  ...new Set(
    getMetadataStorage()
      .getTargetValidationMetadatas(dto, '', true, false)
      .map((m) => m.propertyName),
  ),
];

/**
 * Guardia de la clase de bug "null en campo NOT NULL → 500": manda `null`
 * campo por campo a cada endpoint de escritura con body JSON y exige que
 * NINGUNO responda 500 (400 o 2xx según el campo acepte null o no). Los campos
 * salen de la metadata de class-validator, así que un campo nuevo agregado con
 * `@IsOptional()` sobre una columna NOT NULL rompe este test sin tocarlo.
 * Ver `IsOptionalNonNullable`.
 */
describe('null en campos de escritura nunca da 500 (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let usersRepo: Repository<User>;
  let adminToken: string;
  let clientToken: string;

  const suffix = Date.now();
  const adminEmail = `qa-null-admin-${suffix}@test.com`;
  const clientEmail = `qa-null-client-${suffix}@test.com`;
  const password = 'password123';
  const created: { table: string; id: string }[] = [];
  let seq = 0;
  const uniq = () => `${suffix}-${++seq}`;

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

    dataSource = app.get(DataSource);
    usersRepo = app.get<Repository<User>>(getRepositoryToken(User));
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: await bcrypt.hash(password, 10),
        fullName: 'Admin Null QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (login.body as Envelope).data.accessToken;
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: clientEmail, password, fullName: 'Cliente Null QA' })
      .expect(201);
    clientToken = (reg.body as Envelope).data.accessToken;
  });

  afterAll(async () => {
    // Orden inverso: productos antes que su categoría.
    for (const { table, id } of [...created].reverse()) {
      await dataSource.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
    }
    const users = await usersRepo.find({
      where: [{ email: adminEmail }, { email: clientEmail }],
    });
    for (const u of users) {
      await dataSource.query(`DELETE FROM "addresses" WHERE "userId" = $1`, [
        u.id,
      ]);
    }
    await usersRepo.delete({ email: adminEmail });
    await usersRepo.delete({ email: clientEmail });
    await app.close();
  });

  const send = (
    method: 'post' | 'patch',
    path: string,
    body: object,
    token: string,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const createBase = async (
    table: string,
    path: string,
    body: object,
    token: string,
  ) => {
    const res = await send('post', path, body, token).expect(201);
    const id = (res.body as Envelope).data.id;
    created.push({ table, id });
    return id;
  };

  /** Devuelve los "METHOD endpoint.campo" que respondieron 500. */
  const probe = async (opts: {
    label: string;
    table: string;
    path: string;
    base: () => object;
    createDto: new () => object;
    updateDto?: new () => object;
    token: string;
    patchPath?: (id: string) => string;
  }): Promise<string[]> => {
    const failures: string[] = [];
    for (const field of dtoFields(opts.createDto)) {
      const res = await send(
        'post',
        opts.path,
        { ...opts.base(), [field]: null },
        opts.token,
      );
      if (res.status === 201) {
        created.push({ table: opts.table, id: (res.body as Envelope).data.id });
      }
      if (res.status >= 500) failures.push(`POST ${opts.label}.${field}`);
    }
    if (opts.updateDto) {
      const id = await createBase(
        opts.table,
        opts.path,
        opts.base(),
        opts.token,
      );
      const patchPath = opts.patchPath?.(id) ?? `${opts.path}/${id}`;
      for (const field of dtoFields(opts.updateDto)) {
        const res = await send(
          'patch',
          patchPath,
          { [field]: null },
          opts.token,
        );
        if (res.status >= 500) failures.push(`PATCH ${opts.label}.${field}`);
      }
    }
    return failures;
  };

  it('menú, catálogos, banners, premios, direcciones y perfil', async () => {
    const categoryId = await createBase(
      'categories',
      '/menu/categories',
      { name: `Null cat ${uniq()}` },
      adminToken,
    );
    let stars = 800000 + (suffix % 1000) * 100;
    let year = 2300 + (suffix % 500);

    // Secuencial a propósito: los endpoints comparten BD y nombres únicos.
    const failures: string[] = [];
    const add = async (p: Promise<string[]>) => failures.push(...(await p));

    await add(
      probe({
        label: 'menu/categories',
        table: 'categories',
        path: '/menu/categories',
        base: () => ({ name: `Null cat ${uniq()}` }),
        createDto: CreateCategoryDto,
        updateDto: UpdateCategoryDto,
        token: adminToken,
      }),
    );
    await add(
      probe({
        label: 'menu/items',
        table: 'menu_items',
        path: '/menu/items',
        base: () => ({ name: `Null item ${uniq()}`, price: 10, categoryId }),
        createDto: CreateMenuItemDto,
        updateDto: UpdateMenuItemDto,
        token: adminToken,
      }),
    );
    for (const [label, table, path, createDto, updateDto, base] of [
      [
        'sauces',
        'sauces',
        '/sauces',
        CreateSauceDto,
        UpdateSauceDto,
        () => ({ name: `Null salsa ${uniq()}` }),
      ],
      [
        'beverages',
        'beverages',
        '/beverages',
        CreateBeverageDto,
        UpdateBeverageDto,
        () => ({ name: `Null beb ${uniq()}`, price: 3 }),
      ],
      [
        'extra-portions',
        'extra_portions',
        '/extra-portions',
        CreateExtraPortionDto,
        UpdateExtraPortionDto,
        () => ({ name: `Null extra ${uniq()}`, price: 3 }),
      ],
      [
        'banners',
        'banners',
        '/banners',
        CreateBannerDto,
        UpdateBannerDto,
        () => ({ title: `Null banner ${uniq()}` }),
      ],
      [
        'reward-milestones',
        'reward_milestones',
        '/reward-milestones',
        CreateRewardMilestoneDto,
        UpdateRewardMilestoneDto,
        () => ({ starsRequired: ++stars }),
      ],
      [
        'star-promotions',
        'star_promotions',
        '/star-promotions',
        CreateStarPromotionDto,
        UpdateStarPromotionDto,
        () => {
          year += 1;
          return {
            label: `Null promo ${uniq()}`,
            multiplier: 2,
            startDate: `${year}-01-01`,
            endDate: `${year}-01-02`,
          };
        },
      ],
    ] as const) {
      await add(
        probe({
          label,
          table,
          path,
          base,
          createDto,
          updateDto,
          token: adminToken,
        }),
      );
    }
    await add(
      probe({
        label: 'users/me/addresses',
        table: 'addresses',
        path: '/users/me/addresses',
        base: () => ({
          alias: `A ${uniq()}`,
          fullAddress: 'Av. Null 1',
          district: 'SJM',
        }),
        createDto: CreateAddressDto,
        updateDto: UpdateAddressDto,
        token: clientToken,
      }),
    );
    for (const field of dtoFields(UpdateProfileDto)) {
      const res = await send(
        'patch',
        '/users/me',
        { [field]: null },
        clientToken,
      );
      if (res.status >= 500) failures.push(`PATCH users/me.${field}`);
    }

    expect(failures).toEqual([]);
  });
});
