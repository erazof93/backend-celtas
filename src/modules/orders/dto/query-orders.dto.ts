import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

/** Query params para el listado de pedidos del admin (GET /orders). */
export class QueryOrdersDto {
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
    description: 'Pedidos por página (máx. 100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1, { message: 'El límite mínimo es 1' })
  @Max(100, { message: 'El límite máximo es 100' })
  limit?: number = 10;

  @ApiPropertyOptional({
    enum: OrderStatus,
    description: 'Filtrar por estado (opcional)',
  })
  @IsOptional()
  @IsEnum(OrderStatus, {
    message:
      'El estado debe ser uno de: pendiente, confirmado, en_camino, entregado, cancelado',
  })
  status?: OrderStatus;
}
