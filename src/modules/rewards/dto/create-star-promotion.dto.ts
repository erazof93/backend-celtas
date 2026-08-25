import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
} from 'class-validator';
import { IsStarPromotionDateRangeValid } from './is-star-promotion-date-range-valid';

/**
 * Crear una promoción de estrellas (admin). El rango de fechas es calendario
 * (sin hora, formato YYYY-MM-DD) y se evalúa contra `order.createdAt` de cada
 * pedido (día de la compra) en hora de Lima.
 */
export class CreateStarPromotionDto {
  @ApiProperty({
    example: 'Navidad 2026',
    description:
      'Texto interno para identificar la promoción (no se muestra al cliente)',
  })
  @IsString({ message: 'label debe ser texto' })
  @IsNotEmpty({ message: 'label es obligatorio' })
  label: string;

  @ApiProperty({
    example: 2,
    description:
      'Multiplicador de estrellas durante la promoción (ej. 2 = estrellas dobles)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'multiplier debe ser un número con hasta 2 decimales' },
  )
  @Min(0.01, { message: 'multiplier debe ser mayor a 0' })
  @Max(99.99, { message: 'multiplier no puede superar 99.99' })
  multiplier: number;

  @ApiProperty({
    example: '2026-12-20',
    description:
      'Fecha de inicio de vigencia (YYYY-MM-DD, calendario, sin hora)',
  })
  @IsDateString(
    {},
    { message: 'startDate debe ser una fecha válida (YYYY-MM-DD)' },
  )
  startDate: string;

  @ApiProperty({
    example: '2026-12-31',
    description:
      'Fecha de fin de vigencia (YYYY-MM-DD, calendario, sin hora, inclusive)',
  })
  @IsDateString(
    {},
    { message: 'endDate debe ser una fecha válida (YYYY-MM-DD)' },
  )
  // Si vienen ambas fechas, startDate debe ser anterior o igual a endDate.
  @Validate(IsStarPromotionDateRangeValid)
  endDate: string;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Si la promoción está habilitada',
  })
  @IsOptional()
  @IsBoolean({ message: 'active debe ser true o false' })
  active?: boolean;
}
