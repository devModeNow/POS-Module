import { convertCopyFromStdinToInserts } from './copy-to-inserts';

describe('convertCopyFromStdinToInserts', () => {
  it('converts a COPY block into INSERT statements', () => {
    const sql = `CREATE TABLE public.tblusers (id int, name text);
COPY public.tblusers (id, name) FROM stdin;
1	admin
2	\\N
\\.
SELECT 1;
`;

    const result = convertCopyFromStdinToInserts(sql);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sql).toContain('CREATE TABLE public.tblusers (id int, name text);');
    expect(result.sql).toContain(
      `INSERT INTO public.tblusers (id, name) VALUES\n('1', 'admin'),\n('2', NULL);`,
    );
    expect(result.sql).toContain('SELECT 1;');
    expect(result.sql).not.toMatch(/FROM\s+stdin/i);
  });

  it('unescapes tabs and quotes in COPY fields', () => {
    const sql = `COPY public.items (label) FROM stdin;
a\\tb's
\\.
`;
    const result = convertCopyFromStdinToInserts(sql);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain(`('a\tb''s')`);
  });

  it('skips empty COPY tables', () => {
    const sql = `COPY public.empty_table FROM stdin;
\\.
`;
    const result = convertCopyFromStdinToInserts(sql);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql.trim()).toBe('');
  });

  it('keeps surrounding SQL including pg_dump meta-commands for later stripping', () => {
    const sql = `\\restrict tok
COPY public.t (id) FROM stdin;
1
\\.
\\unrestrict tok
`;
    const result = convertCopyFromStdinToInserts(sql);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain('\\restrict tok');
    expect(result.sql).toContain("INSERT INTO public.t (id) VALUES\n('1');");
    expect(result.sql).toContain('\\unrestrict tok');
  });
});
