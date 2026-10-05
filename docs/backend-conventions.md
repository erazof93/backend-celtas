# Convenciones del backend

Consultar al cambiar DTOs, entidades, controllers o respuestas. El código existente
es la referencia; las reglas de negocio están en [business-rules.md](business-rules.md).

## Organización y contrato

- Módulos en `src/modules/<dominio>/`: module, controller, service, `dto/` y
  `entities/` cuando corresponda. Unitarios junto al código; e2e en `test/`.
- Controllers manejan HTTP y Swagger; services contienen negocio y persistencia.
  No introducir capas nuevas solo para uniformar carpetas.
- Configuración runtime: `src/config/configuration.ts`, validada por Joi en
  `validation.schema.ts`. CLI de TypeORM separado en `src/data-source.ts`.
- `main.ts` aplica ValidationPipe con whitelist, forbidNonWhitelisted y transform.
  Los campos adicionales se rechazan; no dependa el contrato de eliminarlos silenciosamente.
- Éxito: `{ success: true, data, message? }`; errores:
  `{ success: false, message, statusCode }`. El interceptor respeta objetos con
  `success` booleano. El filtro une mensajes de validación y oculta errores internos.
- ClassSerializerInterceptor aplica `@Exclude()` al password de User. Un objeto
  plano o resultado SQL no adquiere automáticamente las exclusiones de la entidad.
- Documentar tags, operaciones, respuestas relevantes y bearer en Swagger.
  La configuración de bootstrap no se aplica automáticamente a apps creadas por tests.

## DTOs y actualizaciones

- Usar class-validator y class-transformer; mensajes de validación en español.
- Validaciones cruzadas: clases `ValidatorConstraintInterface` con `@Validate(Clase)`.
  No usar callbacks inline como argumento de `@Validate`.
- Omitido (`undefined`) y `null` no son equivalentes. Para opcionales cuya columna
  es NOT NULL, usar `IsOptionalNonNullable`. En updates derivados usar
  `PartialType(Dto, { skipNullProperties: false })` cuando deba rechazarse null.
- PATCH de entidades cargadas: `repository.merge(entity, dto)` o comprobaciones
  explícitas `!== undefined`. Evitar Object.assign/spread del DTO sobre la entidad:
  los campos de clase ES2023 pueden sobrescribir datos con undefined.
- `repository.create({ ...dto })` al crear es válido. Mocks de merge deben ignorar undefined.
- Mantener límites coherentes con tipos SQL, precisión y escala; no asumir que
  todos los DTOs actuales ya cubren todos los límites de persistencia.

## Fechas y valores

- Instantes persistidos con `timestamptz`, incluyendo CreateDateColumn y UpdateDateColumn.
  `date` corresponde a fechas calendario sin hora cuando ese sea el modelo.
- Para días de negocio usar `common/utils/lima-time.util.ts` y America/Lima;
  no depender de la zona horaria del proceso. Conservar límites inclusivos/exclusivos de cada contrato.
- Decimales monetarios existentes usan precision/scale y transformers para exponer números.
  Los totales se calculan en backend con los redondeos actuales.
- Reutilizar normalización de teléfonos y utilidades geográficas existentes.
- Si se identifica un patrón de bug repetido, buscar ocurrencias relacionadas;
  no ampliar correcciones fuera del alcance sin explicar su necesidad.
