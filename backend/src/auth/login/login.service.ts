import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { CreateLoginDto } from './dto/create-login.dto';
import { UpdateLoginDto } from './dto/update-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { DatabaseService } from 'src/database/database.service';

type UserRow = {
  id: number;
  username: string;
  fullname: string | null;
  email: string | null;
  roleId: number | null;
  roleName: string | null;
  roleMenus: string | null;
  rolePermission: string | null;
  orgId: number | null;
  orgCode: string | null;
  orgName: string | null;
};

@Injectable()
export class LoginService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private getRefreshSecret(): string {
    return this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      this.configService.get<string>('JWT_SECRET', 'dev-secret'),
    );
  }

  private getRefreshExpiry(): string {
    return this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
  }

  private readonly userQuery = `
    SELECT
      u.id,
      u.username,
      u.fullname                                        AS fullname,
      u.email,
      u."roleId"                                       AS "roleId",
      r."roleName"                                      AS "roleName",
      r."roleMenus"                                     AS "roleMenus",
      r."rolePermission"                                AS "rolePermission",
      o.id                                              AS "orgId",
      o.code                                            AS "orgCode",
      o.name                                            AS "orgName"
    FROM tblusers u
    LEFT JOIN tblrbac r ON r.id = u."roleId"
    LEFT JOIN tblorganizations o ON o.id = u.org_id
  `;

  /** Normalize roleMenus from any format (JSON array, CSV, 'ALL') to CSV string */
  private normalizeMenus(raw: string | null): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (trimmed.toUpperCase() === 'ALL') return 'ALL';
    // JSON array: ["dashboard","customers",...]
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed) as unknown[];
        return arr.map((v) => String(v).trim()).filter(Boolean).join(',');
      } catch { /* fall through */ }
    }
    // Already CSV
    return trimmed;
  }

  /** Normalize rolePermission from any format (JSON object, CSV, 'ALL') to CSV string */
  private normalizePermissions(raw: string | null): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (trimmed.toUpperCase() === 'ALL') return 'ALL';
    // JSON object: {"read":true,"write":true,...}
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const perms: string[] = [];
        if (obj['read'])   perms.push('canRead');
        if (obj['write'])  perms.push('canCreate');
        if (obj['update']) perms.push('canUpdate');
        if (obj['delete']) perms.push('canDelete');
        return perms.join(',') || 'canRead';
      } catch { /* fall through */ }
    }
    // Already CSV
    return trimmed;
  }

  private buildPayload(user: UserRow) {
    return {
      sub:         user.id,
      username:    user.username,
      fullname:    user.fullname,
      email:       user.email,
      roleId:      user.roleId,
      roleName:    user.roleName,
      menus:       this.normalizeMenus(user.roleMenus),
      permissions: this.normalizePermissions(user.rolePermission),
      orgId:       user.orgId,
      orgCode:     user.orgCode,
      orgName:     user.orgName,
    };
  }

  private buildRefreshPayload(user: UserRow) {
    return { sub: user.id, username: user.username, tokenType: 'refresh' };
  }

  async create(createLoginDto: CreateLoginDto) {
    const { username, password } = createLoginDto;
    const passwordSha1 = createHash('sha1').update(password).digest('hex');

    try {
      const result = await this.databaseService.query<UserRow>(
        `${this.userQuery}
         WHERE u.username = $1
           AND u.password = $2
           AND COALESCE(u.is_deleted, false) = false
           AND COALESCE(u.status, 1) != 0
           AND (o.id IS NULL OR o.is_active = true)
         LIMIT 1`,
        [username, passwordSha1],
      );

      if (result.rowCount === 0) {
        // Check if user exists but org is deactivated
        const userCheck = await this.databaseService.query<{ id: number }>(
          `SELECT u.id FROM tblusers u
           LEFT JOIN tblorganizations o ON o.id = u.org_id
           WHERE u.username = $1 AND u.password = $2
             AND COALESCE(u.is_deleted, false) = false
             AND COALESCE(u.status, 1) != 0
             AND o.is_active = false LIMIT 1`,
          [username, passwordSha1],
        );
        if (userCheck.rowCount > 0) {
          return { success: false, message: 'Your organization has been deactivated. Please contact the platform administrator.' };
        }
        return { success: false, message: 'Invalid username or password' };
      }

      const user = result.rows[0];
      const payload = this.buildPayload(user);

      const accessToken = await this.jwtService.signAsync(payload);
      const refreshToken = await this.jwtService.signAsync(
        this.buildRefreshPayload(user),
        { secret: this.getRefreshSecret(), expiresIn: this.getRefreshExpiry() as any },
      );

      return {
        success: true,
        accessToken,
        refreshToken,
        role: {
          id:          user.roleId,
          name:        user.roleName,
          menus:       user.roleMenus,
          permissions: user.rolePermission,
        },
        org: {
          id:   user.orgId,
          code: user.orgCode,
          name: user.orgName,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to connect to PostgreSQL',
      };
    }
  }

  async refresh(refreshTokenDto: RefreshTokenDto) {
    const refreshToken = String(refreshTokenDto?.refreshToken ?? '').trim();
    if (!refreshToken) {
      return { success: false, message: 'refreshToken is required' };
    }

    try {
      const payload = verify(refreshToken, this.getRefreshSecret()) as {
        sub?: unknown;
        tokenType?: string;
      };

      if (payload?.tokenType !== 'refresh') {
        return { success: false, message: 'Invalid refresh token' };
      }

      const userId = Number(payload.sub);
      if (!Number.isFinite(userId) || userId <= 0) {
        return { success: false, message: 'Invalid refresh token payload' };
      }

      const result = await this.databaseService.query<UserRow>(
        `${this.userQuery}
         WHERE u.id = $1
           AND COALESCE(u.is_deleted, false) = false
           AND COALESCE(u.status, 1) != 0
           AND (o.id IS NULL OR o.is_active = true)
         LIMIT 1`,
        [userId],
      );

      if (result.rowCount === 0) {
        return { success: false, message: 'User not found' };
      }

      const user = result.rows[0];
      const nextPayload = this.buildPayload(user);

      const nextAccessToken = await this.jwtService.signAsync(nextPayload);
      const nextRefreshToken = await this.jwtService.signAsync(
        this.buildRefreshPayload(user),
        { secret: this.getRefreshSecret(), expiresIn: this.getRefreshExpiry() as any },
      );

      return {
        success: true,
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
        role: {
          id:          user.roleId,
          name:        user.roleName,
          menus:       user.roleMenus,
          permissions: user.rolePermission,
        },
        org: {
          id:   user.orgId,
          code: user.orgCode,
          name: user.orgName,
        },
      };
    } catch {
      return { success: false, message: 'Invalid or expired refresh token' };
    }
  }

  update(id: number, updateLoginDto: UpdateLoginDto) {
    void updateLoginDto;
    return `This action updates a #${id} login`;
  }

  remove(id: number) {
    return `This action removes a #${id} login`;
  }

  findAll() {
    return 'This action returns all login';
  }

  findOne(id: number) {
    return `This action returns a #${id} login`;
  }

  async verifyPassword(userId: number, password: string) {
    if (!password) return { success: false, message: 'Password is required' };
    const passwordSha1 = createHash('sha1').update(password).digest('hex');
    try {
      const result = await this.databaseService.query<{ id: number }>(
        `SELECT id FROM tblusers WHERE id = $1 AND password = $2 LIMIT 1`,
        [userId, passwordSha1],
      );
      if (result.rowCount === 0) return { success: false, message: 'Invalid password' };
      return { success: true };
    } catch {
      return { success: false, message: 'Verification failed' };
    }
  }
}
