import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
    },
  },
}));

type UploadCallback = (
  error: Error | null,
  result?: { secure_url?: string },
) => void;

/** Configura el mock de upload_stream para que llame al callback al hacer end(). */
const mockUploadStream = (handler: (cb: UploadCallback) => void) => {
  (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
    (_opts: unknown, cb: UploadCallback) => {
      void _opts;
      return { end: () => handler(cb) };
    },
  );
};

describe('CloudinaryService', () => {
  let service: CloudinaryService;
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        'cloudinary.cloudName': 'mi-cloud',
        'cloudinary.apiKey': 'mi-key',
        'cloudinary.apiSecret': 'mi-secret',
      };
      return values[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudinaryService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(CloudinaryService);
  });

  it('configura cloudinary con las credenciales del entorno', () => {
    expect(cloudinary.config).toHaveBeenCalledWith({
      cloud_name: 'mi-cloud',
      api_key: 'mi-key',
      api_secret: 'mi-secret',
    });
  });

  it('devuelve la URL segura tras subir el buffer', async () => {
    mockUploadStream((cb) =>
      cb(null, { secure_url: 'https://res.cloudinary.com/mi-cloud/x.png' }),
    );

    const url = await service.uploadImage(Buffer.from('data'));

    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'celtas',
        resource_type: 'image',
      }),
      expect.any(Function),
    );
    expect(url).toBe('https://res.cloudinary.com/mi-cloud/x.png');
  });

  it('usa la carpeta indicada', async () => {
    mockUploadStream((cb) => cb(null, { secure_url: 'https://x/y.jpg' }));

    await service.uploadImage(Buffer.from('data'), 'celtas/menu-items');

    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'celtas/menu-items' }),
      expect.any(Function),
    );
  });

  it('lanza si Cloudinary devuelve un error', async () => {
    mockUploadStream((cb) => cb(new Error('invalid credentials')));

    await expect(service.uploadImage(Buffer.from('data'))).rejects.toThrow(
      'No se pudo subir la imagen a Cloudinary',
    );
  });

  it('lanza si la respuesta no trae secure_url', async () => {
    mockUploadStream((cb) => cb(null, undefined));

    await expect(service.uploadImage(Buffer.from('data'))).rejects.toThrow(
      'No se pudo subir la imagen a Cloudinary',
    );
  });
});
