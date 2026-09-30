/** Solo dígitos, espacios, guiones, paréntesis, puntos y un "+" inicial. */
const ALLOWED_PHONE_CHARS = /^\+?[\d\s\-().]+$/;
/** E.164 sin "+": código de país (no empieza en 0) + número, 8 a 15 dígitos en total. */
const E164_DIGITS = /^[1-9]\d{7,14}$/;
/** Celular peruano con código de país: 51 + 9 dígitos que empiezan en 9. */
const PERU_MOBILE_E164 = /^519\d{8}$/;

/**
 * Normaliza un celular al formato que espera wa.me y que se guarda en la BD:
 * dígitos con código de país, sin "+" ni separadores (E.164 sin "+").
 *
 * - Con "+" o "00" → internacional: "+58 412 999 9999" → "584129999999".
 * - Sin prefijo → SOLO Perú (no se adivina el país): "987 654 321" → "51987654321".
 *   Un número extranjero sin "+"/"00" es ambiguo y devuelve null.
 * - "51987654321" sin "+" se acepta tal cual: es el formato ya guardado, así que
 *   re-enviar el valor que devuelve la API (ej. el perfil de la app) no falla.
 * - +51 solo acepta celulares (WhatsApp no aplica a fijos): "+51 1 234 5678" → null.
 *
 * Devuelve null si no es normalizable (letras, longitud fuera de E.164, etc.).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || !ALLOWED_PHONE_CHARS.test(trimmed)) return null;

  const compact = trimmed.replace(/[\s\-().]/g, '');
  let international: string | null = null;
  if (compact.startsWith('+')) {
    international = compact.slice(1);
  } else if (compact.startsWith('00')) {
    international = compact.slice(2);
  }

  if (international === null) {
    if (/^9\d{8}$/.test(compact)) return `51${compact}`;
    if (PERU_MOBILE_E164.test(compact)) return compact;
    return null;
  }

  if (!E164_DIGITS.test(international)) return null;
  if (international.startsWith('51') && !PERU_MOBILE_E164.test(international)) {
    return null;
  }
  return international;
}

/** Mensaje único para cualquier teléfono que no pasa `normalizePhone`. */
export const INVALID_PHONE_MESSAGE =
  'Celular inválido: 9 dígitos si es peruano (ej. 987654321) o con + y código de país si es extranjero (ej. +58 412 999 9999)';
