import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { PosService } from '../../../shared/services/pos.service';
import { ActionBusyService } from '../../../shared/services/action-busy.service';
import { PosPageHeaderComponent } from '../shared/pos-page-header.component';

type AuditRow = {
  id: number;
  username: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

@Component({
  selector: 'app-pos-audit-trail',
  standalone: true,
  imports: [CommonModule, PosPageHeaderComponent],
  templateUrl: './pos-audit-trail.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosAuditTrailComponent implements OnInit {
  @Input() embedded = false;
  loading = false;
  error = '';
  logs: AuditRow[] = [];
  lastUpdatedLabel = '';

  constructor(
    private readonly pos: PosService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  ngOnInit(): void { void this.load(); }

  roleLabel(row: AuditRow): string {
    const role = row.details?.['roleName'];
    return typeof role === 'string' && role.trim() ? role : '—';
  }

  detailSummary(row: AuditRow): string {
    const d = row.details;
    if (!d) return '—';
    const parts: string[] = [];
    if (typeof d['method'] === 'string' && typeof d['path'] === 'string') {
      parts.push(`${d['method']} ${d['path']}`);
    }
    if (typeof d['reason'] === 'string' && d['reason'].trim()) {
      parts.push(`Reason: ${d['reason']}`);
    }
    return parts.length ? parts.join(' · ') : '—';
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      await this.actionBusy.run('audit-trail-load', async () => {
        const r = await this.pos.getAuditTrail(200, 0);
        if (!r.success) {
          this.error = r.message ?? 'Failed to load audit trail.';
          return;
        }
        this.logs = (r.data ?? []) as AuditRow[];
        this.lastUpdatedLabel = new Date().toLocaleString();
      });
    } finally {
      this.loading = false;
    }
  }
}
