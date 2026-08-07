import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description: 'Refresh token emitido en el login o en un refresh anterior',
  })
  @IsString()
  @IsNotEmpty({ message: 'El refresh token es obligatorio' })
  refreshToken: string;
}
