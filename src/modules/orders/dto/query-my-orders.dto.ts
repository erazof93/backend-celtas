import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query params para el listado de "mis pedidos" del cliente (GET /orders/me). */
export class QueryMyOrdersDto {
  @ApiPropertyOptional({
    example: 20,
    default: 20,
    description: 'Cantidad máxima de pedidos a devolver (máx. 100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1, { message: 'El límite mínimo es 1' })
  @Max(100, { message: 'El límite máximo es 100' })
  limit?: number = 20;
}
