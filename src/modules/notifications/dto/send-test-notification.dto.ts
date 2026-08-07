import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/** Enviar una notificación de prueba a un usuario (solo admin). */
export class SendTestNotificationDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'UUID del usuario destinatario',
  })
  @IsUUID('4', { message: 'userId debe ser un UUID válido' })
  userId: string;

  @ApiProperty({ example: '¡Tu pedido va en camino!', description: 'Título' })
  @IsString({ message: 'El título debe ser texto' })
  @IsNotEmpty({ message: 'El título es obligatorio' })
  title: string;

  @ApiProperty({
    example: 'Tu pedido #123 está en camino a tu dirección.',
    description: 'Cuerpo del mensaje',
  })
  @IsString({ message: 'El cuerpo debe ser texto' })
  @IsNotEmpty({ message: 'El cuerpo es obligatorio' })
  body: string;
}
