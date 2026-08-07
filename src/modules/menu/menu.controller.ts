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
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { MenuService } from './menu.service';

@ApiTags('menu')
@Controller('menu')
export class MenuController {
  constructor(
    private readonly menuService: MenuService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Menú público agrupado por categoría (para la app)',
    description:
      'Solo categorías activas con al menos un producto disponible; los productos no disponibles se omiten.',
  })
  @ApiResponse({ status: 200, description: 'Categorías con sus productos' })
  getPublicMenu() {
    return this.menuService.findPublicMenu();
  }

  @Get('categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todas las categorías (admin)' })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  listCategories() {
    return this.menuService.findAllCategories();
  }

  @Post('categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear una categoría (admin)' })
  @ApiResponse({ status: 201, description: 'Categoría creada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una categoría con ese nombre',
  })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.menuService.createCategory(dto);
  }

  @Patch('categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar una categoría (admin)' })
  @ApiParam({ name: 'id', description: 'UUID de la categoría' })
  @ApiResponse({ status: 200, description: 'Categoría actualizada' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La categoría no existe' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe otra categoría con ese nombre',
  })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.menuService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Eliminar una categoría (admin)',
    description: 'Se rechaza con 409 si la categoría tiene productos.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la categoría' })
  @ApiResponse({ status: 200, description: 'Categoría eliminada' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La categoría no existe' })
  @ApiResponse({
    status: 409,
    description: 'La categoría tiene productos y no puede eliminarse',
  })
  removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.menuService.removeCategory(id);
  }

  @Get('items')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todos los productos (admin)' })
  @ApiResponse({ status: 200, description: 'Lista de productos' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  listItems() {
    return this.menuService.findAllItems();
  }

  @Post('items')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un producto (admin)' })
  @ApiResponse({ status: 201, description: 'Producto creado' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La categoría no existe' })
  createItem(@Body() dto: CreateMenuItemDto) {
    return this.menuService.createItem(dto);
  }

  @Patch('items/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar un producto (admin)' })
  @ApiParam({ name: 'id', description: 'UUID del producto' })
  @ApiResponse({ status: 200, description: 'Producto actualizado' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({
    status: 404,
    description: 'Producto o categoría inexistentes',
  })
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.menuService.updateItem(id, dto);
  }

  @Delete('items/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar un producto (admin)' })
  @ApiParam({ name: 'id', description: 'UUID del producto' })
  @ApiResponse({ status: 200, description: 'Producto eliminado' })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El producto no existe' })
  removeItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.menuService.removeItem(id);
  }

  @Post('items/:id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('image', imageUploadOptions))
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Subir imagen de un producto (admin)',
    description:
      'Sube el archivo a Cloudinary y guarda la URL resultante en el campo image del producto. Formato multipart/form-data, campo "image". Solo JPG, PNG, WEBP o GIF (máx 5 MB).',
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
          description: 'Imagen del producto (JPG, PNG, WEBP o GIF, máx 5 MB)',
        },
      },
    },
  })
  @ApiParam({ name: 'id', description: 'UUID del producto' })
  @ApiResponse({
    status: 200,
    description: 'Imagen subida y URL guardada en el producto',
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo inválido o demasiado grande',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'El producto no existe' })
  async uploadItemImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo de imagen');
    }
    const imageUrl = await this.cloudinaryService.uploadImage(
      file.buffer,
      'celtas/menu-items',
    );
    return this.menuService.updateItemImage(id, imageUrl);
  }

  @Post('categories/:id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('image', imageUploadOptions))
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Subir imagen de una categoría (admin)',
    description:
      'Sube el archivo a Cloudinary y guarda la URL resultante en el campo image de la categoría. Formato multipart/form-data, campo "image". Solo JPG, PNG, WEBP o GIF (máx 5 MB).',
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
          description:
            'Imagen de la categoría (JPG, PNG, WEBP o GIF, máx 5 MB)',
        },
      },
    },
  })
  @ApiParam({ name: 'id', description: 'UUID de la categoría' })
  @ApiResponse({
    status: 200,
    description: 'Imagen subida y URL guardada en la categoría',
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo inválido o demasiado grande',
  })
  @ApiResponse({ status: 401, description: 'Sin token o token inválido' })
  @ApiResponse({ status: 403, description: 'Requiere rol admin' })
  @ApiResponse({ status: 404, description: 'La categoría no existe' })
  async uploadCategoryImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo de imagen');
    }
    const imageUrl = await this.cloudinaryService.uploadImage(
      file.buffer,
      'celtas/categories',
    );
    return this.menuService.updateCategoryImage(id, imageUrl);
  }
}
