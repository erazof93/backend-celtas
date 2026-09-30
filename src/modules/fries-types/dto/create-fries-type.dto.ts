import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsOptionalNonNullable } from '../../../common/decorators/is-optional-non-nullable.decorator';

export class CreateFriesTypeDto {
  @ApiProperty({
    example: 'Papas al hilo',
    description: 'Nombre del tipo de papas',
  })
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100, { message: 'El nombre no puede superar los 100 caracteres' })
  name: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Si es la opción preseleccionada en la app (default false). Marcar uno como default desmarca el anterior.',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'isDefault debe ser true o false' })
  isDefault?: boolean;
}
