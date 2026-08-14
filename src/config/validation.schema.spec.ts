import * as Joi from 'joi';
import { validationSchema } from './validation.schema';

const completeEnv = {
  PORT: '3000',
  NODE_ENV: 'development',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'admin',
  DB_PASSWORD: 'admin',
  DB_DATABASE: 'celtas_db',
  JWT_SECRET: 'secret',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'refresh-secret',
  JWT_REFRESH_EXPIRES_IN: '7d',
  GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com',
  WHATSAPP_BUSINESS_NUMBER: '51999999999',
  CLOUDINARY_CLOUD_NAME: 'cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
  COUPON_THRESHOLD_AMOUNT: '50',
  COUPON_EXPIRATION_DAYS: '15',
  FIREBASE_PROJECT_ID: 'proyecto-test',
  FIREBASE_CLIENT_EMAIL: 'admin@test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n',
};

/** Devuelve una copia del env completo sin la variable indicada. */
function without(key: keyof typeof completeEnv): Record<string, string> {
  const clone = { ...completeEnv };
  delete clone[key];
  return clone;
}

describe('validationSchema (Módulo 0.5)', () => {
  it('acepta un .env completo', () => {
    const { error } = validationSchema.validate(completeEnv, {
      allowUnknown: true,
    });
    expect(error).toBeUndefined();
  });

  it('permite variables extra del entorno (allowUnknown)', () => {
    const { error } = validationSchema.validate(
      { ...completeEnv, PATH: '/usr/bin', HOME: '/root' },
      { allowUnknown: true },
    );
    expect(error).toBeUndefined();
  });

  it('falla si falta JWT_SECRET', () => {
    const { error } = validationSchema.validate(without('JWT_SECRET'), {
      allowUnknown: true,
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain('"JWT_SECRET" is required');
  });

  it('falla si falta DB_HOST', () => {
    const { error } = validationSchema.validate(without('DB_HOST'), {
      allowUnknown: true,
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain('"DB_HOST" is required');
  });

  it('falla si PORT no es un número de puerto válido', () => {
    const { error } = validationSchema.validate(
      { ...completeEnv, PORT: 'abc' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('"PORT"');
  });

  it('falla si NODE_ENV no es development/production/test', () => {
    const { error } = validationSchema.validate(
      { ...completeEnv, NODE_ENV: 'staging' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('"NODE_ENV"');
  });

  it('falla si una variable requerida está vacía (string vacío)', () => {
    const { error } = validationSchema.validate(
      { ...completeEnv, JWT_REFRESH_SECRET: '' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('"JWT_REFRESH_SECRET"');
  });

  it('falla si falta GOOGLE_CLIENT_ID (requerido con el login de Google)', () => {
    const { error } = validationSchema.validate(without('GOOGLE_CLIENT_ID'), {
      allowUnknown: true,
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain('"GOOGLE_CLIENT_ID" is required');
  });

  it('ALLOWED_ORIGINS es opcional y aplica el default de desarrollo local', () => {
    const { error, value } = validationSchema.validate(
      without('ALLOWED_ORIGINS'),
      { allowUnknown: true },
    ) as { error?: Joi.ValidationError; value: Record<string, string> };
    expect(error).toBeUndefined();
    expect(value.ALLOWED_ORIGINS).toBe('http://localhost:5173');
  });

  it('ALLOWED_ORIGINS acepta una lista separada por comas', () => {
    const { error, value } = validationSchema.validate(
      {
        ...completeEnv,
        ALLOWED_ORIGINS:
          'https://celtas-admin.vercel.app,https://celtas-app.flutter.app',
      },
      { allowUnknown: true },
    ) as { error?: Joi.ValidationError; value: Record<string, string> };
    expect(error).toBeUndefined();
    expect(value.ALLOWED_ORIGINS).toBe(
      'https://celtas-admin.vercel.app,https://celtas-app.flutter.app',
    );
  });

  it('AUTO_COUPON_DISCOUNT_TYPE/VALUE son opcionales y aplican el default de 10% (sin regresión)', () => {
    const { error, value } = validationSchema.validate(completeEnv, {
      allowUnknown: true,
    }) as { error?: Joi.ValidationError; value: Record<string, unknown> };
    expect(error).toBeUndefined();
    expect(value.AUTO_COUPON_DISCOUNT_TYPE).toBe('percentage');
    expect(value.AUTO_COUPON_DISCOUNT_VALUE).toBe(10);
  });

  it('falla si AUTO_COUPON_DISCOUNT_VALUE > 100 con tipo percentage (default o explícito)', () => {
    const { error } = validationSchema.validate(
      { ...completeEnv, AUTO_COUPON_DISCOUNT_VALUE: '150' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('"AUTO_COUPON_DISCOUNT_VALUE"');

    const explicit = validationSchema.validate(
      {
        ...completeEnv,
        AUTO_COUPON_DISCOUNT_TYPE: 'percentage',
        AUTO_COUPON_DISCOUNT_VALUE: '150',
      },
      { allowUnknown: true },
    );
    expect(explicit.error).toBeDefined();
  });

  it('permite AUTO_COUPON_DISCOUNT_VALUE > 100 con tipo fixed_amount (sin tope)', () => {
    const { error, value } = validationSchema.validate(
      {
        ...completeEnv,
        AUTO_COUPON_DISCOUNT_TYPE: 'fixed_amount',
        AUTO_COUPON_DISCOUNT_VALUE: '150',
      },
      { allowUnknown: true },
    ) as { error?: Joi.ValidationError; value: Record<string, unknown> };
    expect(error).toBeUndefined();
    expect(value.AUTO_COUPON_DISCOUNT_VALUE).toBe(150);
  });
});
