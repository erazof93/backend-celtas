import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
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

  @ApiPropertyOptional({
    example: '3f2b1c4a-9d8e-4f6a-b7c5-1a2b3c4d5e6f',
    description: 'Filtrar los pedidos de un usuario específico (opcional)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'userId debe ser un UUID válido' })
  userId?: string;
}
