import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Información básica de la API' })
  @ApiResponse({ status: 200, description: 'Información de la API' })
  getAppInfo() {
    return this.appService.getAppInfo();
  }

  @Get('health')
  @ApiOperation({
    summary: 'Estado de salud de la API y conexión a la base de datos',
  })
  @ApiResponse({ status: 200, description: 'API y base de datos operativas' })
  @ApiResponse({ status: 503, description: 'Base de datos no disponible' })
  async health() {
    return this.appService.checkDatabase();
  }
}
