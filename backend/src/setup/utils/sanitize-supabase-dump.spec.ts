import { sanitizeSupabaseDump } from './sanitize-supabase-dump';

describe('sanitizeSupabaseDump', () => {
  it('removes pooler/extension catalog and keeps public data', () => {
    const sql = `\\restrict abc
SET transaction_timeout = 0;
SELECT pg_catalog.set_config('search_path', 'public, extensions', false);
CREATE SCHEMA pgbouncer;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql
    AS $_$
  BEGIN
      RETURN QUERY SELECT 'a'::text, 'b'::text;
  END;
  $_$;
ALTER FUNCTION pgbouncer.get_auth(p_usename text) OWNER TO supabase_admin;
-- Name: items; Type: TABLE; Schema: public; Owner: postgres
CREATE TABLE public.items (id int);
COPY public.items (id) FROM stdin;
1
\\.
GRANT ALL ON FUNCTION extensions.armor(bytea) TO dashboard_user;
GRANT ALL ON TABLE public.items TO anon;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
   EXECUTE FUNCTION rls_auto_enable();
\\unrestrict abc
`;

    const result = sanitizeSupabaseDump(sql);
    expect(result).not.toMatch(/transaction_timeout/);
    expect(result).not.toMatch(/pgbouncer/);
    expect(result).not.toMatch(/supabase_vault/);
    expect(result).not.toMatch(/dashboard_user/);
    expect(result).not.toMatch(/EVENT TRIGGER/);
    expect(result).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    expect(result).toContain("SELECT pg_catalog.set_config('search_path', 'public', false);");
    expect(result).toContain('CREATE TABLE public.items (id int);');
    expect(result).toContain('COPY public.items (id) FROM stdin;');
    expect(result).toContain('1');
  });
});
