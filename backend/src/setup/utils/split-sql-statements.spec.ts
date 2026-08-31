import { splitSqlStatements, stripPsqlMetaCommands } from './split-sql-statements';

describe('splitSqlStatements', () => {
  it('splits simple statements', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('preserves dollar-quoted blocks as one statement', () => {
    const sql = `DO $$
BEGIN
  PERFORM 1;
END $$;
SELECT 2;`;

    expect(splitSqlStatements(sql)).toEqual([
      `DO $$
BEGIN
  PERFORM 1;
END $$`,
      'SELECT 2',
    ]);
  });

  it('ignores line comments', () => {
    expect(splitSqlStatements('-- comment\nSELECT 1;')).toEqual(['SELECT 1']);
  });

  it('skips pg_dump psql meta-commands', () => {
    const sql = `\\restrict abc123
SET statement_timeout = 0;
SELECT 1;
\\unrestrict abc123`;

    expect(splitSqlStatements(sql)).toEqual(['SET statement_timeout = 0', 'SELECT 1']);
  });
});

describe('stripPsqlMetaCommands', () => {
  it('removes \\restrict and \\unrestrict lines', () => {
    const sql = `\\restrict tok
SET x = 1;
\\unrestrict tok`;
    expect(stripPsqlMetaCommands(sql)).toBe('SET x = 1;');
  });
});
