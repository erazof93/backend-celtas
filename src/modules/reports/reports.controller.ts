import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import {
  ReportComparisonQueryDto,
  ReportDailyMetricsQueryDto,
  ReportRangeQueryDto,
  ReportSummaryQueryDto,
  ReportTopProductsQueryDto,
} from './dto/report-query.dto';
import { ReportsService } from './reports.service';

const BASE_DESCRIPTION =
  'Base: pedidos ENTREGADOS en el rango (por deliveredAt, días completos en America/Lima). Canal app = POST /orders; phone = cargado desde el panel (POST /orders/admin). Cliente = userId, o el cliente registrado con el mismo celular si el pedido fue anónimo.';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Resumen por canal y por período (solo admin)',
    description: `${BASE_DESCRIPTION} \`data\` trae un elemento por período del rango (incluye los vacíos); \`period\` es el inicio del período: el día, el lunes (week) o el día 1 (month).`,
  })
  @ApiResponse({
    status: 200,
    description:
      '{ period: { start, end }, summary: { totalRevenue, totalOrders, totalCustomers, averageTicket }, byChannel: { app, phone }, data: [...] }',
  })
  @ApiResponse({
    status: 400,
    description:
      'Fechas inválidas, rango invertido o > 366 días, groupBy inválido',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  summary(@Query() query: ReportSummaryQueryDto) {
    return this.reportsService.summary(query);
  }

  @Get('comparison')
  @ApiOperation({
    summary: 'Comparación entre dos períodos (solo admin)',
    description: `${BASE_DESCRIPTION} Los cambios son porcentajes con 1 decimal y signo ("+11.6%"); null si el período anterior es 0.`,
  })
  @ApiResponse({
    status: 200,
    description:
      '{ current: { period, revenue, orders, averageTicket }, previous: {...}, comparison: { revenueChange, ordersChange, ticketChange }, byChannel: { app, phone } }',
  })
  @ApiResponse({
    status: 400,
    description:
      'current/previous con formato distinto de YYYY-MM-DD:YYYY-MM-DD, fechas inválidas, invertidas o > 366 días',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  comparison(@Query() query: ReportComparisonQueryDto) {
    return this.reportsService.comparison(query);
  }

  @Get('top-products')
  @ApiOperation({
    summary: 'Productos más vendidos con desglose por canal (solo admin)',
    description: `${BASE_DESCRIPTION} Revenue de producto = unitPrice × quantity (sin delivery ni extras), nombre del snapshot del pedido. Porcentajes sobre el total del canal pedido. Orden: quantity y luego revenue, descendente; empates por nombre.`,
  })
  @ApiResponse({
    status: 200,
    description:
      '[{ id, name, quantity, revenue, revenuePercentage, quantityPercentage, averagePrice, byChannel: { app, phone } }]',
  })
  @ApiResponse({
    status: 400,
    description: 'Fechas inválidas, limit fuera de 1-50 o channel inválido',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  topProducts(@Query() query: ReportTopProductsQueryDto) {
    return this.reportsService.topProducts(query);
  }

  @Get('conversion')
  @ApiOperation({
    summary: 'Conversión de clientes de teléfono a la app (solo admin)',
    description: `${BASE_DESCRIPTION} Convertido = cliente con pedido por teléfono entregado en el rango que después de su primer pedido por teléfono del rango hizo un pedido por app entregado (hasta hoy). Un anónimo solo se convierte si su celular coincide con el de un cliente registrado.`,
  })
  @ApiResponse({
    status: 200,
    description:
      '{ period, phoneOrders, phoneCustomers, convertedToApp, conversionRate, timeline: [{ phoneOrderDate, appOrderDate, daysDiff }] }',
  })
  @ApiResponse({ status: 400, description: 'Fechas inválidas' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  conversion(@Query() query: ReportRangeQueryDto) {
    return this.reportsService.conversion(query);
  }

  @Get('daily-metrics')
  @ApiOperation({
    summary: 'Métricas día por día (solo admin)',
    description: `${BASE_DESCRIPTION} Un elemento por día del rango (incluye los vacíos). Con includeStatus=true agrega deliveredOrders/pendingOrders/cancelledOrders: pedidos CREADOS ese día según su estado actual (pending = pendiente, confirmado o en_camino).`,
  })
  @ApiResponse({
    status: 200,
    description:
      '{ days: [{ date, revenue, revenueApp, revenuePhone, orders, ordersApp, ordersPhone, customers, averageTicket, (deliveredOrders, pendingOrders, cancelledOrders) }] }',
  })
  @ApiResponse({
    status: 400,
    description: 'Fechas inválidas o includeStatus distinto de true/false',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  dailyMetrics(@Query() query: ReportDailyMetricsQueryDto) {
    return this.reportsService.dailyMetrics(query);
  }
}
