import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GeocodeAddressDto {
  @ApiProperty({
    example: 'Jr. Carabaya 250, Lima',
    description:
      'Dirección en texto libre. Incluir distrito o ciudad: sin eso Geoapify suele no encontrarla.',
    maxLength: 200,
  })
  @IsString({ message: 'La dirección debe ser texto' })
  @IsNotEmpty({ message: 'Dirección es requerida' })
  @MaxLength(200, {
    message: 'La dirección no puede superar los 200 caracteres',
  })
  address: string;
}
