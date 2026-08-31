import { ConfigService } from '@nestjs/config';
import { PoolConfig } from 'pg';

export type DatabaseConnectionMode = 'local' | 'supabase-direct' | 'supabase-pooler';

export interface DatabaseTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  dbname: string;
}

export interface DatabaseConfig {
  mode: DatabaseConnectionMode;
  schema: string;
  poolConfig: PoolConfig;
}

export function buildDatabaseConfig(configService: ConfigService): DatabaseConfig {
  const schema = configService.get<string>('DB_SCHEMA', 'public').trim() || 'public';
  const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();
  const mode = resolveConnectionMode(configService, databaseUrl);
  const shouldUseSsl = resolveSslEnabled(configService, databaseUrl);
  const rejectUnauthorized = resolveRejectUnauthorized(configService, databaseUrl);
  const ssl = shouldUseSsl ? { rejectUnauthorized } : undefined;
  const usePoolerSettings = mode === 'supabase-pooler';

  return {
    mode,
    schema,
    poolConfig: buildPoolConfig(configService, schema, {
      databaseUrl,
      ssl,
      usePoolerSettings,
    }),
  };
}

/**
 * Connection target for pg_dump / tools.
 * Prefers DATABASE_DIRECT_URL (Supabase direct) so dumps are not sent through PgBouncer.
 */
export function resolveDatabaseTarget(
  configService: ConfigService,
  options?: { preferDirectUrl?: boolean },
): DatabaseTarget {
  const directUrl = configService.get<string>('DATABASE_DIRECT_URL')?.trim();
  const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();
  const url = options?.preferDirectUrl
    ? directUrl || databaseUrl
    : databaseUrl || directUrl;
  const parsed = parsePostgresUrl(url);

  return {
    host: parsed?.host || configService.get<string>('DB_HOST', '127.0.0.1') || '127.0.0.1',
    port: parsed?.port || Number(configService.get<string>('DB_PORT', '5432') || 5432),
    username: parsed?.username || configService.get<string>('DB_USER', 'postgres') || 'postgres',
    password: parsed?.password ?? configService.get<string>('DB_PASSWORD', '') ?? '',
    dbname: parsed?.dbname || configService.get<string>('DB_NAME', 'postgres') || 'postgres',
  };
}

export function parsePostgresUrl(databaseUrl?: string): DatabaseTarget | undefined {
  if (!databaseUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return undefined;
    }

    const dbname = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || 'postgres');

    return {
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      username: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || ''),
      dbname: dbname || 'postgres',
    };
  } catch {
    return undefined;
  }
}

function buildPoolConfig(
  configService: ConfigService,
  schema: string,
  options: {
    databaseUrl?: string;
    ssl?: { rejectUnauthorized: boolean };
    usePoolerSettings: boolean;
  },
): PoolConfig {
  const connectionString = options.databaseUrl
    ? normalizeConnectionString(
        options.databaseUrl,
        Boolean(options.ssl),
        options.ssl?.rejectUnauthorized ?? true,
      )
    : undefined;

  const baseConfig: PoolConfig = connectionString
    ? { connectionString, ssl: options.ssl }
    : {
        host: configService.get<string>('DB_HOST', '127.0.0.1'),
        port: Number(configService.get<string>('DB_PORT', '5432')),
        database: configService.get<string>('DB_NAME', 'postgres'),
        user: configService.get<string>('DB_USER', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', ''),
        ssl: options.ssl,
      };

  baseConfig.connectionTimeoutMillis = 10_000;
  baseConfig.idleTimeoutMillis = 30_000;
  baseConfig.max = options.usePoolerSettings ? 5 : 10;
  baseConfig.options = buildSearchPathOption(schema);

  if (options.usePoolerSettings) {
    // Required for Supabase transaction pooler (PgBouncer).
    baseConfig.prepare = false;
  }

  return baseConfig;
}

function buildSearchPathOption(schema: string): string {
  if (schema === 'public') {
    return '-c search_path=public';
  }

  return `-c search_path="${schema}",public`;
}

function resolveConnectionMode(
  configService: ConfigService,
  databaseUrl?: string,
): DatabaseConnectionMode {
  const explicitMode = configService.get<string>('DB_CONNECTION_MODE')?.trim().toLowerCase();

  if (explicitMode === 'supabase-pooler' || explicitMode === 'pooler') {
    return 'supabase-pooler';
  }

  if (explicitMode === 'supabase-direct' || explicitMode === 'direct') {
    return 'supabase-direct';
  }

  if (explicitMode === 'local') {
    return 'local';
  }

  if (isSupabasePoolerUrl(databaseUrl)) {
    return 'supabase-pooler';
  }

  if (isSupabaseDirectUrl(databaseUrl)) {
    return 'supabase-direct';
  }

  return 'local';
}

function isSupabasePoolerUrl(databaseUrl?: string): boolean {
  if (!databaseUrl) {
    return false;
  }

  return (
    databaseUrl.includes('.pooler.supabase.com') ||
    databaseUrl.includes('pgbouncer=true') ||
    /:6543(\/|\?|$)/.test(databaseUrl)
  );
}

function isSupabaseDirectUrl(databaseUrl?: string): boolean {
  if (!databaseUrl) {
    return false;
  }

  return databaseUrl.includes('.supabase.co') && !databaseUrl.includes('.pooler.supabase.com');
}

function resolveSslEnabled(configService: ConfigService, databaseUrl?: string): boolean {
  const defaultFromUrl =
    Boolean(databaseUrl?.includes('sslmode=require')) ||
    isSupabasePoolerUrl(databaseUrl) ||
    isSupabaseDirectUrl(databaseUrl);

  return getBooleanEnv(configService, 'DB_SSL', defaultFromUrl);
}

function resolveRejectUnauthorized(
  configService: ConfigService,
  databaseUrl?: string,
): boolean {
  const isSupabase = isSupabasePoolerUrl(databaseUrl) || isSupabaseDirectUrl(databaseUrl);
  return getBooleanEnv(configService, 'DB_SSL_REJECT_UNAUTHORIZED', !isSupabase);
}

function getBooleanEnv(
  configService: ConfigService,
  key: string,
  defaultValue: boolean,
): boolean {
  const rawValue = configService.get<string>(key);
  if (rawValue === undefined) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeConnectionString(
  databaseUrl: string,
  shouldUseSsl: boolean,
  rejectUnauthorized: boolean,
): string {
  if (!shouldUseSsl) {
    return databaseUrl;
  }

  if (!rejectUnauthorized) {
    if (databaseUrl.includes('sslmode=')) {
      return databaseUrl.replace(/sslmode=[^&]*/i, 'sslmode=no-verify');
    }

    return `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}sslmode=no-verify`;
  }

  return databaseUrl;
}
