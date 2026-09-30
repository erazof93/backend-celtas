import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, Min } from 'class-validator';
import { IsOptionalNonNullable } from '../../../common/decorators/is-optional-non-nullable.decorator';

export class UpdateRewardMilestoneDto {
  @ApiPropertyOptional({ example: 5 })
  @IsOptionalNonNullable()
  @IsInt({ message: 'starsRequired debe ser un número entero' })
  @Min(1, { message: 'starsRequired debe ser mayor a 0' })
  starsRequired?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'isSpecial debe ser true o false' })
  isSpecial?: boolean;
}
