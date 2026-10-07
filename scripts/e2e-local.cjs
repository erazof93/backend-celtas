// Only DB credentials are read from the local environment; provider credentials
// are replaced with inert test values. This runner never drops databases.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const local = fs.existsSync('.env')
  ? parseEnv(fs.readFileSync('.env', 'utf8'))
  : {};
for (const key of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD']) {
  const value = process.env[key] ?? local[key];
  if (!value) throw new Error(`Missing ${key}`);
  process.env[key] = value;
}
// DB_DATABASE must be explicitly selected; never inherit it from .env.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_SSL: 'false',
  PORT: '0',
  JWT_SECRET: randomUUID(),
  JWT_REFRESH_SECRET: randomUUID(),
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  GOOGLE_CLIENT_ID: 'local-e2e',
  FIREBASE_PROJECT_ID: 'local-e2e',
  FIREBASE_CLIENT_EMAIL: 'e2e@test.local',
  FIREBASE_PRIVATE_KEY: 'inert-test-key',
  GEOAPIFY_API_KEY: 'local-e2e-dummy',
  CLOUDINARY_CLOUD_NAME: 'local-e2e',
  CLOUDINARY_API_KEY: 'local-e2e-dummy',
  CLOUDINARY_API_SECRET: 'local-e2e-dummy',
  WHATSAPP_BUSINESS_NUMBER: '51999999999',
});
if (process.env.DB_HOST === 'localhost') process.env.DB_HOST = '127.0.0.1';
// dotenv is already supplied by @nestjs/config; expose it to the existing CLI
// data-source import also under pnpm's isolated module layout.
process.env.NODE_PATH = path.dirname(
  path.dirname(
    require.resolve('dotenv/config', {
      paths: [path.dirname(require.resolve('@nestjs/config'))],
    }),
  ),
);
require('node:module').Module._initPaths();
require('ts-node/register/transpile-only');
const {
  assertDisposableEnvironment,
  assertDisposableDatabase,
  DISPOSABLE_DATABASE_MARKER,
} = require('../test/helpers/disposable-database');
assertDisposableEnvironment();
const db = process.env.DB_DATABASE;
const connection = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  ssl: false,
};

async function main() {
  const action = process.argv[2];
  if (!['prepare', 'run'].includes(action))
    throw new Error('Use prepare or run');
  console.log(
    JSON.stringify({
      database: db,
      host: connection.host,
      port: connection.port,
      local: true,
      disposable: true,
      production: false,
    }),
  );
  if (action === 'prepare') {
    const admin = new Client({ ...connection, database: 'postgres' });
    await admin.connect();
    try {
      const exists = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname=$1',
        [db],
      );
      if (exists.rowCount)
        throw new Error('Database already exists; prepare refuses reuse');
      await admin.query(`CREATE DATABASE "${db}"`);
      await admin.query(
        `COMMENT ON DATABASE "${db}" IS '${DISPOSABLE_DATABASE_MARKER}'`,
      );
    } finally {
      await admin.end();
    }
    const { AppDataSource } = require('../src/data-source');
    await AppDataSource.initialize();
    try {
      const applied = await AppDataSource.runMigrations();
      console.log(
        JSON.stringify({
          migrationsApplied: applied.length,
          names: applied.map((migration) => migration.name),
        }),
      );
    } finally {
      await AppDataSource.destroy();
    }
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('../src/app.module');
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
    await app.close();
    return;
  }
  const { AppDataSource } = require('../src/data-source');
  await AppDataSource.initialize();
  try {
    await assertDisposableDatabase(AppDataSource);
    // Hold a session lock on a dedicated connection while Jest runs. Do not
    // allow two copies of this procedure to mutate the same disposable DB.
    const owner = new Client({ ...connection, database: db });
    await owner.connect();
    try {
      const lock = await owner.query(
        'SELECT pg_try_advisory_lock(731942, 99) AS acquired',
      );
      if (!lock.rows[0].acquired)
        throw new Error('Another E2E runner owns this database');
      const before = await owner.query('SELECT * FROM settings ORDER BY key');
      const child = spawnSync(
        process.execPath,
        [
          'node_modules/jest/bin/jest.js',
          '--config',
          'test/jest-e2e.json',
          '--runInBand',
          ...process.argv.slice(3),
        ],
        {
          env: process.env,
          stdio: 'inherit',
        },
      );
      // Restore settings even after failed tests. Business fixtures must still
      // be cleaned by suites; the read-only preflight detects leftovers.
      await owner.query('BEGIN');
      try {
        await owner.query('DELETE FROM settings');
        for (const row of before.rows) {
          await owner.query(
            'INSERT INTO settings (id,key,value,description,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)',
            [
              row.id,
              row.key,
              row.value,
              row.description,
              row.createdAt,
              row.updatedAt,
            ],
          );
        }
        await owner.query('COMMIT');
      } catch (error) {
        await owner.query('ROLLBACK');
        throw error;
      }
      await assertDisposableDatabase(AppDataSource);
      console.log(
        'E2E settings restored; business tables empty; database retained',
      );
      process.exitCode = child.status ?? 1;
    } finally {
      await owner.end();
    }
  } finally {
    await AppDataSource.destroy();
  }
}
main().catch((error) => {
  // Do not print provider payloads, credentials or connection strings.
  console.error(`Local E2E failed: ${error.code ?? error.name}`);
  if (/^(E2E |Database |Missing |Use |Another )/.test(error.message ?? '')) {
    console.error(error.message);
  }
  process.exitCode = 1;
});
