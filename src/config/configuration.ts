/**
 * Configuración central de la aplicación.
 *
 * Se carga vía `ConfigModule.forRoot({ load: [configuration] })` y se lee con `ConfigService`.
 * La conexión a la base de datos se arma aquí leyendo variables sueltas (DB_HOST, DB_PORT, ...)
 * y NO una `DATABASE_URL` única, para que en el deploy solo cambie el `.env` y no el código.
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'admin',
    password: process.env.DB_PASSWORD ?? 'admin',
    database: process.env.DB_DATABASE ?? 'celtas_db',
  },
  jwt: {
    secret:
      process.env.JWT_SECRET ?? 'cambia_esto_por_un_secreto_largo_y_random',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ?? 'cambia_esto_tambien_por_otro_secreto',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
});
