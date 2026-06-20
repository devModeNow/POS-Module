import { buildPgDumpArgs, DatabaseConnectionConfig, PgDumpOptions } from './build-pg-dump-args';

describe('buildPgDumpArgs', () => {
  const defaultConfig: DatabaseConnectionConfig = {
    host: '127.0.0.1',
    port: 5432,
    username: 'postgres',
    dbname: 'sts_car_expert',
  };

  const excludedSchemas = [
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
  ];

  describe('backup type flags', () => {
    it('should include --schema-only for schema-only type', () => {
      const options: PgDumpOptions = { type: 'schema-only', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);
      expect(args).toContain('--schema-only');
      expect(args).not.toContain('--data-only');
    });

    it('should include --data-only for data-only type', () => {
      const options: PgDumpOptions = { type: 'data-only', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);
      expect(args).toContain('--data-only');
      expect(args).not.toContain('--schema-only');
    });

    it('should not include --schema-only or --data-only for full type', () => {
      const options: PgDumpOptions = { type: 'full', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);
      expect(args).not.toContain('--schema-only');
      expect(args).not.toContain('--data-only');
    });
  });

  describe('format flags', () => {
    it('should include -Fp for plain format', () => {
      const options: PgDumpOptions = { type: 'full', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);
      expect(args).toContain('-Fp');
      expect(args).not.toContain('-Fc');
    });

    it('should include -Fc for custom format', () => {
      const options: PgDumpOptions = { type: 'full', format: 'custom' };
      const args = buildPgDumpArgs(defaultConfig, options);
      expect(args).toContain('-Fc');
      expect(args).not.toContain('-Fp');
    });
  });

  describe('encoding', () => {
    it('should always include --encoding=UTF8', () => {
      const options: PgDumpOptions = { type: 'full', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);
      expect(args).toContain('--encoding=UTF8');
    });
  });

  describe('excluded schemas', () => {
    it('should include all 10 --exclude-schema flags for Supabase-internal schemas', () => {
      const options: PgDumpOptions = { type: 'full', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);

      for (const schema of excludedSchemas) {
        expect(args).toContain(`--exclude-schema=${schema}`);
      }
    });

    it('should have exactly 10 exclude-schema flags', () => {
      const options: PgDumpOptions = { type: 'full', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);
      const excludeArgs = args.filter((arg) => arg.startsWith('--exclude-schema='));
      expect(excludeArgs).toHaveLength(10);
    });
  });

  describe('connection parameters', () => {
    it('should include host, port, username, and dbname flags', () => {
      const options: PgDumpOptions = { type: 'full', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);

      expect(args).toContain('--host=127.0.0.1');
      expect(args).toContain('--port=5432');
      expect(args).toContain('--username=postgres');
      expect(args).toContain('--dbname=sts_car_expert');
    });

    it('should use the provided config values', () => {
      const config: DatabaseConnectionConfig = {
        host: 'db.example.com',
        port: 6543,
        username: 'admin_user',
        dbname: 'production_db',
      };
      const options: PgDumpOptions = { type: 'full', format: 'plain' };
      const args = buildPgDumpArgs(config, options);

      expect(args).toContain('--host=db.example.com');
      expect(args).toContain('--port=6543');
      expect(args).toContain('--username=admin_user');
      expect(args).toContain('--dbname=production_db');
    });
  });

  describe('combined scenarios', () => {
    it('should produce correct args for schema-only custom format', () => {
      const options: PgDumpOptions = { type: 'schema-only', format: 'custom' };
      const args = buildPgDumpArgs(defaultConfig, options);

      expect(args).toContain('--schema-only');
      expect(args).toContain('-Fc');
      expect(args).toContain('--encoding=UTF8');
      expect(args).toContain('--host=127.0.0.1');
      expect(args).toContain('--port=5432');
      expect(args).toContain('--username=postgres');
      expect(args).toContain('--dbname=sts_car_expert');
    });

    it('should produce correct args for data-only plain format', () => {
      const options: PgDumpOptions = { type: 'data-only', format: 'plain' };
      const args = buildPgDumpArgs(defaultConfig, options);

      expect(args).toContain('--data-only');
      expect(args).toContain('-Fp');
      expect(args).toContain('--encoding=UTF8');
    });
  });
});
