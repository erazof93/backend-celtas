import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import { AdminDashboardService } from './admin-dashboard.service';
import {
  DashboardQueryDto,
  DaysQueryDto,
  TopProductsQueryDto,
} from './dto/dashboard-query.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get('dashboard/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Resumen del dashboard (solo admin)',
    description:
      'Pedidos creados en el rango (todos los estados), conteo por estado y ventas (revenue) de pedidos ENTREGADOS en el rango. Las fechas se interpretan en la zona horaria de Lima (America/Lima); si no se pasan, se usa hoy.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2026-08-01',
    description: 'Fecha inicial (YYYY-MM-DD). Default: hoy en America/Lima.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    example: '2026-08-31',
    description: 'Fecha final (YYYY-MM-DD). Default: hoy en America/Lima.',
  })
  @ApiResponse({
    status: 200,
    description: '{ ordersCount, ordersByStatus: [{status, count}], revenue }',
  })
  @ApiResponse({ status: 400, description: 'Formato de fecha inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  summary(@Query() query: DashboardQueryDto) {
    return this.dashboardService.summary(query);
  }

  @Get('dashboard/top-products')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Productos más vendidos (solo admin)',
    description:
      'Agrupa los items de pedidos ENTREGADOS en el rango por producto, suma cantidad y revenue, y ordena por cantidad descendente. Usa el nombre del snapshot del pedido (no el del menú actual). Las fechas se interpretan en America/Lima.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2026-08-01',
    description: 'Fecha inicial (YYYY-MM-DD). Default: hoy en America/Lima.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    example: '2026-08-31',
    description: 'Fecha final (YYYY-MM-DD). Default: hoy en America/Lima.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    example: 7,
    description:
      'Atajo: últimos N días incluyendo hoy (1-90). No se combina con from/to.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Cantidad máxima de productos (1-50). Default: 10.',
  })
  @ApiResponse({
    status: 200,
    description: '{ items: [{ menuItemId, name, quantity, revenue }], limit }',
  })
  @ApiResponse({
    status: 400,
    description:
      'Formato de fecha, days o limit inválido, o days junto con from/to',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  topProducts(@Query() query: TopProductsQueryDto) {
    return this.dashboardService.topProducts(query);
  }

  @Get('dashboard/metrics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Métricas de hoy, semana y mes (solo admin)',
    description:
      'Períodos calendario en America/Lima: hoy, semana (desde el lunes) y mes (desde el día 1), hasta hoy. `orders`/`ordersApp`/`ordersPhone` cuentan pedidos CREADOS en el período (todos los estados; `ordersPhone` = cargados desde el panel). `revenue` suma pedidos ENTREGADOS en el período. `month.newCustomers` = clientes registrados en el mes.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ today: { orders, revenue, ordersApp, ordersPhone }, week: {...}, month: {..., newCustomers} }',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  metrics() {
    return this.dashboardService.metrics();
  }

  @Get('dashboard/revenue-trend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Ventas y pedidos por día (solo admin)',
    description:
      'Un elemento por día de los últimos N días (incluye hoy y los días sin movimiento en 0), en America/Lima, orden ascendente. `revenue` = pedidos ENTREGADOS ese día; `ordersApp`/`ordersPhone` = pedidos CREADOS ese día por canal.',
  })
  @ApiResponse({
    status: 200,
    description: '[{ date: "YYYY-MM-DD", revenue, ordersApp, ordersPhone }]',
  })
  @ApiResponse({ status: 400, description: 'days fuera de rango (1-90)' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  revenueTrend(@Query() query: DaysQueryDto) {
    return this.dashboardService.revenueTrend(query);
  }

  @Get('dashboard/new-customers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Clientes nuevos por día (solo admin)',
    description:
      'Clientes (rol cliente, email o Google) registrados en los últimos N días, en America/Lima: total y un elemento por día (incluye los días en 0), orden ascendente.',
  })
  @ApiResponse({
    status: 200,
    description: '{ total, byDay: [{ date: "YYYY-MM-DD", count }] }',
  })
  @ApiResponse({ status: 400, description: 'days fuera de rango (1-90)' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  newCustomers(@Query() query: DaysQueryDto) {
    return this.dashboardService.newCustomers(query);
  }
}
