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
import { CreateFriesTypeDto } from './dto/create-fries-type.dto';
import { UpdateFriesTypeDto } from './dto/update-fries-type.dto';
import { FriesTypesService } from './fries-types.service';

/**
 * Catálogo de tipos de papas, gestionado solo por admin. La app cliente recibe
 * los tipos de cada producto embebidos en `GET /menu` (mismo patrón que salsas).
 */
@ApiTags('fries-types')
@Controller('fries-types')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class FriesTypesController {
  constructor(private readonly friesTypesService: FriesTypesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar los tipos de papas del catálogo (admin)' })
  @ApiResponse({ status: 200, description: 'Lista de tipos de papas' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  findAll() {
    return this.friesTypesService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Crear un tipo de papas (admin)' })
  @ApiResponse({ status: 201, description: 'Tipo de papas creado' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 409, description: 'Ya existe uno con ese nombre' })
  create(@Body() dto: CreateFriesTypeDto) {
    return this.friesTypesService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar un tipo de papas (admin)' })
  @ApiParam({ name: 'id', description: 'UUID del tipo de papas' })
  @ApiResponse({ status: 200, description: 'Tipo de papas actualizado' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El tipo de papas no existe' })
  @ApiResponse({ status: 409, description: 'Ya existe otro con ese nombre' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFriesTypeDto,
  ) {
    return this.friesTypesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar un tipo de papas (admin)',
    description:
      'No afecta pedidos ya creados (guardan un snapshot de texto); solo lo quita de la oferta futura de los productos que lo tenían.',
  })
  @ApiParam({ name: 'id', description: 'UUID del tipo de papas' })
  @ApiResponse({ status: 200, description: 'Tipo de papas eliminado' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El tipo de papas no existe' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.friesTypesService.remove(id);
  }
}
