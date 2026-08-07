import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/** Tipos MIME de imagen aceptados en las subidas. */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

/** Tamaño máximo de imagen: 5 MB. */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Opciones de multer para subidas de imagen (FileInterceptor).
 * - `fileFilter`: rechaza con 400 cualquier archivo que no sea imagen.
 * - `limits.fileSize`: el exceso de tamaño lo captura el HttpExceptionFilter y
 *   se devuelve como 400 con mensaje en español.
 */
export const imageUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      callback(
        new BadRequestException(
          'El archivo debe ser una imagen (JPG, PNG, WEBP o GIF)',
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
};
