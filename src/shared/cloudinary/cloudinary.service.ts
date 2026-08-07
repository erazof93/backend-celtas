import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

/**
 * Servicio reutilizable de subida de imágenes a Cloudinary.
 *
 * Las credenciales se leen del `.env` (CLOUDINARY_*) vía ConfigService y NUNCA se
 * exponen al frontend: el backend recibe el archivo y guarda solo la URL resultante.
 *
 * Lo consumen el módulo Menu (imagen de productos/categorías) y más adelante Banners.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('cloudinary.cloudName'),
      api_key: this.configService.get<string>('cloudinary.apiKey'),
      api_secret: this.configService.get<string>('cloudinary.apiSecret'),
    });
  }

  /**
   * Sube un buffer de imagen a Cloudinary y devuelve la URL segura (https) resultante.
   * Lanza un Error (mensaje en español) si Cloudinary rechaza la subida.
   */
  async uploadImage(buffer: Buffer, folder = 'celtas'): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          unique_filename: true,
          overwrite: false,
        },
        (error, result) => {
          if (error) {
            this.logger.error(
              `Error subiendo imagen a Cloudinary: ${error.message}`,
            );
            reject(new Error('No se pudo subir la imagen a Cloudinary'));
            return;
          }
          if (!result?.secure_url) {
            reject(new Error('No se pudo subir la imagen a Cloudinary'));
            return;
          }
          resolve(result.secure_url);
        },
      );
      uploadStream.end(buffer);
    });
  }
}
