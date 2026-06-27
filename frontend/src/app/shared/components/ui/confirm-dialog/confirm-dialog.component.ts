import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOpen) {
      <div class="fixed inset-0 z-[100001] flex items-center justify-center bg-gray-900/50 p-4" role="alertdialog">
        <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">{{ message }}</p>
          <div class="mt-6 flex gap-3">
            <button type="button" (click)="cancel.emit()"
              class="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300">
              {{ cancelLabel }}
            </button>
            <button type="button" (click)="confirm.emit()"
              class="flex-1 rounded-xl py-3 text-sm font-bold text-white"
              [class.bg-emerald-600]="variant === 'primary'"
              [class.hover:bg-emerald-700]="variant === 'primary'"
              [class.bg-red-600]="variant === 'danger'"
              [class.hover:bg-red-700]="variant === 'danger'">
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  @Input() isOpen = false;
  @Input() title = 'Confirm';
  @Input() message = 'Are you sure?';
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() variant: 'primary' | 'danger' = 'primary';
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
}
