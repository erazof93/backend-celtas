import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BannerActionType } from '../entities/banner.entity';

/**
 * Actualizar un banner (PATCH, todos los campos opcionales).
 * Las validaciones cruzadas (actionValue requerido si actionType != none, y
 * startDate < endDate) se aplican en el servicio tras el merge, para no romper
 * las actualizaciones parciales.
 */
export class UpdateBannerDto {
  @ApiPropertyOptional({ example: '2x1 en burgers', description: 'Título' })
  @IsOptional()
  @IsString({ message: 'El título debe ser texto' })
  @IsNotEmpty({ message: 'El título no puede estar vacío' })
  title?: string;

  @ApiPropertyOptional({ description: 'URL de la imagen del banner' })
  @IsOptional()
  @IsString({ message: 'imageUrl debe ser texto' })
  imageUrl?: string;

  @ApiPropertyOptional({
    enum: BannerActionType,
    description: 'A dónde lleva el banner al tocarlo',
  })
  @IsOptional()
  @IsEnum(BannerActionType, {
    message: 'actionType debe ser none, category, menuItem o external_url',
  })
  actionType?: BannerActionType;

  @ApiPropertyOptional({
    description:
      'Slug de categoría, id de producto o URL externa según actionType',
  })
  @IsOptional()
  @IsString({ message: 'actionValue debe ser texto' })
  actionValue?: string;

  @ApiPropertyOptional({ description: 'Inicio de vigencia (opcional)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'startDate debe ser una fecha válida' })
  startDate?: Date;

  @ApiPropertyOptional({ description: 'Fin de vigencia (opcional)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'endDate debe ser una fecha válida' })
  endDate?: Date;

  @ApiPropertyOptional({ description: 'Si el banner está habilitado' })
  @IsOptional()
  @IsBoolean({ message: 'active debe ser true o false' })
  active?: boolean;

  @ApiPropertyOptional({
    example: [2, 4],
    description:
      'Días de la semana en que se muestra el banner (0=domingo ... 6=sábado). null o vacío = todos los días.',
    type: [Number],
  })
  @IsOptional()
  @IsArray({ message: 'daysOfWeek debe ser un array de números' })
  @IsInt({
    each: true,
    message: 'Cada día de la semana debe ser un número entero',
  })
  @Min(0, {
    each: true,
    message: 'daysOfWeek admite valores de 0 (domingo) a 6 (sábado)',
  })
  @Max(6, {
    each: true,
    message: 'daysOfWeek admite valores de 0 (domingo) a 6 (sábado)',
  })
  daysOfWeek?: number[];

  @ApiPropertyOptional({ description: 'Orden de visualización (ascendente)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'order debe ser un número entero' })
  @Min(0, { message: 'order no puede ser negativo' })
  order?: number;
}
