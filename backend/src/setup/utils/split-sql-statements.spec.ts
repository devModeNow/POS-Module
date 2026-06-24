import { splitSqlStatements } from './split-sql-statements';

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
});
