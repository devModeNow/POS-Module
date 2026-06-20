import { BackupType, BackupFormat } from '../interfaces';

/**
 * Database connection configuration for pg_dump.
 */
export interface DatabaseConnectionConfig {
  host: string;
  port: number;
  username: string;
  dbname: string;
}

/**
 * Options controlling the backup output.
 */
export interface PgDumpOptions {
  type: BackupType;
  format: BackupFormat;
}

/**
 * Supabase-internal schemas excluded from all backups.
 * @see Requirements 2.5
 */
const EXCLUDED_SCHEMAS: readonly string[] = [
  'auth',
  'storage',
  'realtime',
  'extensions',
  'supabase_functions',
  'supabase_migrations',
  'pgsodium',
  'vault',
  'graphql',
  'graphql_public',
] as const;

/**
 * Builds the argument array for the pg_dump command based on
 * database connection config and backup options.
 *
 * @param config - Database connection parameters (host, port, username, dbname)
 * @param options - Backup options (type, format)
 * @returns Array of string arguments to pass to pg_dump
 *
 * @see Requirements 1.2, 2.1, 2.5, 2.6
 */
export function buildPgDumpArgs(
  config: DatabaseConnectionConfig,
  options: PgDumpOptions,
): string[] {
  const args: string[] = [];

  // Backup type flag
  if (options.type === 'schema-only') {
    args.push('--schema-only');
  } else if (options.type === 'data-only') {
    args.push('--data-only');
  }
  // 'full' type: no additional flag needed

  // Output format flag
  if (options.format === 'plain') {
    args.push('-Fp');
  } else if (options.format === 'custom') {
    args.push('-Fc');
  }

  // Encoding (Requirements 2.6)
  args.push('--encoding=UTF8');

  // Exclude Supabase-internal schemas (Requirements 2.5)
  for (const schema of EXCLUDED_SCHEMAS) {
    args.push(`--exclude-schema=${schema}`);
  }

  // Connection parameters
  args.push(`--host=${config.host}`);
  args.push(`--port=${config.port}`);
  args.push(`--username=${config.username}`);
  args.push(`--dbname=${config.dbname}`);

  return args;
}
