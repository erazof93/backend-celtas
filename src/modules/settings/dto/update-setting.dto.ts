import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Actualiza (upsert) una setting desde el panel admin. `key` identifica la
 * setting: si no existe se crea, si existe se actualiza su `value`/`description`.
 */
export class UpdateSettingDto {
  @ApiProperty({
    example: 'whatsapp_business_number',
    description: 'Clave de la setting a crear/actualizar',
  })
  @IsString({ message: 'key debe ser texto' })
  @IsNotEmpty({ message: 'key es obligatoria' })
  key: string;

  @ApiProperty({
    example: '51999999999',
    description: 'Valor de la setting',
  })
  @IsString({ message: 'value debe ser texto' })
  @IsNotEmpty({ message: 'value es obligatorio' })
  value: string;

  @ApiPropertyOptional({
    example: 'Número de WhatsApp del negocio (formato internacional sin +)',
    description: 'Descripción opcional de la setting',
  })
  @IsOptional()
  @IsString({ message: 'description debe ser texto' })
  description?: string;
}
