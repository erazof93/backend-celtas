import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsPositive,
  Max,
  Min,
  Validate,
} from 'class-validator';
import {
  CouponDiscountType,
  MAX_AUTO_COUPON_EXPIRATION_DAYS,
  MAX_COUPON_AMOUNT,
} from '../entities/coupon.entity';
import { IsPercentageWithinLimit } from './is-percentage-within-limit';

/**
 * Reemplaza (PUT) la configuración completa de los cupones automáticos. Los 4
 * campos son obligatorios y se validan en conjunto: un `percentage` no puede
 * superar 100, un `fixed_amount` sí (monto en soles). Todos tienen tope: un
 * valor fuera de rango no rompe el PUT sino la generación posterior, que falla
 * en silencio (ver MAX_COUPON_AMOUNT / MAX_AUTO_COUPON_EXPIRATION_DAYS).
 */
export class UpdateAutoCouponConfigDto {
  @ApiProperty({
    enum: CouponDiscountType,
    example: CouponDiscountType.PERCENTAGE,
    description: 'Tipo de descuento del cupón automático',
  })
  @IsEnum(CouponDiscountType, {
    message: 'discountType debe ser percentage o fixed_amount',
  })
  discountType: CouponDiscountType;

  @ApiProperty({
    example: 10,
    maximum: MAX_COUPON_AMOUNT,
    description:
      'Valor del descuento (hasta 2 decimales): porcentaje (máx. 100) si es percentage, monto en soles si es fixed_amount',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'discountValue debe ser un número con hasta 2 decimales' },
  )
  @IsPositive({ message: 'discountValue debe ser mayor a 0' })
  @Max(MAX_COUPON_AMOUNT, {
    message: `discountValue no puede superar ${MAX_COUPON_AMOUNT}`,
  })
  @Validate(IsPercentageWithinLimit)
  discountValue: number;

  @ApiProperty({
    example: 50,
    maximum: MAX_COUPON_AMOUNT,
    description:
      'Soles gastados en pedidos entregados (desde el último cupón) para generar un cupón automático (hasta 2 decimales)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'thresholdAmount debe ser un número con hasta 2 decimales' },
  )
  @IsPositive({ message: 'thresholdAmount debe ser mayor a 0' })
  @Max(MAX_COUPON_AMOUNT, {
    message: `thresholdAmount no puede superar ${MAX_COUPON_AMOUNT}`,
  })
  thresholdAmount: number;

  @ApiProperty({
    example: 15,
    minimum: 1,
    maximum: MAX_AUTO_COUPON_EXPIRATION_DAYS,
    description: 'Días de vigencia del cupón automático desde su generación',
  })
  @IsInt({ message: 'expirationDays debe ser un número entero' })
  @Min(1, { message: 'expirationDays debe ser al menos 1' })
  @Max(MAX_AUTO_COUPON_EXPIRATION_DAYS, {
    message: `expirationDays no puede superar ${MAX_AUTO_COUPON_EXPIRATION_DAYS}`,
  })
  expirationDays: number;
}
