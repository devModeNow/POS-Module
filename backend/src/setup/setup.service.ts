import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { Client, ClientConfig, Pool, PoolClient } from 'pg';
import {
  buildDatabaseConfig,
  buildRestorePoolConfig,
  resolveDatabaseTarget,
} from 'src/database/database.config';
import { DatabaseService } from 'src/database/database.service';
import { classifyConnectionError } from './utils/classify-connection-error';
import { convertCopyFromStdinToInserts } from './utils/copy-to-inserts';
import { sanitizeSupabaseDump } from './utils/sanitize-supabase-dump';
import {
  containsCopyFromStdin,
  splitSqlStatements,
  stripPsqlMetaCommands,
} from './utils/split-sql-statements';

const PING_TIMEOUT_MS = 4000;

export type SetupConnectionStatus = {
  connected: boolean;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  mode: string;
  schema: string;
  latencyMs: number;
  checkedAt: string;
  serverVersion?: string;
  code?: string;
  error?: string;
  hint?: string;
};

@Injectable()
export class SetupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /** Live probe of the configured PostgreSQL server. Never returns credentials. */
  async getConnectionStatus(): Promise<SetupConnectionStatus> {
    const config = buildDatabaseConfig(this.configService);
    const target = resolveDatabaseTarget(this.configService);
    const checkedAt = new Date().toISOString();
    const base = {
      host: target.host,
      port: target.port,
      database: target.dbname,
      username: target.username,
      ssl: Boolean(config.poolConfig.ssl),
      mode: config.mode,
      schema: config.schema,
      checkedAt,
    };

    const client = new Client(buildPingClientConfig(config.poolConfig));
    const started = Date.now();

    try {
      await client.connect();
      const ping = await client.query<{ version: string }>(
        `SELECT current_setting('server_version') AS version`,
      );
      await client.end().catch(() => undefined);

      return {
        ...base,
        connected: true,
        latencyMs: Date.now() - started,
        serverVersion: ping.rows[0]?.version,
      };
    } catch (error: unknown) {
      await client.end().catch(() => undefined);
      const classified = classifyConnectionError(error, target.host, target.port);

      return {
        ...base,
        connected: false,
        latencyMs: Date.now() - started,
        code: classified.code,
        error: classified.error,
        hint: classified.hint,
      };
    }
  }

  /** Check if core tables exist — if not, DB needs setup */
  async getStatus() {
    const connection = await this.getConnectionStatus();

    if (!connection.connected) {
      return {
        success: true,
        data: {
          isSetupComplete: false,
          tablesFound: [] as string[],
          message: connection.error || 'Cannot reach PostgreSQL.',
          connection,
        },
      };
    }

    try {
      const result = await this.db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('tblusers', 'tblrbac', 'tblorganizations')
         ORDER BY table_name`,
      );

      const tables = result.rows.map((r) => r.table_name);
      const isSetupComplete = tables.length >= 3;

      return {
        success: true,
        data: {
          isSetupComplete,
          tablesFound: tables,
          message: isSetupComplete
            ? 'Database is already set up. Setup page is disabled.'
            : 'Database is fresh. You can import a backup.',
          connection,
        },
      };
    } catch (error: unknown) {
      const classified = classifyConnectionError(error, connection.host, connection.port);
      return {
        success: true,
        data: {
          isSetupComplete: false,
          tablesFound: [] as string[],
          message: classified.error,
          connection: {
            ...connection,
            connected: false,
            code: classified.code,
            error: classified.error,
            hint: classified.hint,
          },
        },
      };
    }
  }

  /** Execute a SQL backup file to initialize the database */
  async restore(sql: string) {
    const status = await this.getStatus();
    if (status.data.isSetupComplete) {
      return {
        success: false,
        message: 'Database is already set up. Restore is disabled to prevent data loss.',
      };
    }

    if (!status.data.connection?.connected) {
      return {
        success: false,
        message:
          status.data.connection?.error ||
          'Cannot reach PostgreSQL. Fix the connection before restoring.',
      };
    }

    const trimmedSql = sql.trim();
    if (!trimmedSql) {
      return { success: false, message: 'SQL file is empty' };
    }

    let sqlToRun = sanitizeSupabaseDump(trimmedSql);
    if (containsCopyFromStdin(sqlToRun)) {
      const converted = convertCopyFromStdinToInserts(sqlToRun);
      if (converted.ok) {
        sqlToRun = converted.sql;
      } else {
        const psqlPath = this.resolvePsqlPath();
        if (psqlPath) {
          return this.restoreViaPsql(trimmedSql, psqlPath);
        }

        return {
          success: false,
          message: converted.error,
        };
      }
    }

    sqlToRun = stripPsqlMetaCommands(sqlToRun);
    return this.restoreViaPg(sqlToRun);
  }

  private async restoreViaPg(sql: string) {
    const statements = splitSqlStatements(sql);
    if (statements.length === 0) {
      return { success: false, message: 'No executable SQL statements found in file.' };
    }

    const pool = new Pool(buildRestorePoolConfig(this.configService));
    let client: PoolClient | null = null;
    let executed = 0;

    try {
      client = await connectRestoreClient(pool);

      for (const schema of SUPABASE_COMPAT_SCHEMAS) {
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      }

      for (const statement of statements) {
        if (statement.startsWith('\\')) {
          continue;
        }

        try {
          await client.query(statement);
          executed++;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Unknown error';
          if (isSkippableRestoreError(statement, message)) {
            continue;
          }

          if (isConnectionResetError(message)) {
            client = await reconnectRestoreClient(pool, client);
            try {
              await client.query(statement);
              executed++;
              continue;
            } catch (retryError: unknown) {
              const retryMessage =
                retryError instanceof Error ? retryError.message : 'Unknown error';
              if (isSkippableRestoreError(statement, retryMessage)) {
                continue;
              }
              return {
                success: false,
                message: `Restore failed after ${executed} statement(s): ${retryMessage.substring(0, 400)}`,
              };
            }
          }

          return {
            success: false,
            message: `Restore failed after ${executed} statement(s): ${message.substring(0, 400)}`,
          };
        }
      }
    } finally {
      client?.release();
      await pool.end().catch(() => undefined);
    }

    const summary = await this.getRestorationSummary();

    return {
      success: true,
      message: `Database restored successfully (${executed} statements executed).`,
      data: { summary },
    };
  }

  private async restoreViaPsql(sql: string, psqlPath: string) {
    const databaseUrl =
      this.configService.get<string>('DATABASE_DIRECT_URL', '') ||
      this.configService.get<string>('DATABASE_URL', '');
    if (!databaseUrl) {
      return { success: false, message: 'DATABASE_URL not configured' };
    }

    const backupsDir = join(process.cwd(), 'backups');
    if (!existsSync(backupsDir)) {
      mkdirSync(backupsDir, { recursive: true });
    }

    const tempFile = join(backupsDir, `_restore_${Date.now()}.sql`);

    try {
      writeFileSync(tempFile, sql, 'utf-8');

      const output = execFileSync(
        psqlPath,
        [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', tempFile],
        {
          encoding: 'utf-8',
          timeout: 300000,
        },
      );

      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }

      const summary = await this.getRestorationSummary();

      return {
        success: true,
        message: 'Database restored successfully via psql.',
        data: { output: output.substring(0, 500), summary },
      };
    } catch (e: unknown) {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }

      const execErr = e as { stderr?: string; stdout?: string; message?: string };
      const errorMsg = execErr.stderr || execErr.message || 'Unknown error';

      return {
        success: false,
        message: `Restore failed: ${errorMsg.substring(0, 300)}`,
      };
    }
  }

  private resolvePsqlPath(): string | null {
    const configured = this.configService.get<string>('PSQL_PATH')?.trim();
    if (configured && existsSync(configured)) {
      return configured;
    }

    const pgDumpPath = this.configService.get<string>('PG_DUMP_PATH')?.trim();
    if (pgDumpPath) {
      const sibling = pgDumpPath.replace(/pg_dump(\.exe)?$/i, 'psql$1');
      if (sibling !== pgDumpPath && existsSync(sibling)) {
        return sibling;
      }
    }

    const fromPath = this.findExecutable(process.platform === 'win32' ? 'psql.exe' : 'psql');
    if (fromPath) {
      return fromPath;
    }

    const fallbacks =
      process.platform === 'win32'
        ? [
            'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
            'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
            'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
            'C:\\laragon\\bin\\postgresql\\postgresql-17\\bin\\psql.exe',
            'C:\\laragon\\bin\\postgresql\\postgresql-16\\bin\\psql.exe',
          ]
        : ['/usr/bin/psql', '/usr/lib/postgresql/17/bin/psql', '/usr/lib/postgresql/16/bin/psql'];

    return fallbacks.find((candidate) => existsSync(candidate)) ?? null;
  }

  private findExecutable(command: string): string | null {
    try {
      const output = execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], {
        encoding: 'utf-8',
        timeout: 5000,
      })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

      if (output && existsSync(output)) {
        return output;
      }

      return command;
    } catch {
      return null;
    }
  }

  private async getRestorationSummary() {
    try {
      const tablesResult = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );

      const tableNamesResult = await this.db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      );

      const countSafe = async (table: string): Promise<number> => {
        try {
          const r = await this.db.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM public."${table}"`,
          );
          return parseInt(r.rows[0]?.count ?? '0', 10);
        } catch {
          return 0;
        }
      };

      const usersCount = await countSafe('tblusers');
      const orgCount = await countSafe('tblorganizations');
      const roleCount = await countSafe('tblrbac');

      return {
        tablesCreated: parseInt(tablesResult.rows[0]?.count ?? '0', 10),
        tableNames: tableNamesResult.rows.map((r) => r.table_name),
        usersCount,
        organizationsCount: orgCount,
        rolesCount: roleCount,
        nextSteps: [
          'Restart the backend server to pick up new tables',
          'Go to the login page and sign in',
          'Verify your data in the application',
        ],
      };
    } catch {
      return {
        tablesCreated: 0,
        tableNames: [],
        usersCount: 0,
        organizationsCount: 0,
        rolesCount: 0,
        nextSteps: ['Restart the backend and try logging in'],
      };
    }
  }
}

function buildPingClientConfig(poolConfig: ClientConfig): ClientConfig {
  const ping: ClientConfig = {
    ssl: poolConfig.ssl,
    connectionTimeoutMillis: PING_TIMEOUT_MS,
  };

  if (poolConfig.connectionString) {
    ping.connectionString = poolConfig.connectionString;
    return ping;
  }

  ping.host = poolConfig.host;
  ping.port = poolConfig.port;
  ping.user = poolConfig.user;
  ping.password = poolConfig.password;
  ping.database = poolConfig.database;
  return ping;
}

const SUPABASE_COMPAT_SCHEMAS = [
  'extensions',
  'pgbouncer',
  'auth',
  'storage',
  'realtime',
  'supabase_functions',
  'supabase_migrations',
  'pgsodium',
  'vault',
  'graphql',
  'graphql_public',
] as const;

function isSkippableRestoreError(statement: string, message: string): boolean {
  const isSessionSetting =
    /^\s*SET\s+/i.test(statement) || /^\s*SELECT\s+pg_catalog\.set_config\s*\(/i.test(statement);

  if (isSessionSetting && /unrecognized configuration parameter/i.test(message)) {
    return true;
  }

  if (/^\s*CREATE\b/i.test(statement) && /already exists/i.test(message)) {
    return true;
  }

  if (
    /^\s*CREATE\s+EXTENSION\b/i.test(statement) &&
    (/does not exist/i.test(message) ||
      /could not open extension control file/i.test(message) ||
      /is not available/i.test(message) ||
      /could not access file/i.test(message))
  ) {
    return true;
  }

  const isPrivilegeOrCatalogStatement =
    /^\s*(GRANT|REVOKE|ALTER|DROP|COMMENT\s+ON)\b/i.test(statement) ||
    /\bOWNER\s+TO\b/i.test(statement);

  if (
    isPrivilegeOrCatalogStatement &&
    (/does not exist/i.test(message) ||
      /already exists/i.test(message) ||
      /must be member of role/i.test(message) ||
      /permission denied/i.test(message))
  ) {
    return true;
  }

  if (
    referencesSupabaseCompatSchema(statement) &&
    !/^\s*CREATE\s+TABLE\b/i.test(statement) &&
    (/does not exist/i.test(message) ||
      /already exists/i.test(message) ||
      /permission denied/i.test(message) ||
      /must be member of role/i.test(message))
  ) {
    return true;
  }

  return false;
}

function referencesSupabaseCompatSchema(statement: string): boolean {
  return SUPABASE_COMPAT_SCHEMAS.some((schema) =>
    new RegExp(`\\b${schema}\\b`, 'i').test(statement),
  );
}

function isConnectionResetError(message: string): boolean {
  return /ECONNRESET|EPIPE|ECONNREFUSED|connection terminated|Connection ended unexpectedly|server closed the connection|Client has encountered a connection error|timeout expired|Connection terminated unexpectedly/i.test(
    message,
  );
}

async function connectRestoreClient(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query('SET statement_timeout = 0');
  await client.query('SET idle_in_transaction_session_timeout = 0');
  return client;
}

async function reconnectRestoreClient(
  pool: Pool,
  previous: PoolClient | null,
): Promise<PoolClient> {
  try {
    previous?.release(true);
  } catch {
    // Client is already dead.
  }

  return connectRestoreClient(pool);
}
