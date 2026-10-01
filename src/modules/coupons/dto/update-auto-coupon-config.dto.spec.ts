import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAutoCouponConfigDto } from './update-auto-coupon-config.dto';

/** Propiedades que fallan la validación (vacío = DTO válido). */
const failingFields = async (payload: object): Promise<string[]> => {
  const dto = plainToInstance(UpdateAutoCouponConfigDto, payload);
  const errors = await validate(dto);
  return errors.map((error) => error.property);
};

describe('UpdateAutoCouponConfigDto', () => {
  const valid = {
    discountType: 'percentage',
    discountValue: 10,
    thresholdAmount: 50,
    expirationDays: 15,
  };

  it('acepta una configuración válida', async () => {
    expect(await failingFields(valid)).toEqual([]);
  });

  it('rechaza percentage 150 (no puede superar 100)', async () => {
    expect(await failingFields({ ...valid, discountValue: 150 })).toEqual([
      'discountValue',
    ]);
  });

  it('acepta percentage exactamente 100', async () => {
    expect(await failingFields({ ...valid, discountValue: 100 })).toEqual([]);
  });

  it('acepta fixed_amount 150 (monto fijo sin tope)', async () => {
    expect(
      await failingFields({
        ...valid,
        discountType: 'fixed_amount',
        discountValue: 150,
      }),
    ).toEqual([]);
  });

  it('rechaza un tipo de descuento desconocido', async () => {
    expect(await failingFields({ ...valid, discountType: 'FIXED' })).toEqual([
      'discountType',
    ]);
  });

  it('rechaza discountValue 0', async () => {
    expect(await failingFields({ ...valid, discountValue: 0 })).toEqual([
      'discountValue',
    ]);
  });

  it('rechaza thresholdAmount -10', async () => {
    expect(await failingFields({ ...valid, thresholdAmount: -10 })).toEqual([
      'thresholdAmount',
    ]);
  });

  it('rechaza expirationDays 0', async () => {
    expect(await failingFields({ ...valid, expirationDays: 0 })).toEqual([
      'expirationDays',
    ]);
  });

  it('acepta expirationDays 1', async () => {
    expect(await failingFields({ ...valid, expirationDays: 1 })).toEqual([]);
  });

  it('rechaza expirationDays no entero (2.5)', async () => {
    expect(await failingFields({ ...valid, expirationDays: 2.5 })).toEqual([
      'expirationDays',
    ]);
  });

  // Regresión (auditoría @tester): sin tope, el PUT respondía 200 y luego la
  // generación automática fallaba en silencio (Invalid Date / numeric overflow).
  it('acepta expirationDays 365 (tope)', async () => {
    expect(await failingFields({ ...valid, expirationDays: 365 })).toEqual([]);
  });

  it.each([366, 100000000])('rechaza expirationDays %d', async (days) => {
    expect(await failingFields({ ...valid, expirationDays: days })).toEqual([
      'expirationDays',
    ]);
  });

  it('acepta fixed_amount 99999999.99 (máximo de decimal(10,2))', async () => {
    expect(
      await failingFields({
        ...valid,
        discountType: 'fixed_amount',
        discountValue: 99999999.99,
      }),
    ).toEqual([]);
  });

  it('rechaza fixed_amount 1000000000 (no entra en decimal(10,2))', async () => {
    expect(
      await failingFields({
        ...valid,
        discountType: 'fixed_amount',
        discountValue: 1000000000,
      }),
    ).toEqual(['discountValue']);
  });

  it('rechaza discountValue con más de 2 decimales (10.555)', async () => {
    expect(
      await failingFields({
        ...valid,
        discountType: 'fixed_amount',
        discountValue: 10.555,
      }),
    ).toEqual(['discountValue']);
  });

  it.each([1000000000, 50.123])(
    'rechaza thresholdAmount %d',
    async (thresholdAmount) => {
      expect(await failingFields({ ...valid, thresholdAmount })).toEqual([
        'thresholdAmount',
      ]);
    },
  );

  it('los 4 campos son obligatorios (PUT reemplaza todo)', async () => {
    expect((await failingFields({})).sort()).toEqual([
      'discountType',
      'discountValue',
      'expirationDays',
      'thresholdAmount',
    ]);
  });
});
