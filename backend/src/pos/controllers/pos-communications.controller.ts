import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PosChatService } from '../services/pos-chat.service';
import { PosNotificationsService } from '../services/pos-notifications.service';

type AuthReq = { user?: Record<string, unknown> };

const orgId = (req: AuthReq): number => {
  const n = Number(req.user?.['orgId'] ?? req.user?.['org_id'] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const userId = (req: AuthReq): number => {
  const n = Number(req.user?.['sub'] ?? req.user?.['userId'] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const isAdmin = (req: AuthReq) => {
  const role = String(req.user?.['roleName'] ?? '').toLowerCase();
  return role.includes('admin') || role.includes('super');
};

@Controller('api/pos/communications')
@UseGuards(JwtAuthGuard)
export class PosCommunicationsController {
  constructor(
    private readonly chatService: PosChatService,
    private readonly notificationsService: PosNotificationsService,
  ) {}

  @Get('chat/users')
  listChatUsers(@Req() req: AuthReq) {
    return this.chatService.listChatUsers(orgId(req), userId(req));
  }

  @Get('chat/messages')
  listChat(
    @Query('sinceId') sinceId: string,
    @Query('mode') mode: string,
    @Query('recipientId') recipientId: string,
    @Req() req: AuthReq,
  ) {
    const chatMode = mode === 'private' ? 'private' : 'team';
    return this.chatService.listMessages(
      orgId(req),
      userId(req),
      Number(sinceId) || 0,
      chatMode,
      Number(recipientId) || undefined,
    );
  }

  @Post('chat/messages')
  async sendChat(
    @Body() body: { message?: string; recipientId?: number | null; mode?: string },
    @Req() req: AuthReq,
  ) {
    const oid = orgId(req);
    const uid = userId(req);
    const isPrivate = body?.mode === 'private';
    const peer = isPrivate && body?.recipientId ? Number(body.recipientId) : null;

    if (isPrivate && (!peer || peer <= 0)) {
      return { success: false, message: 'Select a user for private chat' };
    }

    const result = await this.chatService.sendMessage(oid, uid, body?.message ?? '', peer);
    if (result.success) {
      const senderName = String(req.user?.['fullname'] ?? req.user?.['username'] ?? 'User');
      const preview = String(body?.message ?? '').trim().slice(0, 120);
      if (peer) {
        await this.notificationsService.notifyMessage(
          oid,
          peer,
          'New private message',
          `${senderName}: ${preview}`,
          'chat',
          uid,
        );
      } else {
        await this.notificationsService.notifyMessage(oid, null, 'New team message', `${senderName}: ${preview}`, 'chat');
      }
    }
    return result;
  }

  @Get('notifications')
  listNotifications(@Req() req: AuthReq) {
    return this.notificationsService.list(orgId(req), userId(req), isAdmin(req));
  }

  @Get('notifications/unread-count')
  unreadCount(@Req() req: AuthReq) {
    return this.notificationsService.unreadCount(orgId(req), userId(req), isAdmin(req));
  }

  @Patch('notifications/read')
  markRead(@Body() body: { id?: number }, @Req() req: AuthReq) {
    return this.notificationsService.markRead(orgId(req), userId(req), body?.id);
  }
}
