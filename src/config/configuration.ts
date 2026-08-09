/**
 * Configuración central de la aplicación.
 *
 * Se carga vía `ConfigModule.forRoot({ load: [configuration] })` y se lee con `ConfigService`.
 * La conexión a la base de datos se arma aquí leyendo variables sueltas (DB_HOST, DB_PORT, ...)
 * y NO una `DATABASE_URL` única, para que en el deploy solo cambie el `.env` y no el código.
 *
 * No hay defaults hardcodeados: la presencia y validez de cada variable la garantiza
 * `validation.schema.ts` (Joi) al arrancar. Este helper es una red de seguridad redundante.
 */
const env = (key: string): string => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Falta la variable de entorno requerida: ${key}`);
  }
  return value;
};

export default () => ({
  port: parseInt(env('PORT'), 10),
  nodeEnv: env('NODE_ENV'),
  // CORS: lista de orígenes permitidos (whitelist). Se lee de ALLOWED_ORIGINS
  // (separados por comas) con el mismo default que validation.schema.ts para
  // desarrollo local. Nunca se hardcodea el dominio de producción en el código.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  database: {
    host: env('DB_HOST'),
    port: parseInt(env('DB_PORT'), 10),
    username: env('DB_USERNAME'),
    password: env('DB_PASSWORD'),
    database: env('DB_DATABASE'),
  },
  jwt: {
    secret: env('JWT_SECRET'),
    expiresIn: env('JWT_EXPIRES_IN'),
    refreshSecret: env('JWT_REFRESH_SECRET'),
    refreshExpiresIn: env('JWT_REFRESH_EXPIRES_IN'),
  },
  google: {
    clientId: env('GOOGLE_CLIENT_ID'),
  },
  whatsapp: {
    // Opcional: el número vive en la tabla `settings`. Solo se usa como fallback
    // si la tabla está vacía. No lanza si falta (a diferencia de las requeridas).
    businessNumber: process.env.WHATSAPP_BUSINESS_NUMBER,
  },
  cloudinary: {
    cloudName: env('CLOUDINARY_CLOUD_NAME'),
    apiKey: env('CLOUDINARY_API_KEY'),
    apiSecret: env('CLOUDINARY_API_SECRET'),
  },
  coupons: {
    thresholdAmount: parseFloat(env('COUPON_THRESHOLD_AMOUNT')),
    expirationDays: parseInt(env('COUPON_EXPIRATION_DAYS'), 10),
  },
  firebase: {
    projectId: env('FIREBASE_PROJECT_ID'),
    clientEmail: env('FIREBASE_CLIENT_EMAIL'),
    // La clave privada llega con \n literales en el .env; el reemplazo por saltos
    // de línea reales se hace en NotificationsService al construir el credential.
    privateKey: env('FIREBASE_PRIVATE_KEY'),
  },
});
