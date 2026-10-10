import { rootCertificates } from 'node:tls';
import { readFileSync } from 'node:fs';
import { postgresTls } from './postgres-tls';

jest.mock('node:fs', () => ({ readFileSync: jest.fn() }));

describe('PostgreSQL TLS policy', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each(['development', 'test'])(
    'preserves local %s defaults',
    (NODE_ENV) => {
      expect(postgresTls({ NODE_ENV })).toBe(false);
    },
  );
  it('verifies the server by default in production using platform trust', () => {
    expect(postgresTls({ NODE_ENV: 'production' })).toEqual({
      rejectUnauthorized: true,
    });
  });
  it('supports explicit SSL without weakening validation', () => {
    expect(postgresTls({ NODE_ENV: 'test', DB_SSL: 'true' })).toEqual({
      rejectUnauthorized: true,
    });
    expect(postgresTls({ NODE_ENV: 'production', DB_SSL: 'false' })).toBe(
      false,
    );
  });
  it('loads a valid public CA bundle from an external file', () => {
    const ca = rootCertificates.slice(0, 2).join('\n');
    jest.mocked(readFileSync).mockReturnValue(ca);
    expect(
      postgresTls({ DB_SSL: 'true', DB_SSL_CA_FILE: 'external-ca.pem' }),
    ).toEqual({
      rejectUnauthorized: true,
      ca,
    });
  });
  it.each(['', 'not a certificate', '-----BEGIN PRIVATE KEY-----private'])(
    'rejects invalid CA input without leaking it',
    (ca) => {
      jest.mocked(readFileSync).mockReturnValue(ca);
      expect(() =>
        postgresTls({ DB_SSL: 'true', DB_SSL_CA_FILE: 'external' }),
      ).toThrow('DB_SSL_CA_FILE no contiene una CA PEM legible y válida');
    },
  );
  it('fails closed on unreadable CA without leaking path or original error', () => {
    jest.mocked(readFileSync).mockImplementation(() => {
      throw new Error('private details');
    });
    expect(() =>
      postgresTls({ DB_SSL: 'true', DB_SSL_CA_FILE: 'private-path' }),
    ).toThrow('DB_SSL_CA_FILE no contiene una CA PEM legible y válida');
  });
  it('rejects ambiguous flags and contradictory CA configuration', () => {
    expect(() => postgresTls({ DB_SSL: 'TRUE' })).toThrow(
      'DB_SSL debe ser true o false',
    );
    expect(() =>
      postgresTls({ NODE_ENV: 'test', DB_SSL_CA_FILE: 'ca' }),
    ).toThrow('DB_SSL_CA_FILE requiere SSL habilitado');
  });
});
