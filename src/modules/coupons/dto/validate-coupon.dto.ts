import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Validar un cupón antes de confirmar el pedido (POST /coupons/validate). */
export class ValidateCouponDto {
  @ApiProperty({
    example: 'A1B2C3D4',
    description: 'Código del cupón a validar',
  })
  @IsString({ message: 'El código debe ser texto' })
  @IsNotEmpty({ message: 'El código del cupón es obligatorio' })
  code: string;
}
