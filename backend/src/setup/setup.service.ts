import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from 'src/database/database.service';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

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

      const tables = result.rows.map(r => r.table_name);
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
    } catch (e) {
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

  /** Execute a SQL backup file using psql for full compatibility (COPY, etc.) */
  async restore(sql: string) {
    // Safety check: don't allow restore if DB is already set up
    const status = await this.getStatus();
    if (status.data.isSetupComplete) {
      return {
        success: false,
        message: 'Database is already set up. Restore is disabled to prevent data loss.',
      };
    }

    // Get psql path from env or use default
    const pgDumpPath = this.configService.get<string>('PG_DUMP_PATH', 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe');
    const psqlPath = pgDumpPath.replace('pg_dump.exe', 'psql.exe').replace('pg_dump', 'psql');
    const databaseUrl = this.configService.get<string>('DATABASE_URL', '');

    if (!databaseUrl) {
      return { success: false, message: 'DATABASE_URL not configured' };
    }

    // Write SQL to a temp file
    const tempFile = join(process.cwd(), 'backups', `_restore_${Date.now()}.sql`);

    try {
      writeFileSync(tempFile, sql, 'utf-8');

      // Execute via psql
      const output = execSync(
        `"${psqlPath}" "${databaseUrl}" -f "${tempFile}"`,
        {
          encoding: 'utf-8',
          timeout: 120000, // 2 minutes max
          env: { ...process.env, PGPASSWORD: undefined }, // URL has password
        },
      );

      // Clean up temp file
      if (existsSync(tempFile)) unlinkSync(tempFile);

      // Get a summary of what was restored
      const summary = await this.getRestorationSummary();

      return {
        success: true,
        message: 'Database restored successfully via psql.',
        data: { output: output.substring(0, 500), summary },
      };
    } catch (e: unknown) {
      // Clean up temp file on error
      if (existsSync(tempFile)) unlinkSync(tempFile);

      const execErr = e as { stderr?: string; stdout?: string; message?: string };
      const errorMsg = execErr.stderr || execErr.message || 'Unknown error';

      return {
        success: false,
        message: `Restore failed: ${errorMsg.substring(0, 300)}`,
      };
    }
  }

  private async getRestorationSummary() {
    try {
      // Count tables
      const tablesResult = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );

      // List table names
      const tableNamesResult = await this.db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      );

      // Count records safely
      const countSafe = async (table: string): Promise<number> => {
        try {
          const r = await this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public."${table}"`);
          return parseInt(r.rows[0]?.count ?? '0', 10);
        } catch { return 0; }
      };

      const usersCount = await countSafe('tblusers');
      const orgCount = await countSafe('tblorganizations');
      const roleCount = await countSafe('tblrbac');

      return {
        tablesCreated: parseInt(tablesResult.rows[0]?.count ?? '0', 10),
        tableNames: tableNamesResult.rows.map(r => r.table_name),
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
      return { tablesCreated: 0, tableNames: [], usersCount: 0, organizationsCount: 0, rolesCount: 0, nextSteps: ['Restart the backend and try logging in'] };
    }
  }
}
