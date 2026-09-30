import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidateIf,
} from 'class-validator';
import { IsPhone } from '../../../common/validators/is-phone';
import { CreateOrderDto } from './create-order.dto';
import { IsContactExclusiveWithCustomer } from './is-customer-contact-valid';

/**
 * Pedido manual cargado por el admin (ej. pedido telefónico). Mismos campos que
 * POST /orders más el cliente:
 * - Con `customerId`: el pedido se asocia a ese cliente (addressId, cupón y
 *   premios se validan contra ÉL, igual que si lo pidiera desde la app).
 * - Sin `customerId`: pedido anónimo. `customerName` + `customerPhone` son
 *   obligatorios y la dirección va solo por `addressSnapshot` (addressId,
 *   couponCode y rewardRedemptionId pertenecen a una cuenta → 400).
 */
export class CreateOrderAdminDto extends CreateOrderDto {
  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description:
      'UUID de un cliente registrado. Omitir para un pedido anónimo (requiere customerName y customerPhone).',
  })
  @IsOptional()
  @IsUUID('4', { message: 'customerId debe ser un UUID válido' })
  @Validate(IsContactExclusiveWithCustomer)
  customerId?: string;

  @ApiPropertyOptional({
    example: 'Juan Pérez',
    description: 'Nombre de contacto. Obligatorio si no hay customerId.',
    maxLength: 100,
  })
  @ValidateIf((dto: CreateOrderAdminDto) => !dto.customerId)
  @IsString({ message: 'customerName debe ser texto' })
  @IsNotEmpty({
    message: 'customerName es obligatorio en un pedido sin cliente',
  })
  @MaxLength(100, {
    message: 'customerName no puede superar los 100 caracteres',
  })
  customerName?: string;

  @ApiPropertyOptional({
    example: '987654321',
    description:
      'Celular de contacto. Peruano: 9 dígitos (acepta +51/espacios/guiones). Extranjero: con + o 00 y código de país (ej. +58 412 999 9999). Se guarda normalizado (código de país + número, sin +). Obligatorio si no hay customerId. El whatsappUrl del pedido apunta a este número.',
  })
  @ValidateIf((dto: CreateOrderAdminDto) => !dto.customerId)
  @IsString({ message: 'customerPhone debe ser texto' })
  @Validate(IsPhone)
  customerPhone?: string;
}
