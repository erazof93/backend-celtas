import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../modules/users/entities/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Declara qué roles pueden acceder a un endpoint (se usa junto a RolesGuard):
 *
 *   @Roles(UserRole.ADMIN)
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
