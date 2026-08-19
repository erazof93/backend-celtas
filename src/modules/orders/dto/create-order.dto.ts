import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'UUID del producto del menú',
  })
  @IsUUID('4', { message: 'menuItemId debe ser un UUID válido' })
  menuItemId: string;

  @ApiProperty({ example: 2, description: 'Cantidad del producto' })
  @IsInt({ message: 'La cantidad debe ser un número entero' })
  @Min(1, { message: 'La cantidad mínima es 1' })
  @Max(99, { message: 'La cantidad máxima por producto es 99' })
  quantity: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description:
      'UUIDs de las salsas elegidas para este ítem (deben estar entre las que el producto ofrece; se aplican a las `quantity` unidades del ítem, no una selección por unidad individual). Omitido (campo no enviado) = no aplica, el producto no ofrece salsas o el cliente nunca llegó al selector. Array vacío enviado explícitamente ([]) = el cliente vio el selector y eligió deliberadamente "Sin salsas"; se guarda y se muestra como una elección real, no como ausencia de dato.',
  })
  @IsOptional()
  @IsArray({ message: 'sauceIds debe ser una lista' })
  @IsUUID('4', { each: true, message: 'Cada sauceId debe ser un UUID válido' })
  sauceIds?: string[];

  @ApiPropertyOptional({
    example: 'Sin cebolla, bien cocida',
    description:
      'Comentario libre opcional para este ítem (se aplica a las `quantity` unidades del ítem, no una nota por unidad individual). Vacío o solo espacios se trata como ausente.',
  })
  @IsOptional()
  @IsString({ message: 'comment debe ser texto' })
  @MaxLength(140, {
    message: 'El comentario no puede superar los 140 caracteres',
  })
  comment?: string;
}

/**
 * Crear un pedido. La dirección se guarda SIEMPRE como snapshot (nunca como
 * referencia viva): se copia de una Address del usuario (addressId) o se manda
 * directo (addressSnapshot). El total lo calcula el backend, nunca el cliente.
 */
export class CreateOrderDto {
  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description:
      'UUID de una dirección guardada del usuario; se copia su contenido al addressSnapshot',
  })
  @IsOptional()
  @IsUUID('4', { message: 'addressId debe ser un UUID válido' })
  addressId?: string;

  @ApiPropertyOptional({
    example:
      '{"alias":"Casa","fullAddress":"Av. Los Álamos 123","reference":"Portón verde","district":"San Juan de Miraflores"}',
    description:
      'JSON string con la dirección si el usuario no tiene direcciones guardadas',
  })
  @IsOptional()
  @IsString({ message: 'addressSnapshot debe ser texto' })
  @IsNotEmpty({ message: 'addressSnapshot no puede estar vacío' })
  addressSnapshot?: string;

  @ApiProperty({
    type: [CreateOrderItemDto],
    description: 'Productos del pedido (el total lo calcula el backend)',
  })
  @IsArray({ message: 'items debe ser una lista' })
  @ArrayNotEmpty({ message: 'El pedido debe tener al menos un producto' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiPropertyOptional({
    example: 'A1B2C3D4',
    description:
      'Código de cupón opcional. Se valida y canjea dentro de la misma transacción del pedido; si no es válido, el pedido no se crea.',
  })
  @IsOptional()
  @IsString({ message: 'couponCode debe ser texto' })
  @IsNotEmpty({ message: 'couponCode no puede estar vacío' })
  couponCode?: string;
}
