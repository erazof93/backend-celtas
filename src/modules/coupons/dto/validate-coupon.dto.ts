import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** Validar un cupón antes de confirmar el pedido (POST /coupons/validate). */
export class ValidateCouponDto {
  @ApiProperty({
    example: 'A1B2C3D4',
    description: 'Código del cupón a validar',
  })
  @IsString({ message: 'El código debe ser texto' })
  @IsNotEmpty({ message: 'El código del cupón es obligatorio' })
  code: string;

  @ApiPropertyOptional({
    example: 49.8,
    description:
      'Subtotal del pedido (opcional). Si el cupón tiene un monto mínimo de compra, se valida contra este valor y se rechaza si el subtotal es menor.',
  })
  @IsOptional()
  @IsNumber({}, { message: 'subtotal debe ser un número' })
  @Min(0, { message: 'subtotal no puede ser negativo' })
  subtotal?: number;
}
