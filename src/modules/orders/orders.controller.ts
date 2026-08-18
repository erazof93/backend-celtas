import {
  Body,
  Controller,
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
import { UserRole } from '../users/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Crear un pedido (cliente)',
    description:
      'Valida productos disponibles, calcula subtotales y total en el backend, guarda el pedido en estado "pendiente" con el addressSnapshot y devuelve el pedido + whatsappUrl para confirmar por WhatsApp.',
  })
  @ApiResponse({ status: 201, description: 'Pedido creado con whatsappUrl' })
  @ApiResponse({
    status: 400,
    description: 'Payload inválido o producto no disponible',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({
    status: 404,
    description: 'Producto o dirección no encontrados',
  })
  @ApiResponse({
    status: 409,
    description:
      'El local está cerrado (horario programado o cierre manual temporal) o el cupón ya fue usado',
  })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(req.user.userId, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar mis pedidos (cliente)' })
  @ApiResponse({ status: 200, description: 'Lista de pedidos del usuario' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  listMine(@Req() req: AuthenticatedRequest) {
    return this.ordersService.findMyOrders(req.user.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Listar pedidos (solo admin, paginado, filtro por estado)',
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
    description: 'Pedidos por página (default 10, máx 100)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado'],
    description: 'Filtrar por estado',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    example: '3f2b1c4a-9d8e-4f6a-b7c5-1a2b3c4d5e6f',
    description: 'Filtrar los pedidos de un usuario específico (UUID)',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de pedidos' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  listAll(@Query() query: QueryOrdersDto) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Ver un pedido (cliente solo el suyo, admin cualquiera)',
  })
  @ApiParam({ name: 'id', description: 'UUID del pedido' })
  @ApiResponse({ status: 200, description: 'Detalle del pedido con sus items' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({
    status: 403,
    description: 'El pedido pertenece a otro usuario',
  })
  @ApiResponse({ status: 404, description: 'El pedido no existe' })
  getOne(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.findOne(id, req.user);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Actualizar el estado de un pedido (solo admin)',
    description:
      'Valida transiciones (pendiente→confirmado→en_camino→entregado; cancelado solo desde pendiente/confirmado). Al pasar a "entregado" suma el total a user.totalSpent en una transacción.',
  })
  @ApiParam({ name: 'id', description: 'UUID del pedido' })
  @ApiResponse({ status: 200, description: 'Pedido con el estado actualizado' })
  @ApiResponse({
    status: 400,
    description: 'Transición de estado inválida',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El pedido no existe' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto);
  }
}
