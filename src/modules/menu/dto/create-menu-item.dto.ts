import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalNonNullable } from '../../../common/decorators/is-optional-non-nullable.decorator';

export class CreateMenuItemDto {
  @ApiProperty({
    example: 'Celtas Burger Clásica',
    description: 'Nombre del producto',
  })
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;

  @ApiPropertyOptional({
    example: 'Doble carne, queso cheddar y papas',
    description: 'Descripción del producto',
  })
  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  @IsNotEmpty({ message: 'La descripción no puede estar vacía' })
  description?: string;

  @ApiProperty({
    example: 24.9,
    description: 'Precio del producto en soles (S/)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con hasta 2 decimales' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor a cero' })
  price: number;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/...',
    description: 'URL de la imagen del producto',
  })
  @IsOptional()
  @IsString({ message: 'La imagen debe ser texto' })
  image?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Si el producto está disponible para pedir (default true)',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'available debe ser true o false' })
  available?: boolean;

  @ApiPropertyOptional({
    example: false,
    description:
      'Si el producto puede canjearse con estrellas del programa de fidelización (default false)',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'redeemableWithStars debe ser true o false' })
  redeemableWithStars?: boolean;

  @ApiPropertyOptional({
    example: false,
    description:
      'Si el producto puede canjearse específicamente con el premio especial (catálogo exclusivo, independiente de redeemableWithStars, default false)',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'specialReward debe ser true o false' })
  specialReward?: boolean;

  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'UUID de la categoría a la que pertenece',
  })
  @IsUUID('4', { message: 'categoryId debe ser un UUID válido' })
  categoryId: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description:
      'UUIDs de las salsas del catálogo que este producto ofrece (vacío u omitido = sin selector de salsas, ej. arroz chaufa)',
  })
  @IsOptionalNonNullable()
  @IsArray({ message: 'sauceIds debe ser una lista' })
  @IsUUID('4', { each: true, message: 'Cada sauceId debe ser un UUID válido' })
  sauceIds?: string[];

  @ApiPropertyOptional({
    example: false,
    description:
      'Si el grupo de salsas es obligatorio (default false). Sin efecto si sauceIds queda vacío.',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'sauceGroupRequired debe ser true o false' })
  sauceGroupRequired?: boolean;

  @ApiPropertyOptional({
    example: 1,
    type: Number,
    nullable: true,
    description:
      'Máximo de salsas que el cliente puede elegir para este producto. null u omitido al crear = sin límite (default). En PATCH, null quita el límite.',
  })
  @IsOptional()
  @IsInt({ message: 'sauceGroupMaxSelectable debe ser un número entero' })
  @Min(1, { message: 'sauceGroupMaxSelectable debe ser al menos 1' })
  sauceGroupMaxSelectable?: number | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description:
      'UUIDs de las bebidas del catálogo que este producto ofrece (vacío u omitido = sin selector de bebidas)',
  })
  @IsOptionalNonNullable()
  @IsArray({ message: 'beverageIds debe ser una lista' })
  @IsUUID('4', {
    each: true,
    message: 'Cada beverageId debe ser un UUID válido',
  })
  beverageIds?: string[];

  @ApiPropertyOptional({
    example: false,
    description:
      'Si el grupo de bebidas es obligatorio (default false). Sin efecto si beverageIds queda vacío.',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'beverageGroupRequired debe ser true o false' })
  beverageGroupRequired?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Máximo de bebidas que el cliente puede elegir para este producto (default 1)',
  })
  @IsOptionalNonNullable()
  @IsInt({ message: 'beverageGroupMaxSelectable debe ser un número entero' })
  @Min(1, { message: 'beverageGroupMaxSelectable debe ser al menos 1' })
  beverageGroupMaxSelectable?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description:
      'UUIDs de las porciones extras del catálogo que este producto ofrece (vacío u omitido = sin selector de porciones extras)',
  })
  @IsOptionalNonNullable()
  @IsArray({ message: 'extraPortionIds debe ser una lista' })
  @IsUUID('4', {
    each: true,
    message: 'Cada extraPortionId debe ser un UUID válido',
  })
  extraPortionIds?: string[];

  @ApiPropertyOptional({
    example: false,
    description:
      'Si el grupo de porciones extras es obligatorio (default false). Sin efecto si extraPortionIds queda vacío.',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'extraPortionsGroupRequired debe ser true o false' })
  extraPortionsGroupRequired?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Máximo de porciones extras que el cliente puede elegir para este producto (default 1)',
  })
  @IsOptionalNonNullable()
  @IsInt({
    message: 'extraPortionsGroupMaxSelectable debe ser un número entero',
  })
  @Min(1, { message: 'extraPortionsGroupMaxSelectable debe ser al menos 1' })
  extraPortionsGroupMaxSelectable?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Si la app debe ofrecer la opción explícita "Sin salsas" para este producto (default true). Con sauceGroupRequired=true, "Sin salsas" (sauceIds: [] explícito) cuenta como elección válida; con false, el pedido exige al menos una salsa. Omitir sauceIds en un grupo obligatorio siempre es 400.',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'sauceAllowWithout debe ser true o false' })
  sauceAllowWithout?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Si la app debe ofrecer la opción explícita "Sin bebida" para este producto (default true). Con beverageGroupRequired=true, "Sin bebida" (beverageIds: [] explícito) cuenta como elección válida; con false, el pedido exige al menos una bebida. Omitir beverageIds en un grupo obligatorio siempre es 400.',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'beverageAllowWithout debe ser true o false' })
  beverageAllowWithout?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Si la app debe ofrecer la opción explícita "Sin porciones extras" para este producto (default true). Con extraPortionsGroupRequired=true, "Sin porciones extras" (extraPortionIds: [] explícito) cuenta como elección válida; con false, el pedido exige al menos una. Omitir extraPortionIds en un grupo obligatorio siempre es 400.',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'extraPortionsAllowWithout debe ser true o false' })
  extraPortionsAllowWithout?: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description:
      'UUIDs de los tipos de papas que ofrece el producto (catálogo /fries-types). Vacío u omitido al crear = sin selector. En PATCH, omitido = no se toca; [] = quita todos.',
  })
  @IsOptionalNonNullable()
  @IsArray({ message: 'friesTypeIds debe ser una lista' })
  @IsUUID('4', {
    each: true,
    message: 'Cada friesTypeId debe ser un UUID válido',
  })
  friesTypeIds?: string[];

  @ApiPropertyOptional({
    example: false,
    description:
      'Si el cliente está obligado a elegir un tipo de papas (default false). Sin efecto si friesTypeIds queda vacío.',
  })
  @IsOptionalNonNullable()
  @IsBoolean({ message: 'friesTypeGroupRequired debe ser true o false' })
  friesTypeGroupRequired?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: 'Máximo de tipos de papas elegibles (default 1)',
  })
  @IsOptionalNonNullable()
  @IsInt({ message: 'friesTypeGroupMaxSelectable debe ser un número entero' })
  @Min(1, { message: 'friesTypeGroupMaxSelectable debe ser al menos 1' })
  friesTypeGroupMaxSelectable?: number;
}
