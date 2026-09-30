import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { IsOptionalNonNullable } from '../../../common/decorators/is-optional-non-nullable.decorator';

export class CreateSauceDto {
  @ApiProperty({
    example: 'Mayonesa',
    description: 'Nombre de la salsa/crema',
  })
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Si la salsa está disponible para asignarse a productos (default true)',
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
