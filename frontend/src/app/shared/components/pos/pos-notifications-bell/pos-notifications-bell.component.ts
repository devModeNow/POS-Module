import { CommonModule } from '@angular/common';
import {
  Component,
  EmbeddedViewRef,
  ElementRef,
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
import { RbacService } from '../../../services/rbac.service';

@Component({
  selector: 'app-pos-notifications-bell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pos-notifications-bell.component.html',
  styles: `:host { display: inline-flex; position: relative; z-index: 1; }`,
})
export class PosNotificationsBellComponent implements OnInit, OnDestroy {
  @Input() compact = false;

  @ViewChild('toggleBtn') toggleBtnRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('panelTpl') panelTpl?: TemplateRef<unknown>;

  isOpen = false;
  loading = false;
  unreadCount = 0;
  items: PosNotification[] = [];
  panelStyle: Record<string, string> = {};

  private pollTimer?: ReturnType<typeof setInterval>;
  private panelView?: EmbeddedViewRef<unknown>;
  private backdropEl: HTMLElement | null = null;

  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly chatUi: PosChatUiService,
    private readonly router: Router,
    private readonly rbac: RbacService,
    private readonly renderer: Renderer2,
    private readonly vcr: ViewContainerRef,
  ) {}

  get forAdmin(): boolean {
    return !this.rbac.isCashier();
  }

  ngOnInit(): void {
    void this.refreshUnread();
    this.pollTimer = setInterval(() => void this.refreshUnread(), 15000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.close();
  }

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
    this.syncPanelPosition();
    this.isOpen = true;

    this.backdropEl = this.renderer.createElement('div');
    this.renderer.addClass(this.backdropEl, 'fixed');
    this.renderer.addClass(this.backdropEl, 'inset-0');
    this.renderer.addClass(this.backdropEl, 'z-[55]');
    this.renderer.setAttribute(this.backdropEl, 'aria-hidden', 'true');
    this.backdropEl!.addEventListener('click', this.onBackdropClick);
    this.renderer.appendChild(document.body, this.backdropEl);

    this.panelView = this.vcr.createEmbeddedView(this.panelTpl);
    this.panelView.detectChanges();
    for (const node of this.panelView.rootNodes) {
      this.renderer.appendChild(document.body, node);
    }

    void this.loadItems();
  }

  close(): void {
    this.isOpen = false;
    this.panelStyle = {};

    if (this.panelView) {
      this.panelView.destroy();
      this.panelView = undefined;
    }

    if (this.backdropEl) {
      this.backdropEl.removeEventListener('click', this.onBackdropClick);
      this.renderer.removeChild(document.body, this.backdropEl);
      this.backdropEl = null;
    }
  }

  private readonly onBackdropClick = () => this.close();

  private syncPanelPosition(): void {
    const btn = this.toggleBtnRef?.nativeElement;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const panelWidth = Math.min(360, window.innerWidth - 16);
    const right = Math.max(8, window.innerWidth - rect.right);
    const top = Math.min(rect.bottom + 8, window.innerHeight - 80);
    this.panelStyle = {
      top: `${top}px`,
      right: `${right}px`,
      width: `${panelWidth}px`,
    };
    this.panelView?.detectChanges();
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

  isClickable(item: PosNotification): boolean {
    return item.type === 'message' || item.type === 'sale' || item.referenceType === 'chat';
  }
}
