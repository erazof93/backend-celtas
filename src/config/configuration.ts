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
});
