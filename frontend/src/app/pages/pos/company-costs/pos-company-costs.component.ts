import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogComponent } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import { NotificationService } from '../../../shared/services/notification.service';
import { PosService } from '../../../shared/services/pos.service';
import { PosPageHeaderComponent } from '../shared/pos-page-header.component';

type CostRow = {
  id: number;
  amount: number;
  reason: string;
  receiptImage: string | null;
  createdBy: number | null;
  createdByName: string;
  createdAt: string;
};

@Component({
  selector: 'app-pos-company-costs',
  standalone: true,
  imports: [CommonModule, FormsModule, PosPageHeaderComponent, ConfirmDialogComponent],
  templateUrl: './pos-company-costs.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosCompanyCostsComponent implements OnInit {
  @ViewChild('receiptFileInput') receiptFileInput?: ElementRef<HTMLInputElement>;

  from = '';
  to = '';
  loading = false;
  saving = false;
  error = '';
  items: CostRow[] = [];
  totalAmount = 0;

  amount: number | null = null;
  reason = '';
  receiptImage: string | null = null;

  cameraAvailable = false;
  cameraOpen = false;
  private mediaStream: MediaStream | null = null;
  @ViewChild('cameraVideo') cameraVideo?: ElementRef<HTMLVideoElement>;

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  private confirmAction: (() => void) | null = null;
  deleteTarget: CostRow | null = null;

  constructor(
    private readonly pos: PosService,
    private readonly notify: NotificationService,
  ) {}

  ngOnInit(): void {
    const today = this.todayManila();
    this.from = today;
    this.to = today;
    void this.detectCamera();
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const r = await this.pos.getCompanyCosts({
        from: this.from || undefined,
        to: this.to || undefined,
      });
      if (!r.success || !r.data) {
        this.error = r.message ?? 'Failed to load company costs.';
        this.items = [];
        this.totalAmount = 0;
        return;
      }
      this.items = r.data.items ?? [];
      this.totalAmount = r.data.totalAmount ?? 0;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load company costs.';
      this.items = [];
      this.totalAmount = 0;
    } finally {
      this.loading = false;
    }
  }

  requestCreate(): void {
    const amount = Math.max(0, Number(this.amount) || 0);
    const reason = this.reason.trim();
    if (!(amount > 0) || !reason) {
      this.notify.warning('Missing fields', 'Amount and reason are required.');
      return;
    }
    this.openConfirm(
      'Add company cost?',
      `Record ₱${amount.toFixed(2)} for “${reason}”? This will be deducted from owner sales visibility.`,
      () => void this.create(),
    );
  }

  async create(): Promise<void> {
    this.saving = true;
    try {
      const r = await this.pos.createCompanyCost({
        amount: Number(this.amount) || 0,
        reason: this.reason.trim(),
        receiptImage: this.receiptImage,
      });
      if (!r.success) {
        this.notify.error('Save failed', r.message ?? 'Unable to save cost.');
        return;
      }
      this.notify.success('Saved', 'Company cost recorded.');
      this.amount = null;
      this.reason = '';
      this.receiptImage = null;
      if (this.receiptFileInput?.nativeElement) this.receiptFileInput.nativeElement.value = '';
      await this.load();
    } catch (e) {
      this.notify.error('Save failed', e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      this.saving = false;
    }
  }

  requestDelete(row: CostRow): void {
    this.deleteTarget = row;
    this.openConfirm(
      'Delete cost entry?',
      `Remove ₱${row.amount.toFixed(2)} — ${row.reason}?`,
      () => void this.delete(),
    );
  }

  async delete(): Promise<void> {
    const row = this.deleteTarget;
    this.deleteTarget = null;
    if (!row) return;
    try {
      const r = await this.pos.deleteCompanyCost(row.id);
      if (!r.success) {
        this.notify.error('Delete failed', r.message ?? 'Unable to delete.');
        return;
      }
      this.notify.success('Deleted', 'Cost entry removed.');
      await this.load();
    } catch (e) {
      this.notify.error('Delete failed', e instanceof Error ? e.message : 'Unable to delete.');
    }
  }

  onReceiptFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.notify.warning('Invalid file', 'Please choose an image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.receiptImage = String(reader.result ?? '') || null;
    };
    reader.readAsDataURL(file);
  }

  clearReceipt(): void {
    this.receiptImage = null;
    if (this.receiptFileInput?.nativeElement) this.receiptFileInput.nativeElement.value = '';
  }

  async detectCamera(): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
        this.cameraAvailable = false;
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameraAvailable = devices.some((d) => d.kind === 'videoinput');
    } catch {
      this.cameraAvailable = false;
    }
  }

  async openCamera(): Promise<void> {
    if (!this.cameraAvailable) return;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      this.cameraOpen = true;
      setTimeout(() => {
        const video = this.cameraVideo?.nativeElement;
        if (video && this.mediaStream) {
          video.srcObject = this.mediaStream;
          void video.play();
        }
      }, 50);
    } catch {
      this.notify.error('Camera', 'Could not open the device camera.');
      this.cameraAvailable = false;
      this.closeCamera();
    }
  }

  capturePhoto(): void {
    const video = this.cameraVideo?.nativeElement;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.receiptImage = canvas.toDataURL('image/jpeg', 0.82);
    this.closeCamera();
  }

  closeCamera(): void {
    this.cameraOpen = false;
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
  }

  private todayManila(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private openConfirm(title: string, message: string, action: () => void): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.confirmAction = action;
    this.confirmOpen = true;
  }

  onConfirm(): void {
    this.confirmOpen = false;
    const action = this.confirmAction;
    this.confirmAction = null;
    action?.();
  }

  onCancelConfirm(): void {
    this.confirmOpen = false;
    this.confirmAction = null;
    this.deleteTarget = null;
  }
}
