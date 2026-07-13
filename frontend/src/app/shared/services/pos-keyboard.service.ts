import { Injectable, signal } from '@angular/core';

/** Shared POS on-screen keyboard visibility for modal padding. */
@Injectable({ providedIn: 'root' })
export class PosKeyboardService {
  readonly visible = signal(false);
  /** Compact keyboard height used for modal bottom padding. */
  readonly heightPx = 152;

  setVisible(value: boolean): void {
    this.visible.set(value);
  }
}
