import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({
    example: 'El cliente ya no se encuentra en la dirección de entrega',
    description:
      'Motivo de la cancelación. Obligatorio solo cuando el pedido está "en_camino" y se cancela; opcional en el resto de transiciones a "cancelado".',
  })
  @IsOptional()
  @IsString({ message: 'cancelReason debe ser texto' })
  @MaxLength(500, {
    message: 'El motivo no puede superar los 500 caracteres',
  })
  cancelReason?: string;
}
