import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'cliente@example.com',
    description: 'Email del usuario',
  })
  @IsEmail({}, { message: 'El email no es válido' })
  email: string;

  @ApiProperty({ example: 'password123', description: 'Contraseña' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  password: string;
}
