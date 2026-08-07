import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsPositive,
  IsUUID,
  Min,
  Validate,
} from 'class-validator';
import { CouponDiscountType } from '../entities/coupon.entity';
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
  @IsNumber({}, { message: 'discountValue debe ser un número' })
  @IsPositive({ message: 'discountValue debe ser mayor a 0' })
  @Min(0.01, { message: 'discountValue debe ser mayor a 0' })
  // Un fixed_amount puede superar 100 (ej. S/150); el % no puede pasar de 100.
  @Validate(IsPercentageWithinLimit)
  discountValue: number;
}
