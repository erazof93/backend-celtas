import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  getAppInfo() {
    return {
      app: 'Celtas API',
      version: '1.0.0',
      status: 'ok',
    };
  }

  /**
   * Verifica la conexión real a PostgreSQL ejecutando `SELECT 1`.
   * Lanza un error si la base de datos no está disponible.
   */
  async checkDatabase(): Promise<{ database: 'connected' }> {
    await this.dataSource.query('SELECT 1');
    return { database: 'connected' };
  }
}
