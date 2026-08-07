import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { UserRole } from '../entities/user.entity';

/** Cambio de rol de un usuario (solo admin). */
export class UpdateUserRoleDto {
  @ApiProperty({
    enum: UserRole,
    example: UserRole.ADMIN,
    description: 'Nuevo rol: cliente o admin',
  })
  @IsEnum(UserRole, { message: 'role debe ser cliente o admin' })
  role: UserRole;
}
