import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EmbeddedViewRef,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Renderer2,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { PosCommunicationsService, PosNotification } from '../../../services/pos-communications.service';
import { PosChatUiService } from '../../../services/pos-chat-ui.service';

@Component({
  selector: 'app-pos-notifications-bell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pos-notifications-bell.component.html',
  styles: `
    :host {
      display: inline-flex;
      position: relative;
      z-index: 140;
    }
    :host ::ng-deep .pos-notifications-panel {
      position: fixed;
      z-index: 160;
      max-height: min(420px, calc(100vh - 5rem));
    }
  `,
})
export class PosNotificationsBellComponent implements OnInit, OnDestroy {
  @Input() compact = false;

  @ViewChild('toggleBtn') toggleBtnRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('panelTpl') panelTpl?: TemplateRef<unknown>;

  isOpen = false;
  loading = false;
  markingAll = false;
  unreadCount = 0;
  items: PosNotification[] = [];
  readFilter: 'all' | 'unread' | 'read' = 'all';
  categoryFilter: 'all' | 'message' | 'sale' | 'other' = 'all';

  readonly readFilterOptions: Array<{ value: 'all' | 'unread' | 'read'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'unread', label: 'Unread' },
    { value: 'read', label: 'Read' },
  ];

  readonly categoryOptions: Array<{ value: 'all' | 'message' | 'sale' | 'other'; label: string }> = [
    { value: 'all', label: 'All types' },
    { value: 'message', label: 'Messages' },
    { value: 'sale', label: 'Sales' },
    { value: 'other', label: 'Other' },
  ];

  private pollTimer?: ReturnType<typeof setInterval>;
  private panelView?: EmbeddedViewRef<unknown>;
  private panelEl: HTMLElement | null = null;

  get filteredItems(): PosNotification[] {
    return this.items.filter((item) => {
      if (this.readFilter === 'unread' && item.isRead) return false;
      if (this.readFilter === 'read' && !item.isRead) return false;
      if (this.categoryFilter === 'message' && item.type !== 'message') return false;
      if (this.categoryFilter === 'sale' && item.type !== 'sale') return false;
      if (this.categoryFilter === 'other' && (item.type === 'message' || item.type === 'sale')) return false;
      return true;
    });
  }

  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly chatUi: PosChatUiService,
    private readonly router: Router,
    private readonly renderer: Renderer2,
    private readonly vcr: ViewContainerRef,
  ) {}

  ngOnInit(): void {
    void this.refreshUnread();
    this.pollTimer = setInterval(() => void this.refreshUnread(), 5000);
    window.addEventListener('focus', this.onWindowFocus);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    window.removeEventListener('focus', this.onWindowFocus);
    document.removeEventListener('mousedown', this.onDocumentClick, true);
    this.close();
  }

  private readonly onWindowFocus = () => {
    void this.refreshUnread();
  };

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onViewportChange(): void {
    if (this.isOpen) this.syncPanelPosition();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) this.close();
  }

  toggle(event: Event): void {
    event.stopPropagation();
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  open(): void {
    if (!this.panelTpl || !this.toggleBtnRef) return;
    this.isOpen = true;

    this.panelView = this.vcr.createEmbeddedView(this.panelTpl);
    this.panelView.detectChanges();
    for (const node of this.panelView.rootNodes) {
      this.renderer.appendChild(document.body, node);
    }
    this.panelEl = this.resolvePanelElement();

    requestAnimationFrame(() => {
      this.syncPanelPosition();
      requestAnimationFrame(() => this.syncPanelPosition());
    });

    setTimeout(() => document.addEventListener('mousedown', this.onDocumentClick, true), 0);

    void this.loadItems();
  }

  close(): void {
    this.isOpen = false;
    this.panelEl = null;
    document.removeEventListener('mousedown', this.onDocumentClick, true);

    if (this.panelView) {
      this.panelView.destroy();
      this.panelView = undefined;
    }
  }

  private readonly onDocumentClick = (event: MouseEvent): void => {
    if (!this.isOpen) return;
    const target = event.target as Node;
    if (this.panelEl?.contains(target)) return;
    if (this.toggleBtnRef?.nativeElement.contains(target)) return;
    this.close();
  };

  private resolvePanelElement(): HTMLElement | null {
    if (!this.panelView) return null;
    for (const node of this.panelView.rootNodes) {
      if (node instanceof HTMLElement) {
        return node.classList.contains('pos-notifications-panel')
          ? node
          : (node.querySelector('.pos-notifications-panel') as HTMLElement | null) ?? node;
      }
    }
    return null;
  }

  private syncPanelPosition(): void {
    const btn = this.toggleBtnRef?.nativeElement;
    const panel = this.panelEl ?? this.resolvePanelElement();
    if (!btn || !panel) return;

    this.panelEl = panel;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    const panelWidth = Math.min(this.compact ? 320 : 360, window.innerWidth - margin * 2);

    // Align panel's right edge with the bell's right edge.
    let left = rect.right - panelWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));

    let top = rect.bottom + margin;
    const maxHeight = Math.min(420, window.innerHeight - top - margin);

    // Flip above the bell if there isn't enough room below.
    if (maxHeight < 160 && rect.top > 220) {
      top = Math.max(margin, rect.top - Math.min(420, rect.top - margin * 2));
    }

    const heightBudget = Math.min(420, window.innerHeight - top - margin);

    panel.style.position = 'fixed';
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.width = `${panelWidth}px`;
    panel.style.maxHeight = `${heightBudget}px`;
    panel.style.zIndex = '160';
  }

  async refreshUnread(): Promise<void> {
    const r = await this.comms.unreadNotificationCount();
    this.unreadCount = r?.success ? (r.count ?? 0) : 0;
  }

  async loadItems(): Promise<void> {
    this.loading = true;
    try {
      const r = await this.comms.listNotifications();
      this.items = r?.success ? (r.data ?? []) : [];
    } finally {
      this.loading = false;
      this.panelView?.detectChanges();
      this.syncPanelPosition();
    }
  }

  async markAllRead(): Promise<void> {
    if (this.unreadCount === 0 || this.markingAll) return;
    this.markingAll = true;
    try {
      await this.comms.markNotificationsRead();
      await Promise.all([this.refreshUnread(), this.loadItems()]);
    } finally {
      this.markingAll = false;
      this.panelView?.detectChanges();
    }
  }

  async onItemClick(item: PosNotification): Promise<void> {
    await this.comms.markNotificationsRead(item.id);
    this.unreadCount = Math.max(0, this.unreadCount - (item.isRead ? 0 : 1));
    item.isRead = true;
    this.close();

    if (item.type === 'message' || item.referenceType === 'chat') {
      if (item.referenceId) {
        this.chatUi.openPrivateChat(item.referenceId);
      } else {
        this.chatUi.openTeamChat();
      }
      return;
    }

    if (item.type === 'sale' && item.referenceId) {
      void this.router.navigate(['/users/pos-sales', item.referenceId]);
    }
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  typeIcon(type: string): string {
    return type === 'sale' ? '💰' : type === 'message' ? '💬' : '🔔';
  }

  categoryLabel(type: string): string {
    if (type === 'sale') return 'Sale';
    if (type === 'message') return 'Message';
    return 'System';
  }

  setReadFilter(value: 'all' | 'unread' | 'read'): void {
    this.readFilter = value;
    this.panelView?.detectChanges();
  }

  setCategoryFilter(value: 'all' | 'message' | 'sale' | 'other'): void {
    this.categoryFilter = value;
    this.panelView?.detectChanges();
  }

  isClickable(item: PosNotification): boolean {
    return item.type === 'message' || item.type === 'sale' || item.referenceType === 'chat';
  }
}
