import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
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

  search = '';
  actionFilter = '';
  roleFilter = '';
  currentPage = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];

  constructor(
    private readonly pos: PosService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  ngOnInit(): void { void this.load(); }

  get actionOptions(): string[] {
    return Array.from(new Set(this.logs.map((row) => row.action).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  get roleOptions(): string[] {
    return Array.from(
      new Set(
        this.logs
          .map((row) => this.roleLabel(row))
          .filter((role) => role !== '—'),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  get filteredLogs(): AuditRow[] {
    const q = this.search.trim().toLowerCase();
    return this.logs.filter((row) => {
      if (this.actionFilter && row.action !== this.actionFilter) return false;
      if (this.roleFilter && this.roleLabel(row) !== this.roleFilter) return false;
      if (!q) return true;
      const haystack = [
        row.username,
        row.action,
        row.entityType,
        row.entityId,
        this.roleLabel(row),
        this.detailSummary(row),
        row.createdAt,
      ]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(q);
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredLogs.length / this.pageSize));
  }

  get paginatedLogs(): AuditRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredLogs.slice(start, start + this.pageSize);
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  clearFilters(): void {
    this.search = '';
    this.actionFilter = '';
    this.roleFilter = '';
    this.currentPage = 1;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) this.currentPage = page;
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  prevPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
  }

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
        const r = await this.pos.getAuditTrail(500, 0);
        if (!r.success) {
          this.error = r.message ?? 'Failed to load audit trail.';
          return;
        }
        this.logs = (r.data ?? []) as AuditRow[];
        this.lastUpdatedLabel = new Date().toLocaleString();
        this.currentPage = 1;
      });
    } finally {
      this.loading = false;
    }
  }
}
