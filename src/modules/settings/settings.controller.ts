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

  @Get('business-hours')
  @ApiOperation({
    summary: 'Horario de atención y si el local está abierto ahora (sin auth)',
    description:
      'Fuente única de verdad de si el local está abierto: evalúa el interruptor manual "cerrado temporalmente" (con prioridad sobre el horario) y, si no aplica, el horario programado por día de la semana en hora de Lima. No bloquea nada por sí mismo (el bloqueo real ocurre en POST /orders) — centraliza la lógica para que el panel o la app puedan mostrarla.',
  })
  @ApiResponse({
    status: 200,
    description: '{ open, message, schedule, manualClosed }',
  })
  async businessHours() {
    const [{ open, message }, schedule, manualClosed] = await Promise.all([
      this.settingsService.isOpenNow(),
      this.settingsService.getBusinessHoursSchedule(),
      this.settingsService.isManuallyClosed(),
    ]);
    return { open, message, schedule, manualClosed };
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
