import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateAddressDto {
  @ApiProperty({
    example: 'Casa',
    description: 'Alias de la dirección (ej. Casa, Trabajo)',
  })
  @IsString({ message: 'El alias debe ser texto' })
  @IsNotEmpty({ message: 'El alias es obligatorio' })
  alias: string;

  @ApiProperty({
    example: 'Av. Los Álamos 123',
    description: 'Dirección completa',
  })
  @IsString({ message: 'La dirección debe ser texto' })
  @IsNotEmpty({ message: 'La dirección completa es obligatoria' })
  fullAddress: string;

  @ApiPropertyOptional({
    example: 'Portón verde, tercer piso',
    description: 'Referencia o nota para la entrega',
  })
  @IsOptional()
  @IsString({ message: 'La referencia debe ser texto' })
  @IsNotEmpty({ message: 'La referencia no puede estar vacía' })
  reference?: string;

  @ApiProperty({
    example: 'San Juan de Miraflores',
    description: 'Distrito',
  })
  @IsString({ message: 'El distrito debe ser texto' })
  @IsNotEmpty({ message: 'El distrito es obligatorio' })
  district: string;

  @ApiPropertyOptional({
    example: false,
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
