import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { DatabaseService } from 'src/database/database.service';
import { convertCopyFromStdinToInserts } from './utils/copy-to-inserts';
import { containsCopyFromStdin, splitSqlStatements } from './utils/split-sql-statements';

@Injectable()
export class SetupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /** Check if core tables exist — if not, DB needs setup */
  async getStatus() {
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
        },
      };
    } catch {
      return {
        success: true,
        data: {
          isSetupComplete: false,
          tablesFound: [],
          message: 'Database is fresh. You can import a backup.',
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

    const trimmedSql = sql.trim();
    if (!trimmedSql) {
      return { success: false, message: 'SQL file is empty' };
    }

    if (containsCopyFromStdin(trimmedSql)) {
      const converted = convertCopyFromStdinToInserts(trimmedSql);
      if (converted.ok) {
        return this.restoreViaPg(converted.sql);
      }

      const psqlPath = this.resolvePsqlPath();
      if (psqlPath) {
        return this.restoreViaPsql(trimmedSql, psqlPath);
      }

      return {
        success: false,
        message: converted.error,
      };
    }

    return this.restoreViaPg(trimmedSql);
  }

  private async restoreViaPg(sql: string) {
    const statements = splitSqlStatements(sql);
    if (statements.length === 0) {
      return { success: false, message: 'No executable SQL statements found in file.' };
    }

    let executed = 0;

    try {
      for (const statement of statements) {
        await this.db.query(statement);
        executed++;
      }

      const summary = await this.getRestorationSummary();

      return {
        success: true,
        message: `Database restored successfully (${executed} statements executed).`,
        data: { summary },
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      return {
        success: false,
        message: `Restore failed after ${executed} statement(s): ${message.substring(0, 400)}`,
      };
    }
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
