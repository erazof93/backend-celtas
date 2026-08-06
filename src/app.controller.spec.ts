import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('debería devolver la información de la API', () => {
      const info = appController.getAppInfo();
      expect(info).toMatchObject({ app: 'Celtas API', status: 'ok' });
    });
  });

  describe('health', () => {
    it('debería reportar la base de datos conectada', async () => {
      mockDataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(appController.health()).resolves.toEqual({
        database: 'connected',
      });
      expect(mockDataSource.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('debería propagar el error si la base de datos no responde', async () => {
      mockDataSource.query.mockRejectedValueOnce(
        new Error('connection refused'),
      );
      await expect(appController.health()).rejects.toThrow(
        'connection refused',
      );
    });
  });
});
