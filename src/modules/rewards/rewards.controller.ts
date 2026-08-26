import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RewardsService } from './rewards.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('rewards')
@ApiBearerAuth()
@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get('progress')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Progreso del programa de estrellas (cliente)',
    description:
      'Estrellas hacia el próximo premio (recalculadas en caliente, no persistidas), premios disponibles sin usar/sin vencer, y la promoción de estrellas dobles vigente hoy, si hay alguna.',
  })
  @ApiResponse({
    status: 200,
    description: 'Progreso del programa de estrellas',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  getProgress(@Req() req: AuthenticatedRequest) {
    return this.rewardsService.getProgress(req.user.userId);
  }

  @Get('catalog')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Catálogo de productos canjeables con estrellas (cliente)',
    description:
      'Sin especial=true: productos redeemableWithStars=true y available=true. Con especial=true: productos specialReward=true y available=true — lista EXCLUYENTE, no una unión de ambas.',
  })
  @ApiQuery({
    name: 'especial',
    required: false,
    type: Boolean,
    description: 'true para el catálogo exclusivo del premio especial',
  })
  @ApiResponse({ status: 200, description: 'Lista de productos canjeables' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  getCatalog(@Query('especial') especial?: string) {
    return this.rewardsService.getCatalog(especial === 'true');
  }
}
