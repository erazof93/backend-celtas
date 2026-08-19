import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Enviar una notificación de marketing/fidelización a TODOS los usuarios con token (solo admin). */
export class BroadcastNotificationDto {
  @ApiProperty({
    example: 'A pocos días del día del padre y Celtas lo sabe 🎉',
    description: 'Título de la notificación',
  })
  @IsString({ message: 'El título debe ser texto' })
  @IsNotEmpty({ message: 'El título es obligatorio' })
  title: string;

  @ApiProperty({
    example: 'Aprovecha nuestras promos especiales antes de que se acaben.',
    description: 'Cuerpo del mensaje',
  })
  @IsString({ message: 'El cuerpo debe ser texto' })
  @IsNotEmpty({ message: 'El cuerpo es obligatorio' })
  body: string;
}
