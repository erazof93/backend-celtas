import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Formato estándar de error de la API:
 *   { success: false, message: "Descripción del error", statusCode: 400 }
 *
 * Normaliza cualquier excepción (HttpException o error inesperado) a este formato,
 * manteniendo el statusCode HTTP correcto y logueando los errores internos.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode: number;
    let message: string;

    if (exception instanceof PayloadTooLargeException) {
      // NestJS convierte el límite de tamaño de multer (LIMIT_FILE_SIZE) en un
      // PayloadTooLargeException (413). Lo normalizamos a 400 con mensaje en español
      // para mantener el contrato de la API (subidas inválidas → 400).
      statusCode = HttpStatus.BAD_REQUEST;
      message = 'El archivo excede el tamaño máximo permitido (5 MB)';
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        exceptionResponse &&
        typeof exceptionResponse === 'object' &&
        'message' in exceptionResponse
      ) {
        const raw = exceptionResponse.message;
        message = Array.isArray(raw) ? raw.join(', ') : String(raw);
      } else {
        message = exception.message;
      }
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Error interno del servidor';
      this.logger.error(
        `Excepción no controlada: ${String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json({
      success: false,
      message,
      statusCode,
    });
  }
}
