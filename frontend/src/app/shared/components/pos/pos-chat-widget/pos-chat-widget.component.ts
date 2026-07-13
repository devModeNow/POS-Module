import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  PosChatMessage,
  PosChatUser,
  PosCommunicationsService,
} from '../../../services/pos-communications.service';
import { PosChatUiService } from '../../../services/pos-chat-ui.service';

const HIDDEN_KEY = 'pos-chat-hidden';

@Component({
  selector: 'app-pos-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-chat-widget.component.html',
})
export class PosChatWidgetComponent implements OnInit, OnDestroy {
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
  users: PosChatUser[] = [];
  messages: PosChatMessage[] = [];
  lastMessageId = 0;
  private pollTimer?: ReturnType<typeof setInterval>;
  private usersPollTimer?: ReturnType<typeof setInterval>;
  private openSub?: Subscription;

  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly chatUi: PosChatUiService,
  ) {}

  ngOnInit(): void {
    this.hidden = localStorage.getItem(HIDDEN_KEY) === '1';
    void this.loadUsers();
    void this.reloadThread(true);
    this.pollTimer = setInterval(() => void this.reloadThread(false), 5000);
    this.usersPollTimer = setInterval(() => {
      if (this.expanded && this.chatMode === 'private') void this.loadUsers();
    }, 30000);
    this.openSub = this.chatUi.openRequests$.subscribe((req) => this.handleOpenRequest(req));
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.usersPollTimer) clearInterval(this.usersPollTimer);
    this.openSub?.unsubscribe();
  }

  get threadTitle(): string {
    if (this.chatMode === 'private' && this.privateRecipientName) {
      return `Private · ${this.privateRecipientName}`;
    }
    if (this.chatMode === 'private') {
      return 'Private Chat';
    }
    return 'Team Chat';
  }

  handleOpenRequest(req: { mode: 'team' | 'private'; userId?: number; userName?: string }): void {
    this.hidden = false;
    this.expanded = true;
    localStorage.removeItem(HIDDEN_KEY);
    if (req.mode === 'private') {
      this.chatMode = 'private';
      void this.loadUsers();
      if (req.userId) {
        this.privateRecipientId = req.userId;
        this.privateRecipientName = req.userName ?? this.users.find((u) => u.id === req.userId)?.name ?? 'User';
      }
    } else {
      this.chatMode = 'team';
      this.privateRecipientId = null;
      this.privateRecipientName = '';
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
      this.users = r?.success ? (r.data ?? []) : [];
      if (this.privateRecipientId) {
        const user = this.users.find((u) => u.id === this.privateRecipientId);
        if (user) this.privateRecipientName = user.name;
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
    void this.loadUsers();
    this.onModeChange();
  }

  onModeChange(): void {
    this.sendError = '';
    if (this.chatMode === 'team') {
      this.privateRecipientId = null;
      this.privateRecipientName = '';
    }
    void this.reloadThread(true);
  }

  selectPrivateUser(user: PosChatUser): void {
    this.privateRecipientId = user.id;
    this.privateRecipientName = user.name;
    this.sendError = '';
    void this.reloadThread(true);
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
        this.messages = [...this.messages, ...batch];
      }
      if (this.messages.length) {
        this.lastMessageId = this.messages[this.messages.length - 1].id;
      }
    } finally {
      if (full) this.loading = false;
    }
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.sending) return;
    if (this.chatMode === 'private' && !this.privateRecipientId) {
      this.sendError = 'Select a user to message';
      return;
    }
    this.sending = true;
    this.sendError = '';
    try {
      const r = await this.comms.sendChatMessage(text, this.chatMode, this.privateRecipientId ?? undefined);
      if (r?.success) {
        this.draft = '';
        await this.reloadThread(true);
      } else {
        this.sendError = r?.message ?? 'Failed to send message';
      }
    } finally {
      this.sending = false;
    }
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  }
}
