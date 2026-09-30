import { ValidateIf } from 'class-validator';

/**
 * Como `@IsOptional()`, pero SOLO acepta que el campo se omita (`undefined`):
 * un `null` explícito sí pasa por el resto de validadores y se rechaza con 400.
 *
 * `@IsOptional()` salta la validación tanto con `undefined` como con `null`, así
 * que un `{ "price": null }` llegaba al service, `repository.merge`/`create` lo
 * copiaba (solo ignoran `undefined`) y Postgres lo rechazaba por NOT NULL → 500.
 * Usar en todo campo opcional cuya columna es NOT NULL. Para columnas nullable
 * donde `null` significa algo (ej. "quitar la imagen"), seguir con `@IsOptional()`.
 *
 * Ojo con los DTOs de update hechos con `PartialType`: por defecto le agrega
 * `@IsOptional()` a TODOS los campos, lo que vuelve a dejar pasar `null` (class-
 * validator salta si CUALQUIER condición da false). Usar siempre
 * `PartialType(Dto, { skipNullProperties: false })`, que en su lugar aplica este
 * mismo `ValidateIf`.
 */
export const IsOptionalNonNullable = () =>
  ValidateIf((_object: object, value: unknown) => value !== undefined);
