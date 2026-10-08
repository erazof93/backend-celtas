import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, ValidateIf } from 'class-validator';

/** Guarda/actualiza el token FCM del dispositivo actual del usuario. */
export class UpdateFcmTokenDto {
  @ApiProperty({
    example: 'fcm-token-del-dispositivo',
    description: 'Token de Firebase Cloud Messaging del dispositivo actual',
  })
  @IsString({ message: 'fcmToken debe ser texto' })
  @IsNotEmpty({ message: 'fcmToken es obligatorio' })
  fcmToken: string;

  @ApiPropertyOptional({
    description: 'Generación FCM; omitir para clientes legacy',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  generation?: string;
}
