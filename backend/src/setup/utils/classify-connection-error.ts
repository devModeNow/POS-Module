export type ClassifiedConnectionError = {
  code: string;
  error: string;
  hint: string;
};

const CGNAT_HOST = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

export function isPrivateOrVpnHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (value === 'localhost' || value === '127.0.0.1' || value === '::1') {
    return true;
  }

  return (
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value) || CGNAT_HOST.test(value)
  );
}

/** Map pg/node connect failures into UI-safe copy. Never includes credentials. */
export function classifyConnectionError(error: unknown, host: string, port: number): ClassifiedConnectionError {
  const raw = error as { code?: string; message?: string };
  const message = String(raw.message ?? 'Unknown error');
  const code = String(raw.code ?? detectCodeFromMessage(message));
  const target = `${host}:${port}`;
  const vpnHint = isPrivateOrVpnHost(host)
    ? ' This looks like a private/VPN address — confirm the tunnel is up and Postgres is listening.'
    : '';

  if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(message)) {
    return {
      code: 'ECONNREFUSED',
      error: `Connection refused at ${target}`,
      hint: `PostgreSQL is not accepting connections on ${target}. Check that the server is running and the port is open.${vpnHint}`,
    };
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'ETIMEOUT' ||
    /timeout expired|ETIMEDOUT|Connection terminated unexpectedly/i.test(message)
  ) {
    return {
      code: 'ETIMEDOUT',
      error: `Timed out reaching ${target}`,
      hint: `The host did not respond in time. Check firewall, VPN, and that Postgres is reachable from this machine.${vpnHint}`,
    };
  }

  if (code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo/i.test(message)) {
    return {
      code: 'ENOTFOUND',
      error: `Host "${host}" could not be resolved`,
      hint: 'The hostname is invalid or DNS failed. Check DB_HOST / DATABASE_URL.',
    };
  }

  if (/password authentication failed/i.test(message)) {
    const user = message.match(/user "([^"]+)"/)?.[1];
    return {
      code: '28P01',
      error: user
        ? `Password authentication failed for user "${user}"`
        : 'Password authentication failed',
      hint: 'The host is reachable, but this username/password was rejected. Update DB_USER, DB_PASSWORD, and the user:password inside DATABASE_URL to the same values that work in pgAdmin, then restart the backend.',
    };
  }

  if (/database ".*" does not exist/i.test(message)) {
    return {
      code: '3D000',
      error: 'Database does not exist',
      hint: 'The host is reachable, but DB_NAME / the database in DATABASE_URL was not found.',
    };
  }

  if (/no pg_hba.conf entry/i.test(message)) {
    return {
      code: '28000',
      error: 'Client is not allowed by pg_hba.conf',
      hint: 'Postgres rejected this client address. Add a matching host entry and reload Postgres.',
    };
  }

  if (/ssl/i.test(message) && /required|not support|does not support|certificate/i.test(message)) {
    return {
      code: 'SSL',
      error: 'SSL handshake failed',
      hint: 'Toggle DB_SSL / DB_SSL_REJECT_UNAUTHORIZED to match the server.',
    };
  }

  return {
    code: code || 'CONNECT_FAILED',
    error: sanitizeErrorMessage(message, target),
    hint: `Could not connect to PostgreSQL at ${target}.${vpnHint}`,
  };
}

function detectCodeFromMessage(message: string): string {
  const match = message.match(/\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EHOSTUNREACH)\b/i);
  return match?.[1]?.toUpperCase() ?? '';
}

function sanitizeErrorMessage(message: string, target: string): string {
  const cleaned = message
    .replace(/postgresql:\/\/[^@\s]+@/gi, 'postgresql://***@')
    .replace(/password\s*=\s*\S+/gi, 'password=***')
    .trim();

  return cleaned || `Could not connect to ${target}`;
}
