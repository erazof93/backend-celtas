import { ShutdownSignal } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

jest.mock('./app.module', () => ({ AppModule: class {} }));
jest.mock('@nestjs/core', () => ({
  NestFactory: { create: jest.fn() },
  Reflector: class {},
}));
jest.mock('@nestjs/swagger', () => ({
  DocumentBuilder: class {
    setTitle() {
      return this;
    }
    setDescription() {
      return this;
    }
    setVersion() {
      return this;
    }
    addBearerAuth() {
      return this;
    }
    build() {
      return {};
    }
  },
  SwaggerModule: { setup: jest.fn() },
}));

it('registers Nest shutdown hooks once before listening, without custom signal handlers', async () => {
  const app = {
    enableShutdownHooks: jest.fn(),
    get: jest.fn(() => ({ get: () => [] })),
    set: jest.fn(),
    enableCors: jest.fn(),
    useGlobalPipes: jest.fn(),
    useGlobalInterceptors: jest.fn(),
    useGlobalFilters: jest.fn(),
    listen: jest.fn().mockResolvedValue(undefined),
  };
  jest.spyOn(NestFactory, 'create').mockResolvedValue(app as never);
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    // Bootstrap is CommonJS in the repository's Jest/Nest configuration.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(app.enableShutdownHooks).toHaveBeenCalledWith([
      ShutdownSignal.SIGTERM,
      ShutdownSignal.SIGINT,
    ]);
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.enableShutdownHooks.mock.invocationCallOrder[0]).toBeLessThan(
      app.listen.mock.invocationCallOrder[0],
    );
  } finally {
    log.mockRestore();
  }
});
