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

  it('NO exige GOOGLE_CLIENT_ID (se agrega en el submódulo de Google)', () => {
    const { error } = validationSchema.validate(completeEnv, {
      allowUnknown: true,
    });
    expect(error).toBeUndefined();
    // Y si se pasa, no debe romper (allowUnknown) ni estar declarado como requerido.
    const { error: withGoogle } = validationSchema.validate(
      { ...completeEnv, GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' },
      { allowUnknown: true },
    );
    expect(withGoogle).toBeUndefined();
  });
});
