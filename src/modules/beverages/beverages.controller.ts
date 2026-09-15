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
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import { BeveragesService } from './beverages.service';
import { CreateBeverageDto } from './dto/create-beverage.dto';
import { UpdateBeverageDto } from './dto/update-beverage.dto';

/**
 * Catálogo de bebidas, gestionado solo por admin. La app cliente NO consume este
 * endpoint directamente: recibe las bebidas de cada producto embebidas en la
 * respuesta de `GET /menu` (ver MenuService.findPublicMenu), consistente con el
 * patrón ya usado para salsas/categorías/productos.
 */
@ApiTags('beverages')
@Controller('beverages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class BeveragesController {
  constructor(private readonly beveragesService: BeveragesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas las bebidas del catálogo (admin)' })
  @ApiResponse({ status: 200, description: 'Lista de bebidas' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  findAll() {
    return this.beveragesService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Crear una bebida en el catálogo (admin)' })
  @ApiResponse({ status: 201, description: 'Bebida creada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una bebida con ese nombre',
  })
  create(@Body() dto: CreateBeverageDto) {
    return this.beveragesService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar una bebida del catálogo (admin)' })
  @ApiParam({ name: 'id', description: 'UUID de la bebida' })
  @ApiResponse({ status: 200, description: 'Bebida actualizada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La bebida no existe' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe otra bebida con ese nombre',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBeverageDto,
  ) {
    return this.beveragesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar una bebida del catálogo (admin)',
    description:
      'No afecta pedidos ya creados (guardan un snapshot de nombre + precio); solo la quita de la oferta futura de los productos que la tenían asignada.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la bebida' })
  @ApiResponse({ status: 200, description: 'Bebida eliminada' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La bebida no existe' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.beveragesService.remove(id);
  }
}
