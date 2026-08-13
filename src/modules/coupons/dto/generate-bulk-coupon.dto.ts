import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  Validate,
} from 'class-validator';
import { CouponDiscountType } from '../entities/coupon.entity';
import { IsPercentageWithinLimit } from './is-percentage-within-limit';

/**
 * Generación masiva de cupones para una campaña: un cupón individual (código
 * único random) por cada usuario con role `cliente` (los admins quedan fuera).
 */
export class GenerateBulkCouponDto {
  @ApiProperty({
    enum: CouponDiscountType,
    description: 'Tipo de descuento: porcentaje o monto fijo',
  })
  @IsEnum(CouponDiscountType, {
    message: 'discountType debe ser percentage o fixed_amount',
  })
  discountType: CouponDiscountType;

  @ApiProperty({
    example: 10,
    description:
      'Valor del descuento: % si es percentage, soles si es fixed_amount',
  })
  @IsNumber({}, { message: 'discountValue debe ser un número' })
  @IsPositive({ message: 'discountValue debe ser mayor a 0' })
  @Min(0.01, { message: 'discountValue debe ser mayor a 0' })
  @Validate(IsPercentageWithinLimit)
  discountValue: number;

  @ApiProperty({
    example: 'padre2026',
    description:
      'Etiqueta de campaña para agrupar/filtrar los cupones generados en masa. No es el código del cupón (ese se genera random por usuario).',
  })
  @IsString({ message: 'campaignName debe ser un texto' })
  @IsNotEmpty({ message: 'campaignName es requerido' })
  campaignName: string;

  @ApiPropertyOptional({
    example: 50,
    description:
      'Monto mínimo de compra (subtotal del pedido) para poder usar el cupón. Omitido o null = sin mínimo.',
  })
  @IsOptional()
  @IsNumber({}, { message: 'minPurchaseAmount debe ser un número' })
  @Min(0, { message: 'minPurchaseAmount no puede ser negativo' })
  minPurchaseAmount?: number;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.000Z',
    description:
      'Fecha de expiración de todos los cupones de la campaña (ISO 8601). Omitido = se calcula automático (hoy + días configurados).',
  })
  @IsOptional()
  @IsDateString({}, { message: 'expiresAt debe ser una fecha ISO 8601 válida' })
  expiresAt?: string;
}
