import * as Joi from 'joi';

/**
 * Schema de validación de variables de entorno.
 *
 * Se conecta en `ConfigModule.forRoot({ validationSchema })`. Si falta o está vacía
 * cualquier variable requerida, la app FALLA al arrancar con un error claro (no arranca
 * con defaults silenciosos). `@nestjs/config` valida con `allowUnknown: true`, así que
 * variables extra del entorno (PATH, HOME, etc.) no rompen la validación.
 */
export const validationSchema = Joi.object({
  // App
  PORT: Joi.number().port().required(),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  // Base de datos
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),
  // SSL de la conexión a Postgres. Opcional: por defecto se activa solo en producción
  // (Supabase lo exige). DB_SSL=true/false lo fuerza (ej. probar el build de producción
  // contra un Postgres local sin SSL).
  DB_SSL: Joi.string().valid('true', 'false').optional(),

  // Auth (se declaran ya para que el módulo Auth las use sin fallback hardcodeado)
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().required(),

  // Google OAuth (login con Google)
  GOOGLE_CLIENT_ID: Joi.string().required(),

  // WhatsApp (link de confirmación de pedidos)
  // Ya no es obligatoria: el número vive en la tabla `settings` (key
  // whatsapp_business_number). Se deja opcional como fallback si la tabla está vacía.
  WHATSAPP_BUSINESS_NUMBER: Joi.string().optional(),

  // Cloudinary (subida de imágenes del menú)
  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  // Cupones automáticos (módulo Coupons)
  COUPON_THRESHOLD_AMOUNT: Joi.number().positive().required(),
  COUPON_EXPIRATION_DAYS: Joi.number().integer().positive().required(),

  // Firebase Cloud Messaging (módulo Notifications)
  // Service account de Firebase: Project Settings > Service accounts > Generate new private key.
  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().required(),
});
