import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CouponStatus } from '../entities/coupon.entity';

/** Query params para el listado de cupones del admin (GET /coupons). */
export class QueryCouponsDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: 'Número de página',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La página debe ser un número entero' })
  @Min(1, { message: 'La página mínima es 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    example: 10,
    default: 10,
    description: 'Cupones por página (máx. 100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1, { message: 'El límite mínimo es 1' })
  @Max(100, { message: 'El límite máximo es 100' })
  limit?: number = 10;

  @ApiPropertyOptional({
    enum: CouponStatus,
    description: 'Filtrar por estado (opcional)',
  })
  @IsOptional()
  @IsEnum(CouponStatus, {
    message: 'El estado debe ser uno de: active, used, expired',
  })
  status?: CouponStatus;
}
