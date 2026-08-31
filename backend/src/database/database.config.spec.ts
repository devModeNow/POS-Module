import { ConfigService } from '@nestjs/config';
import { parsePostgresUrl, resolveDatabaseTarget } from './database.config';

describe('parsePostgresUrl', () => {
  it('parses a local pgAdmin / Laragon URL', () => {
    const parsed = parsePostgresUrl(
      'postgresql://postgres:postgres@127.0.0.1:5432/cbis',
    );

    expect(parsed).toEqual({
      host: '127.0.0.1',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      dbname: 'cbis',
    });
  });

  it('parses a Supabase pooler URL with query string', () => {
    const parsed = parsePostgresUrl(
      'postgresql://postgres.abc:p%40ss@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
    );

    expect(parsed).toEqual({
      host: 'aws-0-ap-south-1.pooler.supabase.com',
      port: 6543,
      username: 'postgres.abc',
      password: 'p@ss',
      dbname: 'postgres',
    });
  });

  it('returns undefined for an empty value', () => {
    expect(parsePostgresUrl(undefined)).toBeUndefined();
    expect(parsePostgresUrl('')).toBeUndefined();
  });
});

describe('resolveDatabaseTarget', () => {
  it('uses discrete DB_* values when no URL is set', () => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        const config: Record<string, string> = {
          DB_HOST: 'localhost',
          DB_PORT: '5432',
          DB_USER: 'postgres',
          DB_PASSWORD: 'secret_password',
          DB_NAME: 'test_db',
        };
        return config[key] ?? defaultValue;
      }),
    } as unknown as ConfigService;

    expect(resolveDatabaseTarget(configService)).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'secret_password',
      dbname: 'test_db',
    });
  });

  it('prefers DATABASE_DIRECT_URL for backups', () => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        const config: Record<string, string> = {
          DATABASE_URL:
            'postgresql://postgres.abc:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
          DATABASE_DIRECT_URL:
            'postgresql://postgres.abc:x@db.abc.supabase.co:5432/postgres',
        };
        return config[key] ?? defaultValue;
      }),
    } as unknown as ConfigService;

    expect(
      resolveDatabaseTarget(configService, { preferDirectUrl: true }),
    ).toMatchObject({
      host: 'db.abc.supabase.co',
      port: 5432,
      dbname: 'postgres',
    });
  });
});
