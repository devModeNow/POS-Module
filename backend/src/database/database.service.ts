import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult } from 'pg';
import { buildDatabaseConfig, DatabaseConnectionMode } from './database.config';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly mode: DatabaseConnectionMode;
  private readonly schema: string;

  constructor(private readonly configService: ConfigService) {
    console.log('Initializing database connection...');

    const config = buildDatabaseConfig(configService);
    this.mode = config.mode;
    this.schema = config.schema;
    this.pool = new Pool(config.poolConfig);

    console.log('Database connection mode:', this.mode);
    console.log('Database schema:', this.schema);
    console.log('Using connection string:', Boolean(configService.get<string>('DATABASE_URL')));
  }

  getConnectionMode(): DatabaseConnectionMode {
    return this.mode;
  }

  async query<T = unknown>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
