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
    description: 'Formato de fecha o limit inválido',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  topProducts(@Query() query: TopProductsQueryDto) {
    return this.dashboardService.topProducts(query);
  }
}
