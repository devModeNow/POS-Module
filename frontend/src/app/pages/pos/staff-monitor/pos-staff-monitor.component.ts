import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { PosService } from '../../../shared/services/pos.service';
import { ActionBusyService } from '../../../shared/services/action-busy.service';
import { PosPageHeaderComponent } from '../shared/pos-page-header.component';

@Component({
  selector: 'app-pos-staff-monitor',
  standalone: true,
  imports: [CommonModule, PosPageHeaderComponent],
  templateUrl: './pos-staff-monitor.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosStaffMonitorComponent implements OnInit {
  loading = false;
  error = '';
  staff: Array<{ userId: number; username: string; fullname: string | null; roleName: string | null; lastSeen: string }> = [];
  lastUpdatedLabel = '';

  constructor(
    private readonly pos: PosService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  ngOnInit(): void { void this.load(); }

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
}
