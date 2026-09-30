import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EstimateDeliveryByCoordsDto } from './dto/estimate-delivery-by-coords.dto';
import { OrdersService } from './orders.service';

/**
 * Vive en el módulo de orders porque el cálculo (`computeDelivery`) es de
 * `OrdersService` — no hay un módulo de delivery aparte.
 */
@ApiTags('delivery')
@ApiBearerAuth()
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly ordersService: OrdersService) {}

  // Con login a propósito (además de distanceMeters redondeado a 50 m en
  // computeDelivery): sube el costo de triangular la ubicación del local.
  @Get('estimate')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Estimar el costo de delivery para unas coordenadas (cliente)',
    description:
      'Mismo cálculo que POST /orders (Haversine contra store_location + tramo de delivery_fee_tiers) para coordenadas sueltas, ej. el pin del mapa antes de guardar la dirección. Nunca rechaza por distancia: isFarOrder indica si supera delivery_alert_radius_meters.',
  })
  @ApiResponse({
    status: 200,
    description:
      'deliveryFee, isFarOrder y distanceMeters calculados (distanceMeters redondeado a múltiplos de 50 m; la tarifa usa la distancia exacta)',
  })
  @ApiResponse({
    status: 400,
    description: 'latitude/longitude faltantes, no numéricas o fuera de rango',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({
    status: 404,
    description: 'store_location no está configurada',
  })
  estimate(@Query() query: EstimateDeliveryByCoordsDto) {
    return this.ordersService.estimateDeliveryByCoords(query);
  }
}
