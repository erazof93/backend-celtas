import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({
    example: 'https://celtas.com/promos/dia-del-padre',
    description:
      'Link opcional al que navega la app al tocar la notificación (deep link o URL).',
  })
  @IsOptional()
  @IsString({ message: 'El link debe ser texto' })
  @MaxLength(500, { message: 'El link no puede superar los 500 caracteres' })
  link?: string;
}
