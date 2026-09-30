import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsOptionalNonNullable } from '../../../common/decorators/is-optional-non-nullable.decorator';

/**
 * Actualización del perfil propio (PATCH /users/me).
 *
 * A propósito NO declara email, password, provider, role ni totalSpent:
 * esos campos no son editables por el usuario y, gracias al ValidationPipe
 * global con forbidNonWhitelisted, mandarlos devuelve 400.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Juan Pérez',
    description: 'Nombre completo',
  })
  @IsOptionalNonNullable()
  @IsString({ message: 'El nombre completo debe ser texto' })
  @IsNotEmpty({ message: 'El nombre completo no puede estar vacío' })
  fullName?: string;

  @ApiPropertyOptional({
    example: '+51999999999',
    description: 'Teléfono de contacto (opcional)',
  })
  @IsOptional()
  @IsString({ message: 'El teléfono debe ser texto' })
  @IsNotEmpty({ message: 'El teléfono no puede estar vacío' })
  phone?: string;
}
