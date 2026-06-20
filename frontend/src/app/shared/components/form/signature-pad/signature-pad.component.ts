import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import SignaturePad from 'signature_pad';

@Component({
  selector: 'app-signature-pad',
  standalone: true,
  template: `
    <div class="rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
      @if (label) {
        <p class="px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">{{ label }}</p>
      }
      <canvas #canvas class="w-full bg-white dark:bg-gray-900 cursor-crosshair" [style.height.px]="height"></canvas>
      <div class="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50">
        <span class="text-xs text-gray-400 dark:text-gray-500">Sign above</span>
        <button type="button" (click)="clear()" class="text-xs text-error-500 hover:text-error-700">Clear</button>
      </div>
    </div>
  `,
})
export class SignaturePadComponent implements AfterViewInit, OnDestroy {
  @Input() label = 'Customer Signature';
  @Input() height = 150;
  @Output() signatureChange = new EventEmitter<string | null>();

  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private pad!: SignaturePad;
  private resizeObserver?: ResizeObserver;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.pad = new SignaturePad(canvas, {
      backgroundColor: 'rgb(255, 255, 255)',
      penColor: 'rgb(0, 0, 0)',
    });

    this.pad.addEventListener('endStroke', () => {
      this.signatureChange.emit(this.pad.toDataURL());
    });

    // Resize canvas to match container width
    this.resizeCanvas();
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(canvas.parentElement!);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.pad?.off();
  }

  clear(): void {
    this.pad.clear();
    this.signatureChange.emit(null);
  }

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.offsetWidth;
    canvas.width = width * ratio;
    canvas.height = this.height * ratio;
    canvas.getContext('2d')!.scale(ratio, ratio);
    canvas.style.width = width + 'px';
    canvas.style.height = this.height + 'px';
    this.pad.clear();
  }
}
