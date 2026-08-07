import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({
    example: 'Burgers',
    description: 'Nombre de la categoría',
  })
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;

  @ApiPropertyOptional({
    example: 'Hamburguesas artesanales',
    description: 'Descripción corta de la categoría',
  })
  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  @IsNotEmpty({ message: 'La descripción no puede estar vacía' })
  description?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/...',
    description: 'URL de la imagen de la categoría',
  })
  @IsOptional()
  @IsString({ message: 'La imagen debe ser texto' })
  image?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Si la categoría está visible en la app (default true)',
  })
  @IsOptional()
  @IsBoolean({ message: 'active debe ser true o false' })
  active?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: 'Orden de aparición en la app (menor = primero)',
  })
  @IsOptional()
  @IsInt({ message: 'sortOrder debe ser un número entero' })
  @Min(0, { message: 'sortOrder no puede ser negativo' })
  sortOrder?: number;
}
