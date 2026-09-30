/**
 * Normaliza un celular peruano al formato que espera wa.me: dígitos con código de
 * país, sin "+" ni espacios (ej. "987 654 321" / "+51 987-654-321" → "51987654321").
 * Devuelve null si no es un celular peruano (9 dígitos que empiezan en 9).
 */
export function normalizePeruMobile(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (/^9\d{8}$/.test(digits)) return `51${digits}`;
  if (/^519\d{8}$/.test(digits)) return digits;
  return null;
}
