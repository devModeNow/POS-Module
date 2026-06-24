import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { DatabaseService } from 'src/database/database.service';
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
      const psqlPath = this.resolvePsqlPath();
      if (psqlPath) {
        return this.restoreViaPsql(trimmedSql, psqlPath);
      }

      return {
        success: false,
        message:
          'This SQL file uses COPY ... FROM stdin, which requires the psql client. Install PostgreSQL client tools or export a plain SQL backup without COPY blocks.',
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
    const databaseUrl = this.configService.get<string>('DATABASE_URL', '');
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

      const output = execSync(`"${psqlPath}" "${databaseUrl}" -f "${tempFile}"`, {
        encoding: 'utf-8',
        timeout: 300000,
        env: { ...process.env, PGPASSWORD: undefined },
      });

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
    const pgDumpPath = this.configService.get<string>(
      'PG_DUMP_PATH',
      'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
    );
    const psqlPath = pgDumpPath.replace(/pg_dump(\.exe)?$/i, 'psql$1');
    return existsSync(psqlPath) ? psqlPath : null;
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
