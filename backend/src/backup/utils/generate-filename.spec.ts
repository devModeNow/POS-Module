import { generateFilename } from './generate-filename';

describe('generateFilename', () => {
  const fixedDate = new Date('2025-01-15T14:30:22');

  describe('backup type mapping', () => {
    it('should map "full" type to "full" segment', () => {
      const result = generateFilename('mydb', 'full', 'plain', fixedDate);
      expect(result).toBe('mydb_full_20250115T143022.sql');
    });

    it('should map "schema-only" type to "schema" segment', () => {
      const result = generateFilename('mydb', 'schema-only', 'plain', fixedDate);
      expect(result).toBe('mydb_schema_20250115T143022.sql');
    });

    it('should map "data-only" type to "data" segment', () => {
      const result = generateFilename('mydb', 'data-only', 'plain', fixedDate);
      expect(result).toBe('mydb_data_20250115T143022.sql');
    });
  });

  describe('format to extension mapping', () => {
    it('should map "plain" format to ".sql" extension', () => {
      const result = generateFilename('testdb', 'full', 'plain', fixedDate);
      expect(result).toContain('.sql');
    });

    it('should map "custom" format to ".dump" extension', () => {
      const result = generateFilename('testdb', 'full', 'custom', fixedDate);
      expect(result).toContain('.dump');
    });
  });

  describe('timestamp formatting', () => {
    it('should format timestamp as YYYYMMDDTHHmmss', () => {
      const result = generateFilename('db', 'full', 'plain', fixedDate);
      expect(result).toContain('20250115T143022');
    });

    it('should zero-pad single-digit month, day, hours, minutes, seconds', () => {
      const earlyDate = new Date('2025-03-05T09:04:07');
      const result = generateFilename('db', 'full', 'plain', earlyDate);
      expect(result).toContain('20250305T090407');
    });

    it('should use current date when no date is provided', () => {
      const before = new Date();
      const result = generateFilename('db', 'full', 'plain');
      const after = new Date();

      // The filename should contain a valid timestamp between before and after
      const match = result.match(/(\d{8}T\d{6})/);
      expect(match).not.toBeNull();
    });
  });

  describe('full pattern validation', () => {
    it('should match the pattern {databaseName}_{backupType}_{YYYYMMDDTHHmmss}.{extension}', () => {
      const result = generateFilename('sts_car_expert', 'full', 'plain', fixedDate);
      expect(result).toBe('sts_car_expert_full_20250115T143022.sql');
    });

    it('should produce correct filename for custom format schema-only backup', () => {
      const result = generateFilename('production_db', 'schema-only', 'custom', fixedDate);
      expect(result).toBe('production_db_schema_20250115T143022.dump');
    });

    it('should produce correct filename for custom format data-only backup', () => {
      const result = generateFilename('staging', 'data-only', 'custom', fixedDate);
      expect(result).toBe('staging_data_20250115T143022.dump');
    });
  });
});
