import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

/**
 * Pedidos anónimos a vincular a un cliente registrado (POST
 * /users/:id/link-anonymous-orders). Se mandan explícitos (salidos del preview
 * GET /users/:id/anonymous-orders) en vez de "todos los de ese teléfono": el
 * admin elige, después de confirmar con el cliente, exactamente cuáles son suyos.
 */
export class LinkAnonymousOrdersDto {
  @ApiProperty({
    type: [String],
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description:
      'UUIDs de pedidos anónimos (del preview) cuyo customerPhone coincide con el teléfono del cliente. Máx. 100.',
  })
  @IsArray({ message: 'orderIds debe ser una lista' })
  @ArrayNotEmpty({ message: 'orderIds no puede estar vacío' })
  @ArrayMaxSize(100, { message: 'orderIds admite como máximo 100 pedidos' })
  @ArrayUnique({ message: 'orderIds no puede tener ids repetidos' })
  @IsUUID('4', { each: true, message: 'Cada orderId debe ser un UUID válido' })
  orderIds: string[];
}
