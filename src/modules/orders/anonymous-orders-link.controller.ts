import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import { LinkAnonymousOrdersDto } from './dto/link-anonymous-orders.dto';
import { OrdersService } from './orders.service';

/**
 * Vincular pedidos manuales anónimos a un cliente registrado (solo admin).
 * Vive en el módulo orders (usa sus repositorios y la lógica de totalSpent /
 * estrellas / cupones) aunque la ruta cuelgue de /users/:id, para no hacer que
 * UsersModule dependa de OrdersModule.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AnonymousOrdersLinkController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id/anonymous-orders')
  @ApiOperation({
    summary:
      'Pedidos anónimos que coinciden con el celular del cliente (solo admin)',
    description:
      'Preview antes de vincular: pedidos manuales sin cliente (userId null) cuyo customerPhone es el celular normalizado del cliente. No vincula nada. El teléfono solo no prueba identidad: el admin confirma con el cliente cuáles son suyos y los manda a POST /users/:id/link-anonymous-orders.',
  })
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  @ApiResponse({
    status: 200,
    description: '{ userId, phone, orders } (orders más recientes primero)',
  })
  @ApiResponse({
    status: 400,
    description:
      'id no es UUID, el usuario no es cliente, o no tiene un celular válido',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'El usuario no es admin' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  findAnonymousOrders(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findLinkableAnonymousOrders(id);
  }

  @Post(':id/link-anonymous-orders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vincular pedidos anónimos a un cliente registrado (solo admin)',
    description:
      'Adjunta al cliente los pedidos anónimos elegidos (orderIds del preview). Todo o nada: si alguno no existe, ya tiene cliente o su customerPhone no es el del cliente → 409 y no se vincula ninguno. Los entregados suman su total a totalSpent; después se recalculan estrellas (solo cuentan los entregados del mes en curso) y cupón automático, igual que al entregar.',
  })
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  @ApiResponse({
    status: 200,
    description: 'Vinculados',
    schema: {
      example: {
        success: true,
        data: {
          userId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          linkedOrderIds: ['5b1d7a2e-0c9f-4f7b-9a51-2d6e1f3c8b40'],
          deliveredTotalAdded: 49.8,
          totalSpent: 149.3,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Payload inválido, el usuario no es cliente, o no tiene un celular válido',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'El usuario no es admin' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({
    status: 409,
    description:
      'Algún pedido no es anónimo, no existe o no coincide el celular (no se vincula ninguno)',
  })
  linkAnonymousOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkAnonymousOrdersDto,
  ) {
    return this.ordersService.linkAnonymousOrders(id, dto.orderIds);
  }
}
