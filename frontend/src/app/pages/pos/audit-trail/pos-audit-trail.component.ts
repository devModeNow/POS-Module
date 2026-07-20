import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { PosService } from '../../../shared/services/pos.service';
import { ActionBusyService } from '../../../shared/services/action-busy.service';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';

type AuditRow = {
  id: number;
  orgId?: number | null;
  userId?: number | null;
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
  imports: [CommonModule, PageBreadcrumbComponent],
  templateUrl: './pos-audit-trail.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosAuditTrailComponent implements OnInit {
  @Input() embedded = false;
  loading = false;
  error = '';
  logs: AuditRow[] = [];
  lastUpdatedLabel = '';
  selectedLog: AuditRow | null = null;
  detailModalOpen = false;

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

  openDetail(row: AuditRow): void {
    this.selectedLog = row;
    this.detailModalOpen = true;
  }

  closeDetail(): void {
    this.detailModalOpen = false;
    this.selectedLog = null;
  }

  prettyDetails(row: AuditRow | null): string {
    if (!row?.details) return '—';
    try {
      return JSON.stringify(row.details, null, 2);
    } catch {
      return String(row.details);
    }
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
