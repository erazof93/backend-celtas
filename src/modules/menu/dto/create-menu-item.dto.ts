import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateMenuItemDto {
  @ApiProperty({
    example: 'Celtas Burger Clásica',
    description: 'Nombre del producto',
  })
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;

  @ApiPropertyOptional({
    example: 'Doble carne, queso cheddar y papas',
    description: 'Descripción del producto',
  })
  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  @IsNotEmpty({ message: 'La descripción no puede estar vacía' })
  description?: string;

  @ApiProperty({
    example: 24.9,
    description: 'Precio del producto en soles (S/)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con hasta 2 decimales' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor a cero' })
  price: number;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/...',
    description: 'URL de la imagen del producto',
  })
  @IsOptional()
  @IsString({ message: 'La imagen debe ser texto' })
  image?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Si el producto está disponible para pedir (default true)',
  })
  @IsOptional()
  @IsBoolean({ message: 'available debe ser true o false' })
  available?: boolean;

  @ApiPropertyOptional({
    example: false,
    description:
      'Si el producto puede canjearse con estrellas del programa de fidelización (default false)',
  })
  @IsOptional()
  @IsBoolean({ message: 'redeemableWithStars debe ser true o false' })
  redeemableWithStars?: boolean;

  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'UUID de la categoría a la que pertenece',
  })
  @IsUUID('4', { message: 'categoryId debe ser un UUID válido' })
  categoryId: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description:
      'UUIDs de las salsas del catálogo que este producto ofrece (vacío u omitido = sin selector de salsas, ej. arroz chaufa)',
  })
  @IsOptional()
  @IsArray({ message: 'sauceIds debe ser una lista' })
  @IsUUID('4', { each: true, message: 'Cada sauceId debe ser un UUID válido' })
  sauceIds?: string[];
}
