import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  const mockResponse = () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { status };
    return { response, status, json };
  };

  const buildHost = (res: ReturnType<typeof mockResponse>['response']) =>
    ({
      switchToHttp: () => ({
        getResponse: () => res,
      }),
    }) as unknown as ArgumentsHost;

  it('formatea una HttpException con message string', () => {
    const { response, status, json } = mockResponse();
    const exception = new NotFoundException('No encontrado');
    filter.catch(exception, buildHost(response));
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'No encontrado',
      statusCode: 404,
    });
  });

  it('aplana el array de mensajes de validación de class-validator', () => {
    const { response, status, json } = mockResponse();
    const exception = new BadRequestException(['campo inválido', 'muy corto']);
    filter.catch(exception, buildHost(response));
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'campo inválido, muy corto',
      statusCode: 400,
    });
  });

  it('usa el message interno si la respuesta no trae message', () => {
    const { response, status, json } = mockResponse();
    const exception = new HttpException({ error: 'custom' }, 422);
    filter.catch(exception, buildHost(response));
    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: exception.message,
      statusCode: 422,
    });
  });

  it('convierte errores desconocidos en 500 con mensaje genérico', () => {
    const { response, status, json } = mockResponse();
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    filter.catch(new Error('boom'), buildHost(response));
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Error interno del servidor',
      statusCode: 500,
    });
    expect(loggerSpy).toHaveBeenCalled();
    loggerSpy.mockRestore();
  });

  it('convierte un PayloadTooLargeException (archivo muy grande) en 400', () => {
    const { response, status, json } = mockResponse();
    const exception = new PayloadTooLargeException('File too large');
    filter.catch(exception, buildHost(response));
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'El archivo excede el tamaño máximo permitido (5 MB)',
      statusCode: 400,
    });
  });
});
