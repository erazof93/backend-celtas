import * as Joi from 'joi';

/**
 * Schema de validación de variables de entorno.
 *
 * Se conecta en `ConfigModule.forRoot({ validationSchema })`. Si falta o está vacía
 * cualquier variable requerida, la app FALLA al arrancar con un error claro (no arranca
 * con defaults silenciosos). `@nestjs/config` valida con `allowUnknown: true`, así que
 * variables extra del entorno (PATH, HOME, etc.) no rompen la validación.
 *
 * `GOOGLE_CLIENT_ID` se agrega cuando lleguemos al submódulo de Google en Auth.
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

  // Auth (se declaran ya para que el módulo Auth las use sin fallback hardcodeado)
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().required(),
});
