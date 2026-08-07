import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CloudinaryService } from '../../shared/cloudinary/cloudinary.service';
import { imageUploadOptions } from '../../shared/cloudinary/image-upload-options';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../users/entities/user.entity';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@ApiTags('banners')
@Controller('banners')
export class BannersController {
  constructor(
    private readonly bannersService: BannersService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Get('active')
  @ApiOperation({
    summary: 'Banners vigentes (público, para la app)',
    description:
      'Devuelve los banners con active=true y dentro de su rango de fechas (si no hay fechas, siempre vigentes), ordenados por posición.',
  })
  @ApiResponse({ status: 200, description: 'Lista de banners vigentes' })
  getActiveBanners() {
    return this.bannersService.findActive();
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todos los banners (admin)' })
  @ApiResponse({ status: 200, description: 'Lista de banners' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  listBanners() {
    return this.bannersService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener un banner (admin)' })
  @ApiParam({ name: 'id', description: 'UUID del banner' })
  @ApiResponse({ status: 200, description: 'Banner encontrado' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El banner no existe' })
  getBanner(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un banner (admin)' })
  @ApiResponse({ status: 201, description: 'Banner creado' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  createBanner(@Body() dto: CreateBannerDto) {
    return this.bannersService.create(dto);
  }

  @Patch('reorder')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reordenar banners en batch (admin)',
    description:
      'Recibe una lista de {id, order} y actualiza la posición de todos en una transacción. Ideal para drag & drop del panel.',
  })
  @ApiResponse({ status: 200, description: 'Banners reordenados' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'Algún banner no existe' })
  reorderBanners(@Body() dto: ReorderBannersDto) {
    return this.bannersService.reorder(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar un banner (admin)' })
  @ApiParam({ name: 'id', description: 'UUID del banner' })
  @ApiResponse({ status: 200, description: 'Banner actualizado' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El banner no existe' })
  updateBanner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBannerDto,
  ) {
    return this.bannersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar un banner (admin)' })
  @ApiParam({ name: 'id', description: 'UUID del banner' })
  @ApiResponse({ status: 200, description: 'Banner eliminado' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El banner no existe' })
  removeBanner(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.remove(id);
  }

  @Post(':id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('image', imageUploadOptions))
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Subir imagen de un banner (admin)',
    description:
      'Sube el archivo a Cloudinary y guarda la URL resultante en el campo imageUrl del banner. Formato multipart/form-data, campo "image". Solo JPG, PNG, WEBP o GIF (máx 5 MB).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Imagen del banner (JPG, PNG, WEBP o GIF, máx 5 MB)',
        },
      },
    },
  })
  @ApiParam({ name: 'id', description: 'UUID del banner' })
  @ApiResponse({
    status: 200,
    description: 'Imagen subida y URL guardada en el banner',
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo inválido o demasiado grande',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El banner no existe' })
  async uploadBannerImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo de imagen');
    }
    const imageUrl = await this.cloudinaryService.uploadImage(
      file.buffer,
      'celtas/banners',
    );
    return this.bannersService.updateImage(id, imageUrl);
  }
}
