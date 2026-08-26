import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateRewardMilestoneDto {
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt({ message: 'starsRequired debe ser un número entero' })
  @Min(1, { message: 'starsRequired debe ser mayor a 0' })
  starsRequired?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean({ message: 'isSpecial debe ser true o false' })
  isSpecial?: boolean;
}
