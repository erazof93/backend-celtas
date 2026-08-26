import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class CreateRewardMilestoneDto {
  @ApiProperty({
    example: 5,
    description: 'Estrellas necesarias para ganar este premio',
  })
  @IsInt({ message: 'starsRequired debe ser un número entero' })
  @Min(1, { message: 'starsRequired debe ser mayor a 0' })
  starsRequired: number;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'Si este hito entrega el premio especial (catálogo exclusivo)',
  })
  @IsOptional()
  @IsBoolean({ message: 'isSpecial debe ser true o false' })
  isSpecial?: boolean;
}
