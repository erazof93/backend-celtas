import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    example: OrderStatus.CONFIRMADO,
    description: 'Nuevo estado del pedido (solo transiciones válidas)',
  })
  @IsEnum(OrderStatus, {
    message:
      'El estado debe ser uno de: pendiente, confirmado, en_camino, entregado, cancelado',
  })
  status: OrderStatus;
}
