import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PosService } from '../../../shared/services/pos.service';
import { RbacService } from '../../../shared/services/rbac.service';
import { OrgService } from '../../../shared/services/org.service';
import { BusinessSettingsService } from '../../../shared/services/business-settings.service';

@Component({
  selector: 'app-pos-my-sales',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './pos-my-sales.component.html',
})
export class PosMySalesComponent implements OnInit {
  from = '';
  to = '';
  loading = false;
  error = '';
  summary: { totalSales: number; transactionCount: number; totalDiscount: number } | null = null;
  recent: Array<{ id: number; saleDate: string; totalAmount: number; paymentStatus: string }> = [];
  cashierName = '';
  companyName = '';
  lastUpdatedAt: Date | null = null;

  get periodLabel(): string {
    if (!this.from && !this.to) return 'All recorded sales';
    if (this.from && this.to) {
      return `Showing sales from ${this.formatDisplayDate(this.from)} to ${this.formatDisplayDate(this.to)}`;
    }
    return this.from
      ? `From ${this.formatDisplayDate(this.from)}`
      : `Through ${this.formatDisplayDate(this.to)}`;
  }

  get lastUpdatedLabel(): string {
    if (!this.lastUpdatedAt) return '';
    return this.lastUpdatedAt.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  constructor(
    private readonly pos: PosService,
    private readonly rbac: RbacService,
    private readonly orgService: OrgService,
    private readonly businessSettings: BusinessSettingsService,
  ) {}

  ngOnInit(): void {
    this.cashierName = this.rbac.getDisplayName();
    this.companyName = this.orgService.getContext().name ?? 'POS';
    void this.loadCompanyName();
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    this.from = start.toISOString().slice(0, 10);
    this.to = today.toISOString().slice(0, 10);
    void this.load();
  }

  async loadCompanyName(): Promise<void> {
    try {
      const profile = await this.businessSettings.getBusinessProfile();
      this.companyName = String(profile?.businessName ?? this.companyName).trim() || this.companyName;
    } catch {
      /* keep org name */
    }
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const r = await this.pos.getMySales(this.from || undefined, this.to || undefined) as {
        success: boolean;
        data?: {
          summary: { totalSales: number; transactionCount: number; totalDiscount: number };
          recent: Array<{ id: number; saleDate: string; totalAmount: number; paymentStatus: string }>;
        };
        message?: string;
      };
      if (!r.success || !r.data) {
        this.error = r.message ?? 'Failed to load sales.';
        this.summary = null;
        this.recent = [];
        return;
      }
      this.summary = r.data.summary;
      this.recent = r.data.recent ?? [];
      this.lastUpdatedAt = new Date();
    } finally {
      this.loading = false;
    }
  }

  statusLabel(status: string): string {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (normalized === 'settled') return 'Settled';
    if (normalized === 'floating') return 'Floating';
    return status || '—';
  }

  statusClass(status: string): string {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (normalized === 'settled') {
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300';
    }
    if (normalized === 'floating') {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
    }
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  }

  private formatDisplayDate(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
