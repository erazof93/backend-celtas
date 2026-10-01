import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Max,
  Min,
  Validate,
} from 'class-validator';
import {
  IsCalendarDateField,
  IsPeriodRange,
  IsReportRangeValid,
  MAX_REPORT_RANGE_DAYS,
} from './report-range.validators';

export enum ReportGroupBy {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export enum ReportChannel {
  ALL = 'all',
  APP = 'app',
  PHONE = 'phone',
}

/**
 * Rango de fechas obligatorio de los reportes (YYYY-MM-DD, días completos en
 * America/Lima). `startDate` <= `endDate` y como máximo 366 días.
 */
export class ReportRangeQueryDto {
  @ApiProperty({
    example: '2026-09-01',
    description: 'Fecha inicial (YYYY-MM-DD, America/Lima).',
  })
  @IsNotEmpty({ message: 'startDate es obligatorio' })
  @Validate(IsCalendarDateField)
  startDate: string;

  @ApiProperty({
    example: '2026-09-30',
    description: `Fecha final (YYYY-MM-DD, America/Lima). Máximo ${MAX_REPORT_RANGE_DAYS} días desde startDate.`,
  })
  @IsNotEmpty({ message: 'endDate es obligatorio' })
  @Validate(IsCalendarDateField)
  @Validate(IsReportRangeValid)
  endDate: string;
}

export class ReportSummaryQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({
    enum: ReportGroupBy,
    default: ReportGroupBy.DAY,
    description:
      'Agrupación de `data`: day, week (desde el lunes) o month (desde el día 1).',
  })
  @IsOptional()
  @IsEnum(ReportGroupBy, { message: 'groupBy debe ser day, week o month' })
  groupBy?: ReportGroupBy;
}

export class ReportTopProductsQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 50,
    type: 'integer',
    description: 'Cantidad máxima de productos (1-50).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un número entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(50, { message: 'limit no puede superar 50' })
  limit?: number;

  @ApiPropertyOptional({
    enum: ReportChannel,
    default: ReportChannel.ALL,
    description:
      'Canal: all, app (POST /orders) o phone (cargados desde el panel).',
  })
  @IsOptional()
  @IsEnum(ReportChannel, { message: 'channel debe ser all, app o phone' })
  channel?: ReportChannel;
}

export class ReportDailyMetricsQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({
    example: true,
    default: false,
    description:
      'Agrega deliveredOrders/pendingOrders/cancelledOrders: pedidos CREADOS ese día según su estado actual.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'includeStatus debe ser true o false' })
  includeStatus?: boolean;
}

export class ReportComparisonQueryDto {
  @ApiProperty({
    example: '2026-09-01:2026-09-30',
    description: 'Período actual: YYYY-MM-DD:YYYY-MM-DD (America/Lima).',
  })
  @IsNotEmpty({ message: 'current es obligatorio' })
  @Validate(IsPeriodRange)
  current: string;

  @ApiProperty({
    example: '2026-08-01:2026-08-31',
    description:
      'Período de comparación: YYYY-MM-DD:YYYY-MM-DD (America/Lima).',
  })
  @IsNotEmpty({ message: 'previous es obligatorio' })
  @Validate(IsPeriodRange)
  previous: string;
}
