import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import { CouponsService } from './coupons.service';
import { GenerateCouponDto } from './dto/generate-coupon.dto';
import { QueryCouponsDto } from './dto/query-coupons.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('coupons')
@ApiBearerAuth()
@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post('generate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Generar un cupón manual (solo admin, campañas puntuales)',
    description:
      'Crea un cupón para un usuario específico con el tipo y valor de descuento que decida el admin. No depende del umbral de gasto.',
  })
  @ApiResponse({ status: 201, description: 'Cupón generado' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  generate(@Body() dto: GenerateCouponDto) {
    return this.couponsService.generateManual(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar mis cupones (cliente)' })
  @ApiResponse({ status: 200, description: 'Lista de cupones del usuario' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  listMine(@Req() req: AuthenticatedRequest) {
    return this.couponsService.findMyCoupons(req.user.userId);
  }

  @Post('validate')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Validar un cupón (cliente)',
    description:
      'Devuelve si el cupón es válido (existe, activo, no expirado y del usuario) y el descuento que aplica. NO lo marca como usado; el canje ocurre al crear el pedido.',
  })
  @ApiResponse({ status: 201, description: 'Cupón válido con su descuento' })
  @ApiResponse({
    status: 400,
    description: 'Cupón inexistente, usado, expirado o de otro usuario',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  validate(@Req() req: AuthenticatedRequest, @Body() dto: ValidateCouponDto) {
    return this.couponsService.validateCoupon(
      dto.code,
      req.user.userId,
      dto.subtotal,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Listar cupones (solo admin, paginado, filtro por estado)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Número de página (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Cupones por página (default 10, máx 100)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'used', 'expired'],
    description: 'Filtrar por estado',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    example: '3f2b1c4a-9d8e-4f6a-b7c5-1a2b3c4d5e6f',
    description: 'Filtrar los cupones de un usuario específico (UUID)',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de cupones' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  listAll(@Query() query: QueryCouponsDto) {
    return this.couponsService.findAll(query);
  }
}
