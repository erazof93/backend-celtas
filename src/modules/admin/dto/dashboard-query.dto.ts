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

/** Query de top-products: agrega `limit` al rango de fechas. */
export class TopProductsQueryDto extends DashboardQueryDto {
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
