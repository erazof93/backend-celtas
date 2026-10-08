import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UserRole } from '../../users/entities/user.entity';
import { OrderEventsGuard } from './order-events.guard';
import type { StreamRequest } from './order-events.guard';
import { OrderEventsStreamService } from './order-events-stream.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('admin/orders')
export class OrderEventsController {
  constructor(private readonly streams: OrderEventsStreamService) {}

  @Get('events')
  @RawResponse()
  @UseGuards(OrderEventsGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary:
      'Eventos administrativos de pedidos; Bearer y Last-Event-ID opcional',
  })
  @ApiResponse({
    status: 200,
    description: 'SSE v1; sin envelope REST ni información personal',
  })
  @ApiResponse({ status: 400, description: 'Cursor o parámetros inválidos' })
  @ApiResponse({ status: 401, description: 'JWT inválido o expirado' })
  @ApiResponse({ status: 403, description: 'Rol insuficiente' })
  @ApiResponse({ status: 429, description: 'Límite por usuario o instancia' })
  @ApiResponse({
    status: 503,
    description: 'Infraestructura desactivada o no disponible',
  })
  open(
    @Req() request: StreamRequest,
    @Res() response: Response,
  ): Promise<void> {
    return this.streams.open(request, response);
  }
}
