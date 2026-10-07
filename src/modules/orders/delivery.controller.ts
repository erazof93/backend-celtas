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
import { DeliveryEstimateResponseDto } from '../delivery/dto/delivery-response.dto';

/**
 * Vive en el módulo de orders porque el cálculo (`computeDelivery`) es de
 * `OrdersService`; la resolución de zonas se comparte mediante DeliveryModule.
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
      'Misma resolución que POST /orders. DISTANCE: Haversine y tramos, sin bloqueo por distancia. ZONES: tarifa de zona activa; isCovered=false significa sin cotización y el checkout de cliente se rechaza. isFarOrder conserva el aviso por distancia en ambos modos. No devuelve polígonos.',
  })
  @ApiResponse({
    status: 200,
    type: DeliveryEstimateResponseDto,
    description:
      'deliveryFee, isFarOrder y distanceMeters calculados (distanceMeters redondeado a múltiplos de 50 m; la tarifa DISTANCE usa la distancia exacta)',
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
