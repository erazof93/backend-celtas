import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
  CreateDeliveryZoneDto,
  UpdateDeliveryZoneDto,
} from './dto/create-delivery-zone.dto';
import {
  DeliveryZoneEnvelopeDto,
  DeliveryZoneListResponseDto,
} from './dto/delivery-response.dto';
import { DeliveryZonesService } from './delivery-zones.service';

@ApiTags('delivery-zones')
@Controller('delivery/zones')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Sin token o token inválido' })
@ApiResponse({ status: 403, description: 'Requiere rol admin' })
export class DeliveryZonesController {
  constructor(private readonly zonesService: DeliveryZonesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar zonas de delivery, incluidas inactivas (admin)',
  })
  @ApiResponse({ status: 200, type: DeliveryZoneListResponseDto })
  findAll() {
    return this.zonesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una zona de delivery (admin)' })
  @ApiResponse({ status: 200, type: DeliveryZoneEnvelopeDto })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse({ status: 404, description: 'Zona no encontrada' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.zonesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear una zona de delivery (admin)' })
  @ApiResponse({ status: 201, type: DeliveryZoneEnvelopeDto })
  @ApiResponse({ status: 400, description: 'Payload o geometría inválida' })
  @ApiResponse({
    status: 409,
    description: 'Solapamiento interior con otra zona',
  })
  create(@Body() dto: CreateDeliveryZoneDto) {
    return this.zonesService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar o desactivar una zona de delivery (admin)',
  })
  @ApiResponse({ status: 200, type: DeliveryZoneEnvelopeDto })
  @ApiResponse({
    status: 400,
    description: 'Payload, UUID o geometría inválida',
  })
  @ApiResponse({ status: 404, description: 'Zona no encontrada' })
  @ApiResponse({
    status: 409,
    description:
      'Solapamiento interior o intento de desactivar la \u00faltima zona activa en ZONES',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryZoneDto,
  ) {
    return this.zonesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar una zona de delivery (admin)',
    description: 'No modifica snapshots de pedidos históricos',
  })
  @ApiResponse({ status: 200, description: 'Zona eliminada; data omitido' })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse({ status: 404, description: 'Zona no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'No se puede eliminar la \u00faltima zona activa en ZONES',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.zonesService.remove(id);
  }
}
