import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from './entities/user.entity';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersService } from './users.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('users')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Sin token o token inválido' })
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly addressesService: AddressesService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Perfil del usuario autenticado (leído de la BD)' })
  @ApiResponse({ status: 200, description: 'Perfil del usuario actual' })
  getMe(@Req() req: AuthenticatedRequest) {
    return this.usersService.getProfile(req.user.userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Editar el perfil propio (solo fullName y phone)',
    description:
      'email, password, provider, role y totalSpent no son editables: enviarlos devuelve 400.',
  })
  @ApiResponse({ status: 200, description: 'Perfil actualizado' })
  @ApiResponse({
    status: 400,
    description: 'Payload inválido o campo no permitido',
  })
  updateMe(@Req() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  @Patch('me/fcm-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Guardar/actualizar el token FCM del dispositivo actual',
    description:
      'Sobrescribe el token anterior (single-device por ahora). Lo llama la app al iniciar sesión o al cambiar de dispositivo.',
  })
  @ApiResponse({ status: 200, description: 'Token FCM actualizado' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  updateFcmToken(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateFcmTokenDto,
  ) {
    return this.usersService.updateFcmToken(req.user.userId, dto.fcmToken);
  }

  @Get('me/addresses')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar las direcciones del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Lista de direcciones (principal primero)',
  })
  listAddresses(@Req() req: AuthenticatedRequest) {
    return this.addressesService.findByUser(req.user.userId);
  }

  @Post('me/addresses')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Crear una nueva dirección' })
  @ApiResponse({ status: 201, description: 'Dirección creada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  createAddress(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateAddressDto,
  ) {
    return this.addressesService.create(req.user.userId, dto);
  }

  @Patch('me/addresses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Editar una dirección propia' })
  @ApiParam({ name: 'id', description: 'UUID de la dirección' })
  @ApiResponse({ status: 200, description: 'Dirección actualizada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({
    status: 403,
    description: 'La dirección pertenece a otro usuario',
  })
  @ApiResponse({ status: 404, description: 'La dirección no existe' })
  updateAddress(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressesService.update(req.user.userId, id, dto);
  }

  @Delete('me/addresses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Eliminar una dirección propia' })
  @ApiParam({ name: 'id', description: 'UUID de la dirección' })
  @ApiResponse({ status: 200, description: 'Dirección eliminada' })
  @ApiResponse({
    status: 403,
    description: 'La dirección pertenece a otro usuario',
  })
  @ApiResponse({ status: 404, description: 'La dirección no existe' })
  removeAddress(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.addressesService.remove(req.user.userId, id);
  }

  @Get(':id/addresses')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Listar las direcciones de un usuario (solo admin)',
    description:
      'Vista 360 del cliente en el panel admin. 404 si el usuario no existe; array vacío si no tiene direcciones.',
  })
  @ApiParam({ name: 'id', description: 'UUID del usuario' })
  @ApiResponse({
    status: 200,
    description: 'Lista de direcciones del usuario (principal primero)',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El usuario no existe' })
  async listUserAddresses(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersService.ensureExists(id);
    return this.addressesService.findByUser(id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Listar usuarios (solo admin, paginado, sin password)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Número de página (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Usuarios por página (default 10, máx 100)',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['totalSpent', 'createdAt'],
    description:
      'Columna de ordenamiento. Sin este param, el comportamiento actual (createdAt DESC) queda intacto.',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description: 'Orden ascendente o descendente (default desc)',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de usuarios' })
  @ApiResponse({
    status: 400,
    description: 'sortBy u order con un valor no permitido',
  })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  listUsers(@Req() _req: AuthenticatedRequest, @Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Patch(':id/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Cambiar el rol de un usuario (solo admin)',
    description:
      'Solo acepta cliente o admin. Un admin no puede quitarse su propio rol de admin (400).',
  })
  @ApiParam({ name: 'id', description: 'UUID del usuario' })
  @ApiResponse({ status: 200, description: 'Rol actualizado' })
  @ApiResponse({
    status: 400,
    description: 'Payload inválido o auto-degradación',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El usuario no existe' })
  updateRole(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateRole(req.user.userId, id, dto.role);
  }
}
