import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Respuesta estándar de la API:
 *   { success: true, data: { ... }, message?: "opcional" }
 *
 * Si el controlador ya devuelve un objeto con la propiedad `success`, se respeta tal cual
 * (evita doble envoltura). En cualquier otro caso se envuelve el valor en `data`.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        if (
          data &&
          typeof data === 'object' &&
          'success' in data &&
          typeof (data as Record<string, unknown>).success === 'boolean'
        ) {
          return data as unknown as ApiResponse<T>;
        }
        return { success: true, data };
      }),
    );
  }
}
