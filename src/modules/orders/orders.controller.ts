import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import { CreateOrderAdminDto } from './dto/create-order-admin.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { EstimateDeliveryFeeDto } from './dto/estimate-delivery-fee.dto';
import { DeliveryEstimateResponseDto } from '../delivery/dto/delivery-response.dto';
import { GeocodeAddressDto } from './dto/geocode-address.dto';
import { QueryMyOrdersDto } from './dto/query-my-orders.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

/** Máximo de GET /orders/geocode por usuario por minuto. */
export const GEOCODE_LIMIT_PER_MINUTE = 10;

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
      'Valida productos disponibles, calcula subtotales y total en el backend, guarda el pedido en estado "pendiente" con snapshots de dirección y delivery y devuelve el pedido + whatsappUrl. En ZONES rechaza direcciones sin cobertura o coordenadas válidas; DISTANCE conserva el comportamiento anterior.',
  })
  @ApiResponse({ status: 201, description: 'Pedido creado con whatsappUrl' })
  @ApiResponse({
    status: 400,
    description:
      'Payload inválido, producto no disponible o dirección sin cobertura/coordenadas válidas en ZONES',
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

  @Post('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Crear un pedido manual (solo admin)',
    description:
      'Para pedidos tomados fuera de la app (ej. por teléfono). Precios snapshot, cupón y premios como POST /orders; NO bloquea por horario. Delivery en ZONES: aplica zona si tiene cobertura; fuera de cobertura o sin coordenadas válidas rechaza con 400, sin fallback a DISTANCE. Con customerId valida addressId/cupón/premios contra ese cliente; sin él exige customerName + customerPhone y dirección por addressSnapshot (incluir latitude/longitude para calcular delivery). whatsappUrl apunta al cliente, con fallback al negocio. Un pedido anónimo entregado no suma totalSpent, estrellas ni cupones.',
  })
  @ApiResponse({
    status: 201,
    description: 'Pedido creado en "pendiente" con whatsappUrl al cliente',
  })
  @ApiResponse({
    status: 400,
    description:
      'Payload inválido, producto no disponible, falta contacto/dirección, sin cobertura en ZONES, o addressId/cupón/premio en un pedido anónimo',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'El usuario no es admin' })
  @ApiResponse({
    status: 404,
    description: 'Cliente, producto o dirección no encontrados',
  })
  @ApiResponse({ status: 409, description: 'El cupón ya fue usado' })
  createOrderByAdmin(@Body() dto: CreateOrderAdminDto) {
    return this.ordersService.createOrderByAdmin(dto);
  }

  @Get('admin/:orderId/whatsapp-links')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Links de WhatsApp de un pedido: cliente y tienda (solo admin)',
    description:
      'El backend NO envía mensajes: devuelve links wa.me que el admin abre desde el panel. Se rearman desde el snapshot del pedido con el número del negocio actual. `customer` ("CONFIRMA TU PEDIDO") sale de customerPhone (anónimo) o del teléfono del cliente; es null si no hay un celular válido (peruano o extranjero con código de país). `store` ("NUEVO PEDIDO") siempre viene. Tras mandarlo, el panel llama a POST /orders/admin/:orderId/whatsapp-sent.',
  })
  @ApiParam({ name: 'orderId', description: 'UUID del pedido' })
  @ApiResponse({
    status: 200,
    description: 'Links de WhatsApp y whatsappSentAt',
    schema: {
      example: {
        success: true,
        data: {
          orderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          customer: {
            phone: '51987654321',
            url: 'https://wa.me/51987654321?text=...',
          },
          store: {
            phone: '51999999999',
            url: 'https://wa.me/51999999999?text=...',
          },
          whatsappSentAt: null,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'orderId no es un UUID válido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'El usuario no es admin' })
  @ApiResponse({ status: 404, description: 'Pedido no encontrado' })
  @ApiResponse({ status: 409, description: 'El pedido está cancelado' })
  getWhatsappLinks(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.ordersService.getWhatsappLinks(orderId);
  }

  @Post('admin/:orderId/whatsapp-sent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marcar que el admin mandó el WhatsApp del pedido (solo admin)',
    description:
      'Registra la CONFIRMACIÓN del admin de que ya mandó el WhatsApp (el backend no envía nada). Guarda whatsappSentAt la primera vez; llamadas repetidas devuelven la misma fecha sin pisarla.',
  })
  @ApiParam({ name: 'orderId', description: 'UUID del pedido' })
  @ApiResponse({
    status: 200,
    description: 'Fecha de la (primera) confirmación',
    schema: {
      example: {
        success: true,
        data: {
          orderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          whatsappSentAt: '2026-09-30T22:15:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'orderId no es un UUID válido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'El usuario no es admin' })
  @ApiResponse({ status: 404, description: 'Pedido no encontrado' })
  @ApiResponse({ status: 409, description: 'El pedido está cancelado' })
  markWhatsappSent(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.ordersService.markWhatsappSent(orderId);
  }

  @Post('estimate-delivery-fee')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Estimar el costo de delivery de una dirección guardada (cliente)',
    description:
      'Misma resolución que POST /orders, sin crear pedido. DISTANCE conserva tarifa 0 sin coordenadas. ZONES devuelve isCovered=false sin zona activa o coordenadas válidas; tarifa 0 es un marcador sin cotización. isFarOrder sigue siendo aviso de distancia.',
  })
  @ApiResponse({
    status: 201,
    description:
      'deliveryFee, isFarOrder y distanceMeters calculados (distanceMeters redondeado a múltiplos de 50 m; la tarifa DISTANCE usa la distancia exacta)',
    type: DeliveryEstimateResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({
    status: 404,
    description:
      'La dirección no existe, no pertenece al usuario, o store_location no está configurada',
  })
  estimateDeliveryFee(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EstimateDeliveryFeeDto,
  ) {
    return this.ordersService.estimateDeliveryFee(req.user.userId, dto);
  }

  // Declarado antes de GET /orders/:id para que 'geocode' no se tome como un :id.
  @Get('geocode')
  // Protege los 5 req/seg del plan gratis de Geoapify, compartidos con el
  // autocompletado de la app. 'auth' es el único throttler registrado
  // (AuthModule); el contador es propio de este handler, no se mezcla con login.
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ auth: { limit: GEOCODE_LIMIT_PER_MINUTE, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Geocodificar una dirección a coordenadas [lat, lng]',
    description:
      'Resuelve la dirección con Geoapify (filtrado a Perú). Devuelve [latitude, longitude]. Incluir distrito o ciudad en el texto: "Jr. Carabaya 250" sin ciudad no se encuentra, "Jr. Carabaya 250, Lima" sí. Resultados con confianza < 0.5 se tratan como no encontrados.',
  })
  @ApiResponse({
    status: 200,
    description: 'Coordenadas [latitude, longitude]',
    schema: { example: { success: true, data: [-12.0466994, -77.03041] } },
  })
  @ApiResponse({
    status: 400,
    description: 'Dirección vacía, demasiado larga o no encontrada',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({
    status: 429,
    description: `Más de ${GEOCODE_LIMIT_PER_MINUTE} geocodificaciones por minuto del mismo usuario`,
  })
  @ApiResponse({
    status: 503,
    description:
      'Geoapify no disponible (API key sin configurar, rate limit o caída)',
  })
  geocodeAddress(@Query() dto: GeocodeAddressDto) {
    return this.ordersService.geocodeAddress(dto.address);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar mis pedidos (cliente)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Cantidad máxima de pedidos a devolver (default 20, máx 100)',
  })
  @ApiResponse({ status: 200, description: 'Lista de pedidos del usuario' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  listMine(@Req() req: AuthenticatedRequest, @Query() query: QueryMyOrdersDto) {
    return this.ordersService.findMyOrders(req.user.userId, query.limit);
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
      'Valida transiciones (pendiente→confirmado→en_camino→entregado; cancelado desde pendiente/confirmado/en_camino). Al pasar a "entregado" suma el total a user.totalSpent en una transacción. Al cancelar un pedido "en_camino" es obligatorio enviar cancelReason; en el resto de transiciones a "cancelado" es opcional.',
  })
  @ApiParam({ name: 'id', description: 'UUID del pedido' })
  @ApiResponse({ status: 200, description: 'Pedido con el estado actualizado' })
  @ApiResponse({
    status: 400,
    description:
      'Transición de estado inválida, o falta cancelReason al cancelar un pedido en_camino',
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
