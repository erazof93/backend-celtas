import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

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
    example: '+51999999999',
    description: 'Teléfono (opcional)',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}
