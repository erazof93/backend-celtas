import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';

/** Shared by runtime and migration CLI; the listener inherits these options. */
export function postgresTls(
  env: NodeJS.ProcessEnv = process.env,
): false | { rejectUnauthorized: true; ca?: string } {
  if (env.DB_SSL !== undefined && !['true', 'false'].includes(env.DB_SSL))
    throw new Error('DB_SSL debe ser true o false');
  const enabled =
    env.DB_SSL === undefined
      ? env.NODE_ENV === 'production'
      : env.DB_SSL === 'true';
  if (!enabled) {
    if (env.DB_SSL_CA_FILE !== undefined)
      throw new Error('DB_SSL_CA_FILE requiere SSL habilitado');
    return false;
  }
  if (env.DB_SSL_CA_FILE === undefined) return { rejectUnauthorized: true };
  try {
    const ca = readFileSync(env.DB_SSL_CA_FILE, 'utf8');
    const certificates = ca.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    );
    if (
      !certificates?.length ||
      ca
        .replace(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
          '',
        )
        .trim()
    )
      throw new Error('Invalid CA bundle');
    for (const certificate of certificates) new X509Certificate(certificate);
    return { rejectUnauthorized: true, ca };
  } catch {
    // Never include file contents, paths or underlying error details in logs.
    throw new Error('DB_SSL_CA_FILE no contiene una CA PEM legible y válida');
  }
}
