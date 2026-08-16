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
import { CreateSauceDto } from './dto/create-sauce.dto';
import { UpdateSauceDto } from './dto/update-sauce.dto';
import { SaucesService } from './sauces.service';

/**
 * Catálogo de salsas/cremas, gestionado solo por admin. La app cliente NO consume
 * este endpoint directamente: recibe las salsas de cada producto embebidas en la
 * respuesta de `GET /menu` (ver MenuService.findPublicMenu), consistente con el
 * patrón ya usado para categorías/productos.
 */
@ApiTags('sauces')
@Controller('sauces')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class SaucesController {
  constructor(private readonly saucesService: SaucesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas las salsas del catálogo (admin)' })
  @ApiResponse({ status: 200, description: 'Lista de salsas' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  findAll() {
    return this.saucesService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Crear una salsa en el catálogo (admin)' })
  @ApiResponse({ status: 201, description: 'Salsa creada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una salsa con ese nombre',
  })
  create(@Body() dto: CreateSauceDto) {
    return this.saucesService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar una salsa del catálogo (admin)' })
  @ApiParam({ name: 'id', description: 'UUID de la salsa' })
  @ApiResponse({ status: 200, description: 'Salsa actualizada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La salsa no existe' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe otra salsa con ese nombre',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSauceDto) {
    return this.saucesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar una salsa del catálogo (admin)',
    description:
      'No afecta pedidos ya creados (guardan un snapshot de texto); solo la quita de la oferta futura de los productos que la tenían asignada.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la salsa' })
  @ApiResponse({ status: 200, description: 'Salsa eliminada' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La salsa no existe' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.saucesService.remove(id);
  }
}
