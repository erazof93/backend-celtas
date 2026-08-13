import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Columnas por las que se puede ordenar GET /users (whitelist, evita inyección de columna). */
export enum UsersSortBy {
  TOTAL_SPENT = 'totalSpent',
  CREATED_AT = 'createdAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/** Query params para el listado paginado de usuarios (GET /users). */
export class QueryUsersDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: 'Número de página',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La página debe ser un número entero' })
  @Min(1, { message: 'La página mínima es 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    example: 10,
    default: 10,
    description: 'Usuarios por página (máx. 100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1, { message: 'El límite mínimo es 1' })
  @Max(100, { message: 'El límite máximo es 100' })
  limit?: number = 10;

  @ApiPropertyOptional({
    enum: UsersSortBy,
    description:
      'Columna de ordenamiento. Sin este param, el comportamiento actual (createdAt DESC) queda intacto.',
  })
  @IsOptional()
  @IsEnum(UsersSortBy, {
    message: `sortBy debe ser uno de: ${Object.values(UsersSortBy).join(', ')}`,
  })
  sortBy?: UsersSortBy;

  @ApiPropertyOptional({
    enum: SortOrder,
    default: SortOrder.DESC,
    description: 'Orden ascendente o descendente (default desc)',
  })
  @IsOptional()
  @IsEnum(SortOrder, { message: 'order debe ser asc o desc' })
  order?: SortOrder = SortOrder.DESC;
}
