import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';

/**
 * Guard de regresión de zona horaria (ROADMAP 8.3): toda columna de fecha de
 * toda entidad debe ser `timestamptz` (o `date` para fechas calendario sin hora).
 *
 * Con `timestamp` SIN zona, pg serializa los Date con la zona del proceso Node y
 * Postgres ignora el offset: con Node en Lima todo queda corrido 5 horas. Este
 * test no depende de la BD ni de la zona de Node, así que falla en cualquier
 * máquina si alguien agrega un `@CreateDateColumn()` / `@Column() fecha: Date`
 * sin `type: 'timestamptz'`.
 */
const findEntityFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return findEntityFiles(full);
    return name.endsWith('.entity.ts') ? [full] : [];
  });

describe('Entidades: columnas de fecha con zona horaria', () => {
  const entityFiles = findEntityFiles(join(__dirname, 'modules'));
  for (const file of entityFiles) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(file);
  }

  const dateColumns = getMetadataArgsStorage().columns.filter((column) => {
    if (column.mode === 'createDate' || column.mode === 'updateDate') {
      return true;
    }
    const target = column.target as { prototype?: object };
    if (!target.prototype) return false;
    return (
      Reflect.getMetadata(
        'design:type',
        target.prototype,
        column.propertyName,
      ) === Date
    );
  });

  it('encuentra las entidades y sus columnas de fecha', () => {
    expect(entityFiles.length).toBeGreaterThanOrEqual(17);
    // 32 createdAt/updatedAt + fechas de negocio (deliveredAt, expiresAt, ...).
    expect(dateColumns.length).toBeGreaterThanOrEqual(32);
  });

  it('ninguna columna de fecha es `timestamp` sin zona', () => {
    const offenders = dateColumns
      .filter(
        (column) =>
          column.options.type !== 'timestamptz' &&
          column.options.type !== 'date',
      )
      .map(
        (column) =>
          `${(column.target as { name: string }).name}.${column.propertyName} (type: ${String(column.options.type ?? 'por defecto')})`,
      );
    expect(offenders).toEqual([]);
  });
});
