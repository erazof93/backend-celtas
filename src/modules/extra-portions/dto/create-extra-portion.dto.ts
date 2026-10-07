import { MAX_MONEY } from '../../../common/utils/money.util';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { IsOptionalNonNullable } from '../../../common/decorators/is-optional-non-nullable.decorator';

export class CreateExtraPortionDto {
  @ApiProperty({
    example: 'Papas extra',
    description: 'Nombre de la porción extra',
  })
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;

  @ApiProperty({
    example: 8,
    description: 'Precio de la porción extra en soles (S/)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con hasta 2 decimales' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor a cero' })
  @Max(MAX_MONEY, { message: 'El precio excede el máximo permitido' })
  price: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Si la porción extra está disponible para asignarse a productos (default true)',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'active debe ser true o false' })
  active?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: 'Orden de aparición en el selector (menor = primero)',
  })
  @IsOptionalNonNullable()
  @IsInt({ message: 'sortOrder debe ser un número entero' })
  @Min(0, { message: 'sortOrder no puede ser negativo' })
  sortOrder?: number;
}
