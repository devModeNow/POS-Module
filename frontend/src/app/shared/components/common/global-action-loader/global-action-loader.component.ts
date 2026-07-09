import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActionBusyService } from '../../../services/action-busy.service';

@Component({
  selector: 'app-global-action-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (busy.isBusy()) {
      <div class="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-1 overflow-hidden bg-brand-500/20">
        <div class="h-full w-1/3 animate-[loader-slide_1s_ease-in-out_infinite] bg-brand-500"></div>
      </div>
    }
  `,
  styles: [`
    @keyframes loader-slide {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
  `],
})
export class GlobalActionLoaderComponent {
  readonly busy = inject(ActionBusyService);
}
