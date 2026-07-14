import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { PosService } from '../../../shared/services/pos.service';
import { ActionBusyService } from '../../../shared/services/action-busy.service';
import { PosChatUiService } from '../../../shared/services/pos-chat-ui.service';

@Component({
  selector: 'app-pos-staff-monitor',
  standalone: true,
  imports: [CommonModule, PageBreadcrumbComponent],
  templateUrl: './pos-staff-monitor.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosStaffMonitorComponent implements OnInit {
  loading = false;
  error = '';
  staff: Array<{ userId: number; username: string; fullname: string | null; roleName: string | null; lastSeen: string; profilePicture?: string | null }> = [];
  readonly defaultAvatar = '/images/user/faceless-avatar.svg';
  lastUpdatedLabel = '';

  constructor(
    private readonly pos: PosService,
    private readonly actionBusy: ActionBusyService,
    private readonly chatUi: PosChatUiService,
  ) {}

  ngOnInit(): void { void this.load(); }

  avatarUrl(row: { profilePicture?: string | null }): string {
    const pic = row.profilePicture?.trim();
    return pic || this.defaultAvatar;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      await this.actionBusy.run('staff-monitor-load', async () => {
        const r = await this.pos.getOnDutyStaff(30);
        if (!r.success) {
          this.error = r.message ?? 'Failed to load staff.';
          this.staff = [];
          return;
        }
        this.staff = (r.data ?? []) as typeof this.staff;
        this.lastUpdatedLabel = new Date().toLocaleString();
      });
    } finally {
      this.loading = false;
    }
  }

  messageUser(row: { userId: number; fullname: string | null; username: string }): void {
    const name = row.fullname?.trim() || row.username || 'User';
    this.chatUi.openPrivateChat(row.userId, name);
  }
}
