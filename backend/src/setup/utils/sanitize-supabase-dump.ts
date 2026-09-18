const SUPABASE_ROLES =
  /\b(anon|authenticated|service_role|dashboard_user|supabase_admin|pgbouncer)\b/i;
const SUPABASE_SCHEMAS = /\b(extensions|vault|pgbouncer)\./i;
const SKIP_FUNCTION_NAMES =
  /pgbouncer\.|rls_auto_enable|set_graphql_placeholder|grant_pg_cron_access|grant_pg_graphql_access|grant_pg_net_access|pgrst_|graphql_placeholder/i;

/** Strip Supabase/pooler catalog objects so a dump can restore on local Postgres. */
export function sanitizeSupabaseDump(sql: string): string {
  const lines = sql.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let skippingBlock = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^COPY\s+/i.test(trimmed)) {
      out.push(line);
      i++;
      while (i < lines.length) {
        out.push(lines[i]);
        if (lines[i].trim() === '\\.') {
          break;
        }
        i++;
      }
      i++;
      continue;
    }

    if (skippingBlock) {
      if (/^-- Name:/.test(trimmed) && !SKIP_FUNCTION_NAMES.test(trimmed)) {
        skippingBlock = false;
        continue;
      }
      i++;
      continue;
    }

    if (/^\\(restrict|unrestrict)\b/i.test(trimmed)) {
      i++;
      continue;
    }

    if (/^SET transaction_timeout\b/i.test(trimmed)) {
      i++;
      continue;
    }

    if (/set_config\(\s*'search_path'/i.test(trimmed)) {
      out.push("SELECT pg_catalog.set_config('search_path', 'public', false);");
      i++;
      continue;
    }

    if (/^CREATE SCHEMA pgbouncer\b/i.test(trimmed) || /^ALTER SCHEMA pgbouncer\b/i.test(trimmed)) {
      i++;
      continue;
    }

    if (
      /^CREATE EXTENSION IF NOT EXISTS supabase_vault\b/i.test(trimmed) ||
      /^CREATE EXTENSION IF NOT EXISTS pg_stat_statements\b/i.test(trimmed)
    ) {
      i++;
      continue;
    }

    if (/^COMMENT ON EXTENSION (supabase_vault|pg_stat_statements)\b/i.test(trimmed)) {
      i++;
      continue;
    }

    if (/^CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA/i.test(trimmed)) {
      out.push('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
      i++;
      continue;
    }

    if (/^CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA/i.test(trimmed)) {
      out.push('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
      i++;
      continue;
    }

    if (
      /^CREATE FUNCTION pgbouncer\./i.test(trimmed) ||
      /^CREATE FUNCTION public\.rls_auto_enable\b/i.test(trimmed) ||
      SKIP_FUNCTION_NAMES.test(trimmed) && /^CREATE FUNCTION\b/i.test(trimmed)
    ) {
      skippingBlock = true;
      i++;
      continue;
    }

    if (
      /^ALTER FUNCTION pgbouncer\./i.test(trimmed) ||
      /^ALTER FUNCTION public\.rls_auto_enable\b/i.test(trimmed)
    ) {
      i++;
      continue;
    }

    if (/^CREATE EVENT TRIGGER\b/i.test(trimmed) || /^ALTER EVENT TRIGGER\b/i.test(trimmed)) {
      while (i < lines.length && !lines[i].includes(';')) {
        i++;
      }
      i++;
      continue;
    }

    if (/^CREATE PUBLICATION supabase_/i.test(trimmed) || /^ALTER PUBLICATION supabase_/i.test(trimmed)) {
      while (i < lines.length && !lines[i].includes(';')) {
        i++;
      }
      i++;
      continue;
    }

    if (/^(SET SESSION AUTHORIZATION|RESET SESSION AUTHORIZATION)\b/i.test(trimmed)) {
      i++;
      continue;
    }

    if (shouldDropCatalogLine(trimmed)) {
      i++;
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join('\n');
}

function shouldDropCatalogLine(trimmed: string): boolean {
  if (/^ALTER DEFAULT PRIVILEGES\b/i.test(trimmed)) {
    return true;
  }

  if (/OWNER TO (pgbouncer|supabase_admin)\b/i.test(trimmed)) {
    return true;
  }

  if (/^(GRANT|REVOKE)\b/i.test(trimmed)) {
    return SUPABASE_ROLES.test(trimmed) || SUPABASE_SCHEMAS.test(trimmed);
  }

  if (/^COMMENT ON (FUNCTION|SCHEMA|EXTENSION|TABLE)\b/i.test(trimmed)) {
    return SUPABASE_SCHEMAS.test(trimmed) || /pgbouncer|rls_auto_enable|supabase_vault/i.test(trimmed);
  }

  return false;
}
