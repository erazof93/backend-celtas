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
import { CreateRewardMilestoneDto } from './dto/create-reward-milestone.dto';
import { UpdateRewardMilestoneDto } from './dto/update-reward-milestone.dto';
import { RewardMilestonesService } from './reward-milestones.service';

@ApiTags('reward-milestones')
@ApiBearerAuth()
@Controller('reward-milestones')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class RewardMilestonesController {
  constructor(
    private readonly rewardMilestonesService: RewardMilestonesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar hitos del tablero de estrellas (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Lista de hitos, ASC por estrellasRequeridas',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  findAll() {
    return this.rewardMilestonesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un hito del tablero de estrellas (admin)' })
  @ApiParam({ name: 'id', description: 'UUID del hito' })
  @ApiResponse({ status: 200, description: 'Hito encontrado' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El hito no existe' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rewardMilestonesService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Crear un hito del tablero de estrellas (admin)',
    description:
      'Rechaza con 400 si ya existe un hito configurado con el mismo starsRequired.',
  })
  @ApiResponse({ status: 201, description: 'Hito creado' })
  @ApiResponse({
    status: 400,
    description: 'Payload inválido o starsRequired ya configurado',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  create(@Body() dto: CreateRewardMilestoneDto) {
    return this.rewardMilestonesService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar un hito del tablero de estrellas (admin)',
    description:
      'Rechaza con 400 si el starsRequired resultante ya está usado por otro hito.',
  })
  @ApiParam({ name: 'id', description: 'UUID del hito' })
  @ApiResponse({ status: 200, description: 'Hito actualizado' })
  @ApiResponse({
    status: 400,
    description: 'Payload inválido o starsRequired ya configurado',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El hito no existe' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRewardMilestoneDto,
  ) {
    return this.rewardMilestonesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar un hito del tablero de estrellas (admin)',
    description:
      'DELETE real: los premios ya otorgados con este umbral no se ven afectados (snapshot, no FK).',
  })
  @ApiParam({ name: 'id', description: 'UUID del hito' })
  @ApiResponse({ status: 200, description: 'Hito eliminado' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El hito no existe' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rewardMilestonesService.remove(id);
  }
}
