import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Estimar el costo de delivery de una dirección ya guardada, antes de crear el pedido. */
export class EstimateDeliveryFeeDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'UUID de una dirección guardada del usuario autenticado',
  })
  @IsUUID('4', { message: 'addressId debe ser un UUID válido' })
  addressId: string;
}
