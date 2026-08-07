import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('public')
  @ApiOperation({
    summary: 'Settings públicas (sin auth)',
    description:
      'Devuelve SOLO las keys de una whitelist explícita en el código (por ahora whatsapp_business_number). Nunca expone todo el key-value.',
  })
  @ApiResponse({
    status: 200,
    description: 'Settings públicas (solo keys de la whitelist)',
  })
  findPublic() {
    return this.settingsService.findPublic();
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todas las settings (solo admin)' })
  @ApiResponse({ status: 200, description: 'Todas las settings' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  findAll() {
    return this.settingsService.findAll();
  }

  @Patch()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear/actualizar una setting (solo admin)',
    description:
      'Upsert por key: si la key no existe se crea, si existe se actualiza value/description.',
  })
  @ApiResponse({ status: 200, description: 'Setting creada/actualizada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  upsert(@Body() dto: UpdateSettingDto) {
    return this.settingsService.upsert(dto.key, dto.value, dto.description);
  }
}
