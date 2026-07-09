import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SKIP_PATH_PREFIXES = [
  '/login',
  '/setup',
  '/health',
];

const SKIP_PATHS = new Set([
  '/api/pos/staff/heartbeat',
  '/api/pos/void',
]);

const REDACT_KEYS = new Set([
  'password',
  'admincode',
  'admin_code',
  'code',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'secret',
]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      path?: string;
      body?: Record<string, unknown>;
      user?: Record<string, unknown>;
    }>();

    const method = String(req.method ?? '').toUpperCase();
    if (!MUTATING.has(method)) {
      return next.handle();
    }

    const path = this.normalizePath(req.url ?? req.path ?? '');
    if (this.shouldSkip(path)) {
      return next.handle();
    }

    const user = req.user;
    const userId = Number(user?.['sub'] ?? 0);
    if (!Number.isFinite(userId) || userId <= 0) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((body) => {
        if (!this.isSuccessfulResponse(body)) {
          return;
        }
        void this.record(req, method, path, user!, body);
      }),
    );
  }

  private normalizePath(raw: string): string {
    const path = raw.split('?')[0] ?? '';
    return path.startsWith('/') ? path : `/${path}`;
  }

  private shouldSkip(path: string): boolean {
    if (SKIP_PATHS.has(path)) {
      return true;
    }
    return SKIP_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  private isSuccessfulResponse(body: unknown): boolean {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return true;
    }
    const payload = body as Record<string, unknown>;
    return payload.success !== false;
  }

  private async record(
    req: { body?: Record<string, unknown> },
    method: string,
    path: string,
    user: Record<string, unknown>,
    body: unknown,
  ): Promise<void> {
    const { action, entityType, entityId } = this.deriveAction(method, path);
    const orgId = this.toPositiveInt(user['orgId'] ?? user['org_id']);
    const userId = this.toPositiveInt(user['sub']);
    const username =
      typeof user['username'] === 'string'
        ? user['username']
        : typeof user['fullname'] === 'string'
          ? user['fullname']
          : null;

    await this.audit.log({
      orgId,
      userId,
      username,
      action,
      entityType,
      entityId,
      details: {
        method,
        path,
        roleId: user['roleId'] ?? user['role_id'] ?? null,
        roleName: user['roleName'] ?? user['role_name'] ?? null,
        request: this.sanitizeBody(req.body),
        responseId: this.extractResponseId(body),
      },
    });
  }

  private deriveAction(method: string, path: string): {
    action: string;
    entityType: string | null;
    entityId: string | null;
  } {
    const segments = path.replace(/^\//, '').split('/').filter(Boolean);
    let entityId: string | null = null;

    if (segments.length > 0 && /^\d+$/.test(segments[segments.length - 1] ?? '')) {
      entityId = segments.pop() ?? null;
    }

    const verb =
      method === 'POST'
        ? 'create'
        : method === 'DELETE'
          ? 'delete'
          : 'update';

    const module = segments[0] ?? 'api';
    const resource = segments.slice(1).join('.') || module;
    const action = `${module}.${resource}.${verb}`.replace(/\.+/g, '.');

    return {
      action,
      entityType: resource || module,
      entityId,
    };
  }

  private sanitizeBody(body: Record<string, unknown> | undefined): Record<string, unknown> | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (REDACT_KEYS.has(key.toLowerCase())) {
        out[key] = '[redacted]';
        continue;
      }
      if (value != null && typeof value === 'object' && !Array.isArray(value)) {
        out[key] = this.sanitizeBody(value as Record<string, unknown>);
        continue;
      }
      out[key] = value;
    }
    return out;
  }

  private extractResponseId(body: unknown): string | number | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    const payload = body as Record<string, unknown>;
    const data = payload.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const row = data as Record<string, unknown>;
      if (row.id != null) {
        return typeof row.id === 'number' || typeof row.id === 'string' ? row.id : null;
      }
    }
    if (payload.id != null) {
      return typeof payload.id === 'number' || typeof payload.id === 'string' ? payload.id : null;
    }
    return null;
  }

  private toPositiveInt(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
}
