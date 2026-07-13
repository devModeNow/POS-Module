import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { PosService } from '../../../shared/services/pos.service';
import type { PosSaleDetail } from '../../../shared/services/pos-communications.service';

@Component({
  selector: 'app-pos-sale-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, PageBreadcrumbComponent],
  templateUrl: './pos-sale-detail.component.html',
})
export class PosSaleDetailComponent implements OnInit {
  loading = true;
  error = '';
  detail: PosSaleDetail | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly pos: PosService,
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.error = 'Invalid sale reference.';
      this.loading = false;
      return;
    }
    void this.load(id);
  }

  async load(id: number): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const r = await this.pos.getTransactionDetail(id);
      if (!r?.success || !r.data) {
        this.error = r?.message ?? 'Sale not found.';
        this.detail = null;
        return;
      }
      this.detail = r.data;
    } catch {
      this.error = 'Failed to load sale details.';
    } finally {
      this.loading = false;
    }
  }

  formatMoney(value: number): string {
    return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  formatDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  }

  paymentStatusLabel(status: string): string {
    return status === 'floating' ? 'Floating' : 'Settled';
  }
}
