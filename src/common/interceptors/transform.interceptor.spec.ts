import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();

  const mockExecutionContext = () =>
    ({ switchToHttp: () => ({}) }) as unknown as ExecutionContext;

  const runIntercept = (value: unknown) => {
    const handler: CallHandler = { handle: () => of(value) };
    return lastValueFrom(
      interceptor.intercept(mockExecutionContext(), handler),
    );
  };

  it('envuelve un valor plano en { success: true, data }', async () => {
    await expect(runIntercept({ app: 'Celtas API' })).resolves.toEqual({
      success: true,
      data: { app: 'Celtas API' },
    });
  });

  it('envuelve valores primitivos en { success: true, data }', async () => {
    await expect(runIntercept('hola')).resolves.toEqual({
      success: true,
      data: 'hola',
    });
    await expect(runIntercept(42)).resolves.toEqual({
      success: true,
      data: 42,
    });
  });

  it('no envuelve dos veces una respuesta que ya trae success', async () => {
    const alreadyWrapped = { success: true, data: { ok: 1 }, message: 'm' };
    await expect(runIntercept(alreadyWrapped)).resolves.toEqual(alreadyWrapped);
  });

  it('respeta una respuesta de error ya formateada con success false', async () => {
    const errorWrapped = { success: false, message: 'x', statusCode: 400 };
    await expect(runIntercept(errorWrapped)).resolves.toEqual(errorWrapped);
  });

  it('envuelve null y undefined en data', async () => {
    await expect(runIntercept(null)).resolves.toEqual({
      success: true,
      data: null,
    });
    await expect(runIntercept(undefined)).resolves.toEqual({
      success: true,
      data: undefined,
    });
  });

  it('no envuelve un objeto con success no-booleano (lo trata como dato)', async () => {
    const weird = { success: 'yes' as unknown, data: 1 };
    await expect(runIntercept(weird)).resolves.toEqual({
      success: true,
      data: weird,
    });
  });

  it('propaga errores del handler sin transformar', async () => {
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    await expect(
      lastValueFrom(interceptor.intercept(mockExecutionContext(), handler)),
    ).rejects.toThrow('boom');
  });
});
