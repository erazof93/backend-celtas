import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  Validate,
} from 'class-validator';
import { IsPhone } from '../../../common/validators/is-phone';

export class RegisterDto {
  @ApiProperty({
    example: 'cliente@example.com',
    description: 'Email del usuario',
  })
  @IsEmail({}, { message: 'El email no es válido' })
  email: string;

  @ApiProperty({
    example: 'password123',
    description: 'Contraseña (mínimo 8 caracteres)',
  })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password: string;

  @ApiProperty({ example: 'Juan Pérez', description: 'Nombre completo' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  fullName: string;

  @ApiPropertyOptional({
    example: '987654321',
    description:
      'Celular (opcional). Peruano: 9 dígitos (acepta +51/espacios/guiones). Extranjero: con + o 00 y código de país (ej. +58 412 999 9999). Se guarda normalizado: código de país + número, sin + (51987654321).',
  })
  @IsOptional()
  @IsString({ message: 'El teléfono debe ser texto' })
  @Validate(IsPhone)
  phone?: string;
}
