import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, Matches, ValidateIf } from 'class-validator';

/** Omit the token for legacy logout; otherwise clear only the matching token. */
export class ClearFcmTokenDto {
  @ApiPropertyOptional({ description: 'Token FCM que se desea desregistrar' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'fcmToken debe ser texto' })
  @Matches(/\S/, { message: 'fcmToken no puede estar vacío' })
  fcmToken?: string;

  @ApiPropertyOptional({
    description: 'Revoca la generación incluso sin token',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  generation?: string;
}
