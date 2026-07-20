import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PosChatService } from '../services/pos-chat.service';
import { PosNotificationsService } from '../services/pos-notifications.service';
import {
  isPosCashier,
  posOrgId,
  posUserId,
  receivesPosAdminNotifications,
} from '../utils/pos-auth.util';

type AuthReq = { user?: Record<string, unknown> };

@Controller('api/pos/communications')
@UseGuards(JwtAuthGuard)
export class PosCommunicationsController {
  constructor(
    private readonly chatService: PosChatService,
    private readonly notificationsService: PosNotificationsService,
  ) {}

  @Get('chat/users')
  listChatUsers(@Req() req: AuthReq) {
    return this.chatService.listChatUsers(posOrgId(req), posUserId(req));
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
      posOrgId(req),
      posUserId(req),
      Number(sinceId) || 0,
      chatMode,
      Number(recipientId) || undefined,
    );
  }

  @Post('chat/messages')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  async sendChat(
    @Body() body: { message?: string; recipientId?: string | number | null; mode?: string },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthReq,
  ) {
    const oid = posOrgId(req);
    const uid = posUserId(req);
    const isPrivate = body?.mode === 'private';
    const peer = isPrivate && body?.recipientId ? Number(body.recipientId) : null;

    if (isPrivate && (!peer || peer <= 0)) {
      return { success: false, message: 'Select a user for private chat' };
    }

    const result = await this.chatService.sendMessage(oid, uid, body?.message ?? '', peer, file);
    if (result.success) {
      const senderName = String(req.user?.['fullname'] ?? req.user?.['username'] ?? 'User');
      const preview = String(body?.message ?? '').trim().slice(0, 120) || (file ? '📷 Sent a photo' : '');
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
        await this.notificationsService.notifyMessage(
          oid,
          null,
          'New team message',
          `${senderName}: ${preview}`,
          'chat',
          uid,
        );
      }
    }
    return result;
  }

  @Delete('chat/messages/:id')
  deleteChatMessage(@Param('id') id: string, @Req() req: AuthReq) {
    return this.chatService.deleteMessage(posOrgId(req), posUserId(req), !isPosCashier(req), Number(id));
  }

  @Post('chat/clear')
  clearChat(@Body() body: { mode?: string; recipientId?: string | number }, @Req() req: AuthReq) {
    const mode = body?.mode === 'private' ? 'private' : 'team';
    const recipientId = body?.recipientId ? Number(body.recipientId) : undefined;
    return this.chatService.clearChat(posOrgId(req), posUserId(req), mode, recipientId);
  }

  @Get('notifications')
  listNotifications(@Req() req: AuthReq) {
    return this.notificationsService.list(
      posOrgId(req),
      posUserId(req),
      receivesPosAdminNotifications(req),
    );
  }

  @Get('notifications/unread-count')
  unreadCount(@Req() req: AuthReq) {
    return this.notificationsService.unreadCount(
      posOrgId(req),
      posUserId(req),
      receivesPosAdminNotifications(req),
    );
  }

  @Patch('notifications/read')
  markRead(@Body() body: { id?: number }, @Req() req: AuthReq) {
    return this.notificationsService.markRead(posOrgId(req), posUserId(req), body?.id);
  }
}
