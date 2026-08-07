import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReorderBannerItemDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'UUID del banner',
  })
  @IsUUID('4', { message: 'id debe ser un UUID válido' })
  id: string;

  @ApiProperty({ example: 0, description: 'Nueva posición del banner' })
  @IsInt({ message: 'order debe ser un número entero' })
  @Min(0, { message: 'order no puede ser negativo' })
  order: number;
}

/** Reordenar banners en batch (para drag & drop del panel admin). */
export class ReorderBannersDto {
  @ApiProperty({
    type: [ReorderBannerItemDto],
    description: 'Lista de banners con su nueva posición',
  })
  @IsArray({ message: 'items debe ser una lista' })
  @ArrayNotEmpty({ message: 'Debes enviar al menos un banner' })
  @ValidateNested({ each: true })
  @Type(() => ReorderBannerItemDto)
  items: ReorderBannerItemDto[];
}
