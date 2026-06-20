import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  private toPositiveInt(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, unknown>;
      user?: Record<string, unknown>;
    }>();

    const authHeader = request.headers['authorization'];
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const secret = this.configService.get<string>('JWT_SECRET', 'dev-secret');

    try {
      const payload = verify(token, secret);
      if (!payload || typeof payload !== 'object') {
        throw new UnauthorizedException('Invalid token payload');
      }

      const p = payload as Record<string, unknown>;

      // Resolve orgId — from JWT only (no header override for org context)
      const orgId   = this.toPositiveInt(p['orgId'] ?? p['org_id']);
      const orgCode = typeof p['orgCode'] === 'string' ? p['orgCode'] : null;
      const orgName = typeof p['orgName'] === 'string' ? p['orgName'] : null;

      // Platform user = orgId is null
      const isPlatformUser = orgId === null;

      request.user = {
        ...p,
        orgId,
        orgCode,
        orgName,
        isPlatformUser,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
