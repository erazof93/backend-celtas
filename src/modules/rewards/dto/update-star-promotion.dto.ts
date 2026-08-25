import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Actualizar una promoción de estrellas (PATCH, todos los campos opcionales).
 * La validación cruzada (startDate <= endDate) y la de no-solapamiento se
 * aplican en el servicio tras el merge, mismo criterio que `UpdateBannerDto`.
 */
export class UpdateStarPromotionDto {
  @ApiPropertyOptional({ example: 'Navidad 2026' })
  @IsOptional()
  @IsString({ message: 'label debe ser texto' })
  @IsNotEmpty({ message: 'label no puede estar vacío' })
  label?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'multiplier debe ser un número con hasta 2 decimales' },
  )
  @Min(0.01, { message: 'multiplier debe ser mayor a 0' })
  @Max(99.99, { message: 'multiplier no puede superar 99.99' })
  multiplier?: number;

  @ApiPropertyOptional({ example: '2026-12-20' })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'startDate debe ser una fecha válida (YYYY-MM-DD)' },
  )
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'endDate debe ser una fecha válida (YYYY-MM-DD)' },
  )
  endDate?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: 'active debe ser true o false' })
  active?: boolean;
}
