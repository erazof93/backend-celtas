import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({
    description:
      'idToken de Google (JWT firmado) obtenido en el frontend con la SDK de Google',
    example: 'eyJhbGciOiJSUzI1NiIs...',
  })
  @IsString({ message: 'El idToken de Google debe ser un texto' })
  @IsNotEmpty({ message: 'El idToken de Google es obligatorio' })
  idToken: string;
}
