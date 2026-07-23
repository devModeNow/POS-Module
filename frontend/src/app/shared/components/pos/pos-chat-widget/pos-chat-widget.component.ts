import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  PosChatMessage,
  PosChatUser,
  PosCommunicationsService,
} from '../../../services/pos-communications.service';
import { PosChatUiService } from '../../../services/pos-chat-ui.service';
import { PosService } from '../../../services/pos.service';
import { RbacService } from '../../../services/rbac.service';
import { ConfirmDialogComponent } from '../../ui/confirm-dialog/confirm-dialog.component';
const HIDDEN_KEY = 'pos-chat-hidden';
const HEARTBEAT_MS = 2 * 60 * 1000;
const USERS_POLL_MS = 15 * 1000;
const MESSAGE_POLL_MS = 9 * 1000;
const NOTIF_POLL_MS = 5 * 1000;
const LONG_PRESS_MS = 500;
@Component({
  selector: 'app-pos-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './pos-chat-widget.component.html',
  styles: `
    :host { display: contents; }
    .chat-messages {
      background: #e4e6eb;
    }
    :host-context(.dark) .chat-messages {
      background: #18191a;
    }
    .bubble-incoming {
      background: #fff;
      color: #050505;
    }
    :host-context(.dark) .bubble-incoming {
      background: #3e4042;
      color: #e4e6eb;
    }
    .bubble-outgoing {
      background: linear-gradient(135deg, #0084ff 0%, #0066cc 100%);
      color: #fff;
    }
  `,
})
export class PosChatWidgetComponent implements OnInit, OnDestroy {
  readonly defaultAvatar = '/images/user/faceless-avatar.svg';
  hidden = false;
  expanded = false;
  loading = false;
  usersLoading = false;
  sending = false;
  sendError = '';
  draft = '';
  chatMode: 'team' | 'private' = 'team';
  privateRecipientId: number | null = null;
  privateRecipientName = '';
  privateUserSearch = '';
  showPrivateUserPicker = true;
  users: PosChatUser[] = [];
  messages: PosChatMessage[] = [];
  lastMessageId = 0;
  lastSeenMessageId: number | null = null;
  hasNewMessage = false;
  selectedImageFile: File | null = null;
  selectedImagePreview: string | null = null;
  lightboxUrl: string | null = null;
  contextMenuMessage: PosChatMessage | null = null;
  contextMenuX = 0;
  contextMenuY = 0;
  confirmOpen = false;
  confirmTitle = 'Confirm';
  confirmMessage = '';
  confirmLabel = 'Confirm';
  confirmVariant: 'primary' | 'danger' = 'danger';
  private confirmAction: (() => Promise<void>) | null = null;
  private longPressTimer?: ReturnType<typeof setTimeout>;
  @ViewChild('chatPanel') chatPanelRef?: ElementRef<HTMLElement>;
  @ViewChild('fabBtn') fabBtnRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('messagesBox') messagesBoxRef?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private usersPollTimer?: ReturnType<typeof setInterval>;
  private notifPollTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private openSub?: Subscription;
  private lastSeenNotificationId = 0;
  private notifBaselineReady = false;
  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly chatUi: PosChatUiService,
    private readonly rbac: RbacService,
    private readonly posService: PosService,
  ) {}
  ngOnInit(): void {
    this.hidden = localStorage.getItem(HIDDEN_KEY) === '1';
    this.startPresenceHeartbeat();
    void this.loadUsers();
    void this.reloadThread(true);
    this.pollTimer = setInterval(() => {
      if (this.shouldPollMessages()) void this.reloadThread(false);
    }, MESSAGE_POLL_MS);
    this.usersPollTimer = setInterval(() => {
      if (this.expanded || this.privateRecipientId) void this.loadUsers(true);
    }, USERS_POLL_MS);
    this.notifPollTimer = setInterval(() => void this.checkForNewMessageNotifications(), NOTIF_POLL_MS);
    void this.checkForNewMessageNotifications();
    this.openSub = this.chatUi.openRequests$.subscribe((req) => this.handleOpenRequest(req));
  }
  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.usersPollTimer) clearInterval(this.usersPollTimer);
    if (this.notifPollTimer) clearInterval(this.notifPollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.cancelLongPress();
    this.openSub?.unsubscribe();
  }
  private startPresenceHeartbeat(): void {
    if (!this.rbac.getOrgId()) return;
    void this.pulsePresence();
    this.heartbeatTimer = setInterval(() => void this.pulsePresence(), HEARTBEAT_MS);
  }
  private async pulsePresence(): Promise<void> {
    const r = await this.posService.staffHeartbeat();
    if (r?.success && (this.expanded || this.privateRecipientId)) {
      void this.loadUsers(true);
    }
  }
  private hasActivePrivateChat(): boolean {
    return this.chatMode === 'private' && !!this.privateRecipientId;
  }
  private shouldPollMessages(): boolean {
    if (typeof document !== 'undefined' && document.hidden) return false;
    return this.expanded || this.hasActivePrivateChat();
  }
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (typeof document !== 'undefined' && !document.hidden && this.shouldPollMessages()) {
      void this.reloadThread(false);
    }
  }
  private normalizeUserId(id: unknown): number | null {
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  private coerceOnline(value: unknown): boolean {
    return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
  }
  private normalizeUsers(raw: PosChatUser[]): PosChatUser[] {
    return raw.map((u) => ({
      ...u,
      id: Number(u.id),
      isOnline: this.coerceOnline(u.isOnline),
    }));
  }
  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (this.contextMenuMessage && !target.closest?.('.chat-context-menu')) {
      this.closeContextMenu();
    }
    if (this.lightboxUrl) return;
    if (this.confirmOpen) return;
    if (!this.expanded || this.hidden) return;
    if (this.chatPanelRef?.nativeElement.contains(target)) return;
    if (this.fabBtnRef?.nativeElement.contains(target)) return;
    this.expanded = false;
  }
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.contextMenuMessage) {
      this.closeContextMenu();
      return;
    }
    if (this.lightboxUrl) {
      this.closeLightbox();
    }
  }
  get threadTitle(): string {
    if (this.chatMode === 'private' && this.privateRecipientName && !this.showPrivateUserPicker) {
      return this.privateRecipientName;
    }
    if (this.chatMode === 'private') return 'Private Messages';
    return 'Team Chat';
  }
  get filteredPrivateUsers(): PosChatUser[] {
    const q = this.privateUserSearch.trim().toLowerCase();
    if (!q) return this.users;
    return this.users.filter((u) => {
      const hay = `${u.name} ${u.roleName ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }
  get selectedPrivateUser(): PosChatUser | null {
    if (!this.privateRecipientId) return null;
    return this.users.find((u) => Number(u.id) === Number(this.privateRecipientId)) ?? null;
  }
  isRecipientOnline(): boolean {
    const user = this.selectedPrivateUser;
    return user ? this.coerceOnline(user.isOnline) : false;
  }
  userIsOnline(user: PosChatUser): boolean {
    return this.coerceOnline(user.isOnline);
  }
  get showPrivateSearch(): boolean {
    return this.chatMode === 'private';
  }
  handleOpenRequest(req: { mode: 'team' | 'private'; userId?: number; userName?: string }): void {
    this.hidden = false;
    this.expanded = true;
    this.clearNewMessageBadge();
    localStorage.removeItem(HIDDEN_KEY);
    if (req.mode === 'private') {
      this.chatMode = 'private';
      void this.loadUsers();
      if (req.userId) {
        this.privateRecipientId = this.normalizeUserId(req.userId);
        this.privateRecipientName = req.userName ?? 'User';
        this.showPrivateUserPicker = false;
      } else {
        this.showPrivateUserPicker = true;
      }
    } else {
      this.chatMode = 'team';
      this.privateRecipientId = null;
      this.privateRecipientName = '';
      this.showPrivateUserPicker = true;
    }
    void this.reloadThread(true);
  }
  showWidget(): void {
    this.hidden = false;
    localStorage.removeItem(HIDDEN_KEY);
    this.expanded = true;
    this.clearNewMessageBadge();
    void this.loadUsers();
    void this.reloadThread(true);
  }
  hideWidget(): void {
    this.hidden = true;
    this.expanded = false;
    localStorage.setItem(HIDDEN_KEY, '1');
  }
  toggleExpanded(): void {
    this.expanded = !this.expanded;
    if (this.expanded) {
      this.clearNewMessageBadge();
      void this.loadUsers();
      void this.reloadThread(true);
    }
  }
  async loadUsers(silent = false): Promise<void> {
    if (!silent) this.usersLoading = true;
    try {
      const r = await this.comms.listChatUsers();
      this.users = this.normalizeUsers(r?.success ? (r.data ?? []) : []);
      if (this.privateRecipientId) {
        const user = this.users.find((u) => Number(u.id) === Number(this.privateRecipientId));
        if (user) {
          this.privateRecipientName = user.name;
        }
      }
    } finally {
      if (!silent) this.usersLoading = false;
    }
  }
  setTeamMode(): void {
    this.chatMode = 'team';
    this.onModeChange();
  }
  setPrivateMode(): void {
    this.chatMode = 'private';
    this.showPrivateUserPicker = !this.privateRecipientId;
    void this.loadUsers();
    this.onModeChange();
  }
  onModeChange(): void {
    this.sendError = '';
    this.privateUserSearch = '';
    this.clearSelectedImage();
    if (this.chatMode === 'team') {
      this.privateRecipientId = null;
      this.privateRecipientName = '';
      this.showPrivateUserPicker = true;
    }
    void this.reloadThread(true);
  }
  selectPrivateUser(user: PosChatUser): void {
    this.privateRecipientId = this.normalizeUserId(user.id);
    this.privateRecipientName = user.name;
    this.showPrivateUserPicker = false;
    this.privateUserSearch = '';
    this.sendError = '';
    void this.reloadThread(true);
  }
  openPrivateUserPicker(): void {
    this.showPrivateUserPicker = true;
    this.privateUserSearch = '';
  }
  async reloadThread(full = false): Promise<void> {
    if (this.chatMode === 'private' && !this.privateRecipientId) {
      this.messages = [];
      this.lastMessageId = 0;
      return;
    }
    if (full) {
      this.loading = true;
      this.messages = [];
      this.lastMessageId = 0;
    }
    let appended = false;
    try {
      const r = await this.comms.listChatMessages(
        full ? 0 : this.lastMessageId,
        this.chatMode,
        this.privateRecipientId ?? undefined,
      );
      const batch = r?.success ? (r.data ?? []) : [];
      if (full) {
        this.messages = batch;
        appended = batch.length > 0;
      } else if (batch.length) {
        const existingIds = new Set(this.messages.map((m) => m.id));
        const fresh = batch.filter((m) => !existingIds.has(m.id));
        if (fresh.length) {
          this.messages = [...this.messages, ...fresh];
          appended = true;
        }
      }
      if (this.messages.length) {
        this.lastMessageId = this.messages[this.messages.length - 1].id;
      }
      // Only autoscroll when the thread actually grew, so a background poll
      // with no new messages doesn't yank the user's scroll position.
      if (appended) {
        this.scrollMessagesToBottom();
        if (this.expanded) {
          void this.markVisibleChatNotificationsRead();
        }
      }
      if (this.chatMode === 'private' && this.privateRecipientId) {
        await this.refreshSeenStatus();
      } else {
        this.lastSeenMessageId = null;
      }
    } finally {
      if (full) this.loading = false;
    }
  }

  private clearNewMessageBadge(): void {
    this.hasNewMessage = false;
    void this.markVisibleChatNotificationsRead();
  }

  private isThreadVisibleForNotification(title: string, referenceId: number | null): boolean {
    if (!this.expanded || this.hidden) return false;
    const t = String(title ?? '').toLowerCase();
    if (t.includes('team')) {
      return this.chatMode === 'team';
    }
    if (t.includes('private')) {
      return (
        this.chatMode === 'private' &&
        !!this.privateRecipientId &&
        Number(referenceId) === Number(this.privateRecipientId)
      );
    }
    return false;
  }

  private async checkForNewMessageNotifications(): Promise<void> {
    try {
      const r = await this.comms.listNotifications();
      if (!r?.success) return;
      const messageNotifs = (r.data ?? []).filter((n) => String(n.type ?? '').toLowerCase() === 'message');
      if (!messageNotifs.length) {
        this.notifBaselineReady = true;
        return;
      }
      const maxId = Math.max(...messageNotifs.map((n) => Number(n.id) || 0));
      if (!this.notifBaselineReady) {
        this.lastSeenNotificationId = maxId;
        this.notifBaselineReady = true;
        return;
      }
      const fresh = messageNotifs.filter((n) => Number(n.id) > this.lastSeenNotificationId);
      this.lastSeenNotificationId = Math.max(this.lastSeenNotificationId, maxId);
      if (!fresh.length) return;

      let shouldAlert = false;
      for (const n of fresh) {
        const visible = this.isThreadVisibleForNotification(n.title, n.referenceId);
        if (visible) {
          if (!n.isRead) {
            void this.comms.markNotificationsRead(n.id);
          }
          continue;
        }
        shouldAlert = true;
      }
      if (shouldAlert) {
        this.hasNewMessage = true;
        this.playNotificationSound();
      }
    } catch {
      /* non-fatal */
    }
  }

  private async markVisibleChatNotificationsRead(): Promise<void> {
    try {
      const r = await this.comms.listNotifications();
      if (!r?.success) return;
      for (const n of r.data ?? []) {
        if (String(n.type ?? '').toLowerCase() !== 'message' || n.isRead) continue;
        if (this.isThreadVisibleForNotification(n.title, n.referenceId)) {
          await this.comms.markNotificationsRead(n.id);
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  private async refreshSeenStatus(): Promise<void> {
    if (!this.privateRecipientId) {
      this.lastSeenMessageId = null;
      return;
    }
    try {
      const r = await this.comms.getChatSeenStatus(this.privateRecipientId);
      if (r?.success) {
        this.lastSeenMessageId = r.lastSeenMessageId ?? null;
      }
    } catch {
      /* non-fatal */
    }
  }

  isSeenMarker(msg: PosChatMessage): boolean {
    return (
      this.chatMode === 'private' &&
      this.isOwnMessage(msg) &&
      this.lastSeenMessageId != null &&
      this.lastSeenMessageId === msg.id
    );
  }

  private playNotificationSound(): void {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
      osc.onended = () => void ctx.close();
    } catch {
      /* autoplay/audio errors are non-fatal */
    }
  }
  async send(): Promise<void> {
    const text = this.draft.trim();
    if ((!text && !this.selectedImageFile) || this.sending) return;
    if (this.chatMode === 'private' && !this.privateRecipientId) {
      this.sendError = 'Select a user to message';
      return;
    }
    this.sending = true;
    this.sendError = '';
    try {
      const r = await this.comms.sendChatMessage(
        text,
        this.chatMode,
        this.privateRecipientId ?? undefined,
        this.selectedImageFile,
      );
      if (r?.success) {
        this.draft = '';
        this.clearSelectedImage();
        const sent = r.data;
        if (sent?.id) {
          if (!this.messages.some((m) => m.id === sent.id)) {
            this.messages = [...this.messages, sent];
            this.lastMessageId = sent.id;
          }
        } else {
          await this.reloadThread(false);
        }
        this.scrollMessagesToBottom();
      } else {
        this.sendError = r?.message ?? 'Failed to send message';
      }
    } finally {
      this.sending = false;
    }
  }
  triggerFilePicker(): void {
    this.fileInputRef?.nativeElement.click();
  }
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file) this.setSelectedImage(file);
    input.value = '';
  }
  onComposerPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          this.setSelectedImage(file);
          event.preventDefault();
        }
        break;
      }
    }
  }
  private setSelectedImage(file: File): void {
    if (!file.type.startsWith('image/')) {
      this.sendError = 'Only image files can be attached.';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.sendError = 'Image must be under 8MB.';
      return;
    }
    this.sendError = '';
    this.selectedImageFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      this.selectedImagePreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }
  clearSelectedImage(): void {
    this.selectedImageFile = null;
    this.selectedImagePreview = null;
  }
  openAttachment(url?: string | null): void {
    if (!url) return;
    // data: URLs open as blank tabs in many browsers — show an in-app lightbox instead
    this.lightboxUrl = url;
  }
  closeLightbox(): void {
    this.lightboxUrl = null;
  }
  isOwnMessage(msg: PosChatMessage): boolean {
    const uid = this.rbac.getUserId();
    if (uid == null) return false;
    return Number(msg.senderId) === uid;
  }
  canDeleteMessage(msg: PosChatMessage): boolean {
    return this.isOwnMessage(msg) || !this.rbac.isCashier();
  }
  onMessageContextMenu(event: MouseEvent, msg: PosChatMessage): void {
    if (!this.canDeleteMessage(msg)) return;
    event.preventDefault();
    this.openContextMenu(event.clientX, event.clientY, msg);
  }
  onMessageTouchStart(event: TouchEvent, msg: PosChatMessage): void {
    if (!this.canDeleteMessage(msg)) return;
    const touch = event.touches[0];
    const x = touch?.clientX ?? 0;
    const y = touch?.clientY ?? 0;
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => this.openContextMenu(x, y, msg), LONG_PRESS_MS);
  }
  cancelLongPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = undefined;
    }
  }
  private openContextMenu(x: number, y: number, msg: PosChatMessage): void {
    const menuWidth = 150;
    const menuHeight = 44;
    const margin = 8;
    this.contextMenuMessage = msg;
    this.contextMenuX = Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin));
    this.contextMenuY = Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin));
  }
  closeContextMenu(): void {
    this.contextMenuMessage = null;
  }
  async deleteContextMenuMessage(): Promise<void> {
    const msg = this.contextMenuMessage;
    this.closeContextMenu();
    if (!msg) return;
    this.openConfirm({
      title: 'Delete message',
      message: 'Delete this message? This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
      action: async () => {
        const r = await this.comms.deleteChatMessage(msg.id);
        if (r?.success) {
          this.messages = this.messages.filter((m) => m.id !== msg.id);
        } else {
          this.sendError = r?.message ?? 'Failed to delete message';
        }
      },
    });
  }
  get canClearChat(): boolean {
    if (this.chatMode === 'private') return !!this.privateRecipientId && !this.showPrivateUserPicker;
    return true;
  }
  async clearChat(): Promise<void> {
    if (!this.canClearChat) return;
    const label =
      this.chatMode === 'private'
        ? `your conversation with ${this.privateRecipientName || 'this person'}`
        : 'the entire team chat for everyone';
    this.openConfirm({
      title: 'Clear chat',
      message: `Clear ${label}? This cannot be undone.`,
      confirmLabel: 'Clear chat',
      variant: 'danger',
      action: async () => {
        const r = await this.comms.clearChat(this.chatMode, this.privateRecipientId ?? undefined);
        if (r?.success) {
          this.messages = [];
          this.lastMessageId = 0;
        } else {
          this.sendError = r?.message ?? 'Failed to clear chat';
        }
      },
    });
  }
  private openConfirm(opts: {
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'primary' | 'danger';
    action: () => Promise<void>;
  }): void {
    this.confirmTitle = opts.title;
    this.confirmMessage = opts.message;
    this.confirmLabel = opts.confirmLabel;
    this.confirmVariant = opts.variant;
    this.confirmAction = opts.action;
    this.confirmOpen = true;
  }
  async onConfirmAccepted(): Promise<void> {
    const action = this.confirmAction;
    this.confirmOpen = false;
    this.confirmAction = null;
    if (action) await action();
  }
  onConfirmCancelled(): void {
    this.confirmOpen = false;
    this.confirmAction = null;
  }
  avatarForUser(user?: PosChatUser | null): string {
    const pic = user?.profilePicture?.trim();
    return pic || this.defaultAvatar;
  }
  avatarForMessage(msg: PosChatMessage): string {
    const pic = msg.senderProfilePicture?.trim();
    return pic || this.defaultAvatar;
  }
  formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  }
  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = this.defaultAvatar;
  }
  private scrollMessagesToBottom(): void {
    setTimeout(() => {
      const el = this.messagesBoxRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
