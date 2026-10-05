# Base de datos y migraciones

Consultar para cambios de esquema o recuperación de una BD existente.

## Configuración vigente

- Migraciones: `src/migrations/`. CLI: `src/data-source.ts`; entidades enumeradas explícitamente.
- Runtime: TypeOrmModule.forRootAsync en app.module.ts con ConfigService y autoLoadEntities.
- Ambas conexiones usan DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD y DB_DATABASE.
  synchronize permanece false, también en desarrollo.
- SSL depende de NODE_ENV=production salvo override DB_SSL; conservar coherencia runtime/CLI.
- Postgres local usa el servicio postgres de docker-compose y las variables DB_*.

## Cambio de esquema

1. Identificar una BD local/de prueba y comprobar que sus migraciones estén al día.
2. Cambiar la entidad; registrar entidades nuevas también en el DataSource del CLI.
3. Generar: `pnpm run migration:generate src/migrations/NombreDescriptivo`.
4. Revisar SQL, nombres, datos afectados, índices, constraints y down.
5. Aplicar con `pnpm run migration:run` y verificar esquema y comportamiento real.
6. Revisar rollback con datos de prueba cuando sea viable. `migration:revert` modifica
   la BD y revierte la última migración; no es una operación inocua.
7. Entregar entidad y migración juntas para revisión. Git/deploy requieren autorización específica.

La generación escribe archivos; run/revert escriben datos. No ejecutarlos en una
tarea de solo lectura ni contra una conexión cuya finalidad no esté identificada.
Si no hay diff tras un cambio esperado, revisar conexión, entidades registradas,
schema y estado de migraciones; no asumir una causa única ni activar synchronize.

## Preservar datos

- Para conversiones de tipo revisar si el generador produce DROP/ADD. Usar una
  migración manual con ALTER ... USING cuando sea necesario preservar valores.
- Referencia: TimestampsToTimestamptz convierte fechas existentes sin recrear columnas.
  La interpretación de timestamps previos debe comprobarse con datos y su zona original.
- No reescribir migraciones ya aplicadas para adaptar documentación.
- Probar constraints, índices y FKs, además del arranque; snapshot antes/después
  cuando exista riesgo de pérdida o reinterpretación de datos.

## Recuperación y despliegue

El README anterior describía una BD local creada con synchronize sin registro de
migraciones. Es un incidente histórico, no el procedimiento para instalaciones nuevas.
No insertar marcas de “ejecutada” sin comparar todo el esquema, obtener backup y
acordar una reconciliación específica. Para BD vacía aplicar la cadena de migraciones.

El historial describe Render/Supabase con migraciones encadenadas al arranque.
No hay manifiesto de Render en el repositorio que permita confirmar la configuración
actual del servicio: verificarla con el desarrollador antes de un despliegue.
