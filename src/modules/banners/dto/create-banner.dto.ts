import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  Validate,
  ValidateIf,
} from 'class-validator';
import { BannerActionType } from '../entities/banner.entity';
import { IsBannerDateRangeValid } from './is-banner-date-range-valid';

/**
 * Crear un banner.
 * - Si `actionType` no es `none`, `actionValue` es obligatorio.
 * - Si vienen ambas fechas, `startDate` debe ser anterior a `endDate`.
 */
export class CreateBannerDto {
  @ApiProperty({ example: '2x1 en burgers', description: 'Título del banner' })
  @IsString({ message: 'El título debe ser texto' })
  @IsNotEmpty({ message: 'El título es obligatorio' })
  title: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/...',
    description: 'URL de la imagen del banner',
  })
  @IsOptional()
  @IsString({ message: 'imageUrl debe ser texto' })
  imageUrl?: string;

  @ApiPropertyOptional({
    enum: BannerActionType,
    default: BannerActionType.NONE,
    description: 'A dónde lleva el banner al tocarlo',
  })
  @IsOptional()
  @IsEnum(BannerActionType, {
    message: 'actionType debe ser none, category, menuItem o external_url',
  })
  actionType?: BannerActionType;

  @ApiPropertyOptional({
    example: 'burgers',
    description:
      'Slug de categoría, id de producto o URL externa según actionType. Obligatorio si actionType no es none.',
  })
  @ValidateIf(
    (o: CreateBannerDto) =>
      o.actionType !== undefined && o.actionType !== BannerActionType.NONE,
  )
  @IsString({ message: 'actionValue debe ser texto' })
  @IsNotEmpty({
    message: 'actionValue es obligatorio cuando actionType no es none',
  })
  actionValue?: string;

  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00.000Z',
    description: 'Inicio de vigencia (opcional)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'startDate debe ser una fecha válida' })
  startDate?: Date;

  @ApiPropertyOptional({
    example: '2026-08-31T23:59:59.000Z',
    description: 'Fin de vigencia (opcional)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'endDate debe ser una fecha válida' })
  // Si vienen ambas fechas, startDate debe ser anterior a endDate.
  @Validate(IsBannerDateRangeValid)
  endDate?: Date;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Si el banner está habilitado',
  })
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

  @ApiPropertyOptional({
    example: 0,
    default: 0,
    description: 'Orden de visualización (ascendente)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'order debe ser un número entero' })
  @Min(0, { message: 'order no puede ser negativo' })
  order?: number;
}
