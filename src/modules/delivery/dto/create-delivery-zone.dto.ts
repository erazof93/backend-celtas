import { MAX_MONEY } from '../../../common/utils/money.util';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { IsOptionalNonNullable } from '../../../common/decorators/is-optional-non-nullable.decorator';
import { deliveryPolygonError } from '../polygon.util';
import type { DeliveryPolygon } from '../polygon.util';
import { DeliveryPolygonDto } from './delivery-polygon.dto';

@ValidatorConstraint({ name: 'deliveryPolygon', async: false })
export class DeliveryPolygonValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return deliveryPolygonError(value) === null;
  }
  defaultMessage(args: ValidationArguments): string {
    return deliveryPolygonError(args.value) ?? 'Polígono inválido';
  }
}

export class CreateDeliveryZoneDto {
  @ApiProperty({ maxLength: 100, example: 'Zona centro' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'name debe ser texto' })
  @IsNotEmpty({ message: 'name es obligatorio' })
  @MaxLength(100, { message: 'name no puede superar 100 caracteres' })
  name: string;

  @ApiProperty({
    type: DeliveryPolygonDto,
    description:
      'GeoJSON Polygon, un anillo cerrado sin huecos; posiciones [longitude, latitude], máximo 500 incluyendo cierre',
    example: {
      type: 'Polygon',
      coordinates: [
        [
          [-77, -12],
          [-76.99, -12],
          [-76.99, -11.99],
          [-77, -11.99],
          [-77, -12],
        ],
      ],
    },
  })
  @Validate(DeliveryPolygonValidator)
  polygon: DeliveryPolygon;

  @ApiProperty({ example: 5, minimum: 0, maximum: 99999999.99 })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'fee debe ser un número finito con máximo 2 decimales' },
  )
  @Min(0, { message: 'fee no puede ser negativa' })
  @Max(MAX_MONEY, { message: 'fee excede el máximo permitido' })
  fee: number;

  @ApiPropertyOptional({ default: true })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'active debe ser true o false' })
  active?: boolean;
}

export class UpdateDeliveryZoneDto extends PartialType(CreateDeliveryZoneDto, {
  skipNullProperties: false,
}) {}
