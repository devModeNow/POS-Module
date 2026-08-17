import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * Detects USB/HID barcode scanners (keyboard wedge).
 * Scanners type the code very quickly and usually finish with Enter.
 */
@Injectable({ providedIn: 'root' })
export class PosBarcodeScannerService {
  private readonly scanned = new Subject<string>();
  private buffer = '';
  private lastKeyAt = 0;
  private scanLikely = false;
  private attachCount = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxGapMs = 40;
  private readonly idleFlushMs = 70;
  private readonly minLength = 4;
  private readonly listener = (event: KeyboardEvent) => this.onKeyDown(event);

  readonly scans$: Observable<string> = this.scanned.asObservable();

  constructor(private readonly zone: NgZone) {}

  start(): void {
    this.attachCount += 1;
    if (this.attachCount !== 1) return;
    this.zone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.listener, true);
    });
  }

  stop(): void {
    this.attachCount = Math.max(0, this.attachCount - 1);
    if (this.attachCount > 0) return;
    document.removeEventListener('keydown', this.listener, true);
    this.reset();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey) {
      this.reset();
      return;
    }
    if (event.key === 'Shift') return;

    const now = performance.now();
    const gap = now - this.lastKeyAt;
    this.lastKeyAt = now;

    if (event.key === 'Enter' || event.key === 'Tab') {
      if (this.scanLikely && this.buffer.length >= this.minLength) {
        event.preventDefault();
        event.stopPropagation();
        this.emit(this.buffer);
      }
      this.reset();
      return;
    }

    if (event.key.length !== 1) {
      this.reset();
      return;
    }

    if (!this.isBarcodeChar(event.key)) {
      this.reset();
      return;
    }

    if (!this.buffer.length || gap > this.maxGapMs) {
      this.buffer = event.key;
      this.scanLikely = false;
      this.scheduleIdleFlush();
      return;
    }

    this.scanLikely = true;
    this.buffer += event.key;
    event.preventDefault();
    event.stopPropagation();
    this.scheduleIdleFlush();
  }

  private isBarcodeChar(key: string): boolean {
    return /^[A-Za-z0-9._-]$/.test(key);
  }

  private scheduleIdleFlush(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.scanLikely && this.buffer.length >= this.minLength) {
        this.emit(this.buffer);
      }
      this.reset();
    }, this.idleFlushMs);
  }

  private emit(code: string): void {
    const trimmed = code.trim();
    if (!trimmed) return;
    this.stripFromActiveInput(trimmed);
    this.zone.run(() => this.scanned.next(trimmed));
  }

  private stripFromActiveInput(code: string): void {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
    const value = el.value;
    if (!value) return;
    let next = value;
    if (value === code || value.endsWith(code)) {
      next = value.slice(0, Math.max(0, value.length - code.length));
    } else if (value === code.charAt(0)) {
      next = '';
    } else if (code.length > 1 && value.endsWith(code.slice(1))) {
      next = value.slice(0, Math.max(0, value.length - (code.length - 1)));
    }
    if (next === value) return;
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private reset(): void {
    this.buffer = '';
    this.scanLikely = false;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
