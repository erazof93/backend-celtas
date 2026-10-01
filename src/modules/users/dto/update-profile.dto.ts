import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Validate } from 'class-validator';
import { IsOptionalNonNullable } from '../../../common/decorators/is-optional-non-nullable.decorator';
import { IsPhone } from '../../../common/validators/is-phone';

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
    type: String,
    example: '987654321',
    description:
      'Celular de contacto (opcional; null lo borra). Peruano: 9 dígitos (acepta +51/espacios/guiones). Extranjero: con + o 00 y código de país (ej. +58 412 999 9999). Se guarda normalizado: código de país + número, sin + (51987654321).',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'El teléfono debe ser texto' })
  @IsNotEmpty({ message: 'El teléfono no puede estar vacío' })
  @Validate(IsPhone)
  phone?: string | null;
}
