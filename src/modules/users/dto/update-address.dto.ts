import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

/** Actualización parcial de una dirección (PATCH). Todos los campos son opcionales. */
export class UpdateAddressDto {
  @ApiPropertyOptional({
    example: 'Trabajo',
    description: 'Alias de la dirección',
  })
  @IsOptional()
  @IsString({ message: 'El alias debe ser texto' })
  @IsNotEmpty({ message: 'El alias no puede estar vacío' })
  alias?: string;

  @ApiPropertyOptional({
    example: 'Jr. Los Olivos 456',
    description: 'Dirección completa',
  })
  @IsOptional()
  @IsString({ message: 'La dirección debe ser texto' })
  @IsNotEmpty({ message: 'La dirección completa no puede estar vacía' })
  fullAddress?: string;

  @ApiPropertyOptional({
    example: 'Frente a la bodega roja',
    description: 'Referencia o nota para la entrega',
  })
  @IsOptional()
  @IsString({ message: 'La referencia debe ser texto' })
  @IsNotEmpty({ message: 'La referencia no puede estar vacía' })
  reference?: string;

  @ApiPropertyOptional({ example: 'Surco', description: 'Distrito' })
  @IsOptional()
  @IsString({ message: 'El distrito debe ser texto' })
  @IsNotEmpty({ message: 'El distrito no puede estar vacío' })
  district?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Si es la dirección principal del usuario',
  })
  @IsOptional()
  @IsBoolean({ message: 'isDefault debe ser true o false' })
  isDefault?: boolean;

  @ApiPropertyOptional({
    example: -12.164,
    description:
      'Latitud resuelta por la app (Geoapify, client-side). Opcional.',
  })
  @IsOptional()
  @IsNumber({}, { message: 'latitude debe ser un número' })
  @IsLatitude({ message: 'latitude debe ser una latitud válida' })
  latitude?: number;

  @ApiPropertyOptional({
    example: -76.9721,
    description:
      'Longitud resuelta por la app (Geoapify, client-side). Opcional.',
  })
  @IsOptional()
  @IsNumber({}, { message: 'longitude debe ser un número' })
  @IsLongitude({ message: 'longitude debe ser una longitud válida' })
  longitude?: number;
}
