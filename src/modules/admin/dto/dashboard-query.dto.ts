import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  Validate,
} from 'class-validator';
import { IsDateRangeValid } from './is-date-range-valid';
import { IsDaysExclusiveWithRange } from './is-days-exclusive-with-range';

/**
 * Rango de fechas del dashboard. Formato YYYY-MM-DD. Si no se pasan, se usa "hoy"
 * en la zona horaria de Lima (America/Lima). El rango se interpreta como el día
 * completo en Lima (00:00:00.000 a 23:59:59.999).
 */
export class DashboardQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Fecha inicial (YYYY-MM-DD). Default: hoy en America/Lima.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from debe tener formato YYYY-MM-DD',
  })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description: 'Fecha final (YYYY-MM-DD). Default: hoy en America/Lima.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to debe tener formato YYYY-MM-DD',
  })
  // El rango no puede venir invertido: from debe ser <= to (400, no resultado vacío).
  @Validate(IsDateRangeValid)
  to?: string;
}

/** Query de top-products: agrega `limit` (y `days` como atajo) al rango de fechas. */
export class TopProductsQueryDto extends DashboardQueryDto {
  @ApiPropertyOptional({
    example: 7,
    minimum: 1,
    maximum: 90,
    description:
      'Atajo: últimos N días incluyendo hoy, en America/Lima (1-90). No se combina con from/to.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days debe ser un número entero' })
  @Min(1, { message: 'days debe ser al menos 1' })
  @Max(90, { message: 'days no puede superar 90' })
  @Validate(IsDaysExclusiveWithRange)
  days?: number;

  @ApiPropertyOptional({
    example: 10,
    default: 10,
    description: 'Cantidad máxima de productos a devolver (1-50).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un número entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(50, { message: 'limit no puede superar 50' })
  limit?: number;
}

/** Query de las series diarias (revenue-trend, new-customers). */
export class DaysQueryDto {
  @ApiPropertyOptional({
    example: 7,
    minimum: 1,
    maximum: 90,
    default: 7,
    description:
      'Cantidad de días hacia atrás, incluyendo hoy, en America/Lima (1-90).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days debe ser un número entero' })
  @Min(1, { message: 'days debe ser al menos 1' })
  @Max(90, { message: 'days no puede superar 90' })
  days?: number;
}
