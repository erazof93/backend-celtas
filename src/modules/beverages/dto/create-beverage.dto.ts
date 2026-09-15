import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateBeverageDto {
  @ApiProperty({
    example: 'Coca-Cola 500ml',
    description: 'Nombre de la bebida',
  })
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;

  @ApiProperty({
    example: 5,
    description: 'Precio de la bebida en soles (S/)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con hasta 2 decimales' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor a cero' })
  price: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Si la bebida está disponible para asignarse a productos (default true)',
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
