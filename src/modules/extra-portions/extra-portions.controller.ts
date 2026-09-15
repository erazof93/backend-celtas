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
import { CreateExtraPortionDto } from './dto/create-extra-portion.dto';
import { UpdateExtraPortionDto } from './dto/update-extra-portion.dto';
import { ExtraPortionsService } from './extra-portions.service';

/**
 * Catálogo de porciones extras, gestionado solo por admin. La app cliente NO
 * consume este endpoint directamente: recibe las porciones extras de cada
 * producto embebidas en la respuesta de `GET /menu` (ver
 * MenuService.findPublicMenu), consistente con el patrón ya usado para
 * salsas/bebidas/categorías/productos.
 */
@ApiTags('extra-portions')
@Controller('extra-portions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class ExtraPortionsController {
  constructor(private readonly extraPortionsService: ExtraPortionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar todas las porciones extras del catálogo (admin)',
  })
  @ApiResponse({ status: 200, description: 'Lista de porciones extras' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  findAll() {
    return this.extraPortionsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Crear una porción extra en el catálogo (admin)' })
  @ApiResponse({ status: 201, description: 'Porción extra creada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una porción extra con ese nombre',
  })
  create(@Body() dto: CreateExtraPortionDto) {
    return this.extraPortionsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar una porción extra del catálogo (admin)' })
  @ApiParam({ name: 'id', description: 'UUID de la porción extra' })
  @ApiResponse({ status: 200, description: 'Porción extra actualizada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La porción extra no existe' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe otra porción extra con ese nombre',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExtraPortionDto,
  ) {
    return this.extraPortionsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar una porción extra del catálogo (admin)',
    description:
      'No afecta pedidos ya creados (guardan un snapshot de nombre + precio); solo la quita de la oferta futura de los productos que la tenían asignada.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la porción extra' })
  @ApiResponse({ status: 200, description: 'Porción extra eliminada' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La porción extra no existe' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.extraPortionsService.remove(id);
  }
}
