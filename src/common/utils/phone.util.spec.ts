import { normalizePhone } from './phone.util';

describe('normalizePhone', () => {
  it.each([
    // Perú: con o sin +51, con cualquier separador → siempre con 51.
    ['+51 999-555-123', '51999555123'],
    ['999555123', '51999555123'],
    ['999 555 123', '51999555123'],
    ['(999) 555-123', '51999555123'],
    ['0051 999 555 123', '51999555123'],
    // Formato ya guardado: re-enviarlo (ej. desde el perfil de la app) no falla.
    ['51999555123', '51999555123'],
    // Extranjeros con + o 00.
    ['+58 412 999 9999', '584129999999'],
    ['0058 412-999-9999', '584129999999'],
    ['+55 11 99999-9999', '5511999999999'],
    ['+1 (305) 555-0123', '13055550123'],
    ['  +34 612 34 56 78  ', '34612345678'],
  ])('%p → %p', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['null', null],
    ['undefined', undefined],
    ['letras', 'abc123'],
    ['letras mezcladas', '999-555-12a'],
    ['+ en el medio', '999+555123'],
    // Sin + ni 00 solo se acepta Perú: no se adivina el país.
    ['extranjero sin prefijo', '55 11 99999-9999'],
    ['peruano que no empieza en 9', '899555123'],
    ['peruano de 8 dígitos', '99955512'],
    ['fijo de Lima con +51', '+51 1 234 5678'],
    ['+51 con 10 dígitos', '+51 9995551234'],
    ['E.164 demasiado corto', '+58 412'],
    ['E.164 de más de 15 dígitos', '+58 4129999999999999'],
    ['código de país que empieza en 0', '+0412 999 9999'],
  ])('rechaza %s', (_label, input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
