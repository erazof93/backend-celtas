import {
  Body,
  Controller,
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
import { CreateStarPromotionDto } from './dto/create-star-promotion.dto';
import { UpdateStarPromotionDto } from './dto/update-star-promotion.dto';
import { StarPromotionsService } from './star-promotions.service';

@ApiTags('star-promotions')
@ApiBearerAuth()
@Controller('star-promotions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class StarPromotionsController {
  constructor(private readonly starPromotionsService: StarPromotionsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar promociones de estrellas (admin)' })
  @ApiResponse({ status: 200, description: 'Lista de promociones' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  findAll() {
    return this.starPromotionsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una promoción de estrellas (admin)' })
  @ApiParam({ name: 'id', description: 'UUID de la promoción' })
  @ApiResponse({ status: 200, description: 'Promoción encontrada' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La promoción no existe' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.starPromotionsService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Crear una promoción de estrellas (admin)',
    description:
      'Rechaza con 400 si otra promoción activa se solapa con el rango de fechas.',
  })
  @ApiResponse({ status: 201, description: 'Promoción creada' })
  @ApiResponse({
    status: 400,
    description:
      'Payload inválido o fechas solapadas con otra promoción activa',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  create(@Body() dto: CreateStarPromotionDto) {
    return this.starPromotionsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar una promoción de estrellas (admin)',
    description:
      'Sin DELETE: para desactivar, enviar active: false. Rechaza con 400 si el rango de fechas resultante se solapa con otra promoción activa.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la promoción' })
  @ApiResponse({ status: 200, description: 'Promoción actualizada' })
  @ApiResponse({
    status: 400,
    description:
      'Payload inválido o fechas solapadas con otra promoción activa',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La promoción no existe' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStarPromotionDto,
  ) {
    return this.starPromotionsService.update(id, dto);
  }
}
