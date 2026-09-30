import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber } from 'class-validator';

/**
 * Query string → número. NO usar `@Type(() => Number)` acá: `Number('')` y
 * `Number(' ')` dan `0`, y 0 es una coordenada válida, así que
 * `?latitude=&longitude=` cotizaba el punto (0,0) con 200 en vez de 400. Vacío o
 * solo espacios → `undefined` (rechazado por `@IsNumber` con el mensaje de
 * "obligatoria"); no numérico → `NaN` (también rechazado).
 */
const toCoordinate = ({ value }: TransformFnParams): unknown => {
  if (typeof value === 'string') {
    return value.trim() === '' ? undefined : Number(value);
  }
  return value;
};

/**
 * Query de `GET /delivery/estimate`: coordenadas sueltas (ej. el pin del mapa
 * antes de guardar la dirección).
 */
export class EstimateDeliveryByCoordsDto {
  @ApiProperty({
    example: -12.1631,
    description: 'Latitud del punto de entrega',
  })
  @Transform(toCoordinate)
  @IsNumber({}, { message: 'latitude es obligatoria y debe ser un número' })
  @IsLatitude({ message: 'latitude debe ser una latitud válida (-90 a 90)' })
  latitude: number;

  @ApiProperty({
    example: -76.97,
    description: 'Longitud del punto de entrega',
  })
  @Transform(toCoordinate)
  @IsNumber({}, { message: 'longitude es obligatoria y debe ser un número' })
  @IsLongitude({
    message: 'longitude debe ser una longitud válida (-180 a 180)',
  })
  longitude: number;
}
