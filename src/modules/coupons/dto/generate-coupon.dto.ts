import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  Min,
  Validate,
} from 'class-validator';
import {
  CouponDiscountType,
  MAX_COUPON_AMOUNT,
} from '../entities/coupon.entity';
import { IsPercentageWithinLimit } from './is-percentage-within-limit';

/** Generación manual de un cupón desde el panel admin (campañas puntuales). */
export class GenerateCouponDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'UUID del usuario al que se le otorga el cupón',
  })
  @IsUUID('4', { message: 'userId debe ser un UUID válido' })
  userId: string;

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
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'discountValue debe ser un número con hasta 2 decimales' },
  )
  @IsPositive({ message: 'discountValue debe ser mayor a 0' })
  @Min(0.01, { message: 'discountValue debe ser mayor a 0' })
  @Max(MAX_COUPON_AMOUNT, {
    message: `discountValue no puede superar ${MAX_COUPON_AMOUNT}`,
  })
  // Un fixed_amount puede superar 100 (ej. S/150); el % no puede pasar de 100.
  @Validate(IsPercentageWithinLimit)
  discountValue: number;

  @ApiPropertyOptional({
    example: 50,
    description:
      'Monto mínimo de compra (subtotal del pedido) para poder usar el cupón. Omitido o null = sin mínimo. Pensado para campañas manuales.',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'minPurchaseAmount debe ser un número con hasta 2 decimales' },
  )
  @Min(0, { message: 'minPurchaseAmount no puede ser negativo' })
  @Max(MAX_COUPON_AMOUNT, {
    message: `minPurchaseAmount no puede superar ${MAX_COUPON_AMOUNT}`,
  })
  minPurchaseAmount?: number;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.000Z',
    description:
      'Fecha de expiración del cupón (ISO 8601). Omitido = se calcula automático (hoy + días configurados).',
  })
  @IsOptional()
  @IsDateString({}, { message: 'expiresAt debe ser una fecha ISO 8601 válida' })
  expiresAt?: string;
}
