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

const HIDDEN_KEY = 'pos-chat-hidden';
const HEARTBEAT_MS = 2 * 60 * 1000;
const USERS_POLL_MS = 15 * 1000;



@Component({

  selector: 'app-pos-chat-widget',

  standalone: true,

  imports: [CommonModule, FormsModule],

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

  selectedImageFile: File | null = null;
  selectedImagePreview: string | null = null;
  lightboxUrl: string | null = null;



  @ViewChild('chatPanel') chatPanelRef?: ElementRef<HTMLElement>;

  @ViewChild('fabBtn') fabBtnRef?: ElementRef<HTMLButtonElement>;

  @ViewChild('messagesBox') messagesBoxRef?: ElementRef<HTMLElement>;

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;



  private pollTimer?: ReturnType<typeof setInterval>;

  private usersPollTimer?: ReturnType<typeof setInterval>;

  private heartbeatTimer?: ReturnType<typeof setInterval>;

  private openSub?: Subscription;



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

    this.pollTimer = setInterval(() => void this.reloadThread(false), 5000);

    this.usersPollTimer = setInterval(() => {

      if (this.expanded || this.privateRecipientId) void this.loadUsers();

    }, USERS_POLL_MS);

    this.openSub = this.chatUi.openRequests$.subscribe((req) => this.handleOpenRequest(req));

  }



  ngOnDestroy(): void {

    if (this.pollTimer) clearInterval(this.pollTimer);

    if (this.usersPollTimer) clearInterval(this.usersPollTimer);

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

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

      void this.loadUsers();

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
    if (this.lightboxUrl) return;
    if (!this.expanded || this.hidden) return;
    if (this.chatPanelRef?.nativeElement.contains(target)) return;
    if (this.fabBtnRef?.nativeElement.contains(target)) return;
    this.expanded = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
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

      void this.loadUsers();

      void this.reloadThread(true);

    }

  }



  async loadUsers(): Promise<void> {

    this.usersLoading = true;

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

      this.usersLoading = false;

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

    try {

      const r = await this.comms.listChatMessages(

        full ? 0 : this.lastMessageId,

        this.chatMode,

        this.privateRecipientId ?? undefined,

      );

      const batch = r?.success ? (r.data ?? []) : [];

      if (full) {

        this.messages = batch;

      } else if (batch.length) {

        const existingIds = new Set(this.messages.map((m) => m.id));

        const fresh = batch.filter((m) => !existingIds.has(m.id));

        if (fresh.length) {

          this.messages = [...this.messages, ...fresh];

        }

      }

      if (this.messages.length) {

        this.lastMessageId = this.messages[this.messages.length - 1].id;

      }

      this.scrollMessagesToBottom();

    } finally {

      if (full) this.loading = false;

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


