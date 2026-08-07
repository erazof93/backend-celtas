import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';

/**
 * Módulo compartido de Cloudinary. Se exporta CloudinaryService para que
 * cualquier módulo (Menu, Banners) pueda subir imágenes sin repetir config.
 */
@Module({
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
