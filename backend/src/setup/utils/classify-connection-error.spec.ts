import { classifyConnectionError, isPrivateOrVpnHost } from './classify-connection-error';

describe('classifyConnectionError', () => {
  it('explains ECONNREFUSED with host and port', () => {
    const result = classifyConnectionError(
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 100.126.19.14:5432' },
      '100.126.19.14',
      5432,
    );

    expect(result.code).toBe('ECONNREFUSED');
    expect(result.error).toContain('100.126.19.14:5432');
    expect(result.hint).toMatch(/not accepting connections/i);
    expect(result.hint).toMatch(/VPN/i);
  });

  it('explains password rejection without leaking the password', () => {
    const result = classifyConnectionError(
      { message: 'password authentication failed for user "db_admin_staging"' },
      '100.126.19.14',
      5432,
    );

    expect(result.code).toBe('28P01');
    expect(result.error).toContain('db_admin_staging');
    expect(result.error.toLowerCase()).not.toContain('password=');
    expect(result.hint).toMatch(/DATABASE_URL/i);
  });

  it('does not leak connection-string credentials', () => {
    const result = classifyConnectionError(
      { message: 'connect failed postgresql://secret_user:super-secret@db.example:5432/app' },
      'db.example',
      5432,
    );

    expect(result.error).not.toContain('super-secret');
    expect(result.error).toContain('postgresql://***@');
  });
});

describe('isPrivateOrVpnHost', () => {
  it('detects CGNAT / Tailscale-style 100.x hosts', () => {
    expect(isPrivateOrVpnHost('100.126.19.14')).toBe(true);
    expect(isPrivateOrVpnHost('8.8.8.8')).toBe(false);
  });
});
