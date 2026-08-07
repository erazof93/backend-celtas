import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Banner } from './modules/banners/entities/banner.entity';
import { Coupon } from './modules/coupons/entities/coupon.entity';
import { Category } from './modules/menu/entities/category.entity';
import { MenuItem } from './modules/menu/entities/menu-item.entity';
import { OrderItem } from './modules/orders/entities/order-item.entity';
import { Order } from './modules/orders/entities/order.entity';
import { Setting } from './modules/settings/entities/setting.entity';
import { Address } from './modules/users/entities/address.entity';
import { User } from './modules/users/entities/user.entity';

/**
 * Lee una variable de entorno requerida y lanza un error claro si falta o está vacía.
 * El CLI de TypeORM corre fuera de Nest (sin ConfigService), así que este archivo
 * carga `.env` con dotenv y valida aquí mismo. Sin esta validación, pg defaultaría
 * a `localhost` con credenciales vacías y fallaría con un error confuso en vez de
 * decir qué variable falta.
 */
const env = (key: string): string => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(
      `Falta la variable de entorno requerida: ${key}. Revisa tu archivo .env (o las variables del entorno en Render).`,
    );
  }
  return value;
};

/**
 * DataSource para el CLI de TypeORM (generar/ejecutar migraciones).
 * Lee las variables de entorno directamente (no arranca Nest). La app en runtime
 * usa su propia conexión vía ConfigService en app.module.ts; este archivo es solo
 * para `typeorm migration:*`.
 *
 * SSL: en producción (Supabase) se exige SSL; en desarrollo (Postgres local/Docker)
 * no. Se controla con NODE_ENV.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env('DB_HOST'),
  port: parseInt(env('DB_PORT'), 10),
  username: env('DB_USERNAME'),
  password: env('DB_PASSWORD'),
  database: env('DB_DATABASE'),
  entities: [
    User,
    Address,
    Category,
    MenuItem,
    Order,
    OrderItem,
    Coupon,
    Banner,
    Setting,
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  // SSL: Supabase lo exige desde fuera de su red, el Postgres local de Docker no.
  // Por defecto: SSL solo cuando NODE_ENV=production. DB_SSL=true/false lo fuerza.
  ssl: (
    process.env.DB_SSL !== undefined
      ? process.env.DB_SSL === 'true'
      : process.env.NODE_ENV === 'production'
  )
    ? { rejectUnauthorized: false }
    : false,
});
