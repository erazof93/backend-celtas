import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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
  @IsOptional()
  @IsBoolean({ message: 'active debe ser true o false' })
  active?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: 'Orden de aparición en el selector (menor = primero)',
  })
  @IsOptional()
  @IsInt({ message: 'sortOrder debe ser un número entero' })
  @Min(0, { message: 'sortOrder no puede ser negativo' })
  sortOrder?: number;
}
