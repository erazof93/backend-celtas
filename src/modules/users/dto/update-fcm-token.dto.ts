import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Guarda/actualiza el token FCM del dispositivo actual del usuario. */
export class UpdateFcmTokenDto {
  @ApiProperty({
    example: 'fcm-token-del-dispositivo',
    description: 'Token de Firebase Cloud Messaging del dispositivo actual',
  })
  @IsString({ message: 'fcmToken debe ser texto' })
  @IsNotEmpty({ message: 'fcmToken es obligatorio' })
  fcmToken: string;
}
