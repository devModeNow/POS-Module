import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PosReceiptTemplateElement } from '../../../services/pos-communications.service';

@Component({
  selector: 'app-pos-receipt-template-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-receipt-template-editor.component.html',
  styles: `
    .template-canvas {
      position: relative;
      height: 320px;
      overflow: hidden;
      background: repeating-linear-gradient(0deg, #fafafa, #fafafa 12px, #f3f4f6 12px, #f3f4f6 13px);
    }
    .template-element {
      position: absolute;
      cursor: move;
      user-select: none;
      padding: 2px 4px;
      border: 1px dashed transparent;
      max-width: 92%;
    }
    .template-element.selected { border-color: #465fff; background: rgba(70,95,255,0.08); z-index: 20; }
    .template-element img { display: block; max-width: 100%; pointer-events: none; }
  `,
})
export class PosReceiptTemplateEditorComponent {
  @Input() paperWidth = '80mm';
  @Input() logoUrl: string | null = null;
  @Input() set elements(value: PosReceiptTemplateElement[]) {
    if (value?.length) {
      this._elements = value.map((e) => ({ ...e }));
    } else if (!this._elements.length) {
      this._elements = this.defaultElements();
    }
  }
  @Output() elementsChange = new EventEmitter<PosReceiptTemplateElement[]>();

  _elements: PosReceiptTemplateElement[] = [];
  selectedId: string | null = null;
  private draggingId: string | null = null;

  get canvasWidthClass(): string {
    return this.paperWidth === '58mm' ? 'max-w-[220px]' : 'max-w-[300px]';
  }

  defaultElements(): PosReceiptTemplateElement[] {
    return [
      { id: 'hdr', type: 'text', content: '{{businessName}}', x: 50, y: 8, fontSize: 14, align: 'center', bold: true },
      { id: 'addr', type: 'text', content: '{{businessAddress}}', x: 50, y: 18, fontSize: 10, align: 'center' },
      { id: 'items', type: 'text', content: '{{items}}', x: 5, y: 35, fontSize: 11, align: 'left' },
      { id: 'total', type: 'text', content: 'Total: {{total}}', x: 5, y: 75, fontSize: 12, align: 'left', bold: true },
      { id: 'footer', type: 'text', content: '{{footer}}', x: 50, y: 90, fontSize: 10, align: 'center' },
    ];
  }

  emitChange(): void {
    this.elementsChange.emit(this._elements.map((e) => ({ ...e })));
  }

  select(id: string): void {
    this.selectedId = id;
  }

  selectedElement(): PosReceiptTemplateElement | null {
    return this._elements.find((e) => e.id === this.selectedId) ?? null;
  }

  nextFreePosition(): { x: number; y: number } {
    const used = new Set(this._elements.map((e) => `${e.x},${e.y}`));
    for (let y = 10; y <= 90; y += 12) {
      for (const x of [50, 10, 30, 70]) {
        if (!used.has(`${x},${y}`)) return { x, y };
      }
    }
    return { x: 50, y: 50 };
  }

  addText(): void {
    const pos = this.nextFreePosition();
    const el: PosReceiptTemplateElement = {
      id: `t-${Date.now()}`,
      type: 'text',
      content: 'New text',
      x: pos.x,
      y: pos.y,
      fontSize: 12,
      align: 'center',
    };
    this._elements = [...this._elements, el];
    this.selectedId = el.id;
    this.emitChange();
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const pos = this.nextFreePosition();
      const el: PosReceiptTemplateElement = {
        id: `i-${Date.now()}`,
        type: 'image',
        content: String(reader.result ?? ''),
        x: pos.x,
        y: pos.y,
        width: 40,
      };
      this._elements = [...this._elements, el];
      this.selectedId = el.id;
      this.emitChange();
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  removeSelected(): void {
    if (!this.selectedId) return;
    this._elements = this._elements.filter((e) => e.id !== this.selectedId);
    this.selectedId = null;
    this.emitChange();
  }

  elementStyle(el: PosReceiptTemplateElement): Record<string, string> {
    const transforms: string[] = [];
    if (el.align === 'center') transforms.push('translateX(-50%)');
    else if (el.align === 'right') transforms.push('translateX(-100%)');
    return {
      left: `${el.x}%`,
      top: `${el.y}%`,
      transform: transforms.join(' ') || 'none',
      fontSize: `${el.fontSize ?? 12}px`,
      fontWeight: el.bold ? '700' : '400',
      textAlign: el.align ?? 'left',
      maxWidth: el.type === 'image' ? `${el.width ?? 40}%` : '90%',
      zIndex: this.selectedId === el.id ? '20' : '10',
    };
  }

  onElementPointerDown(event: PointerEvent, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedId = id;
    this.draggingId = id;
    const canvas = (event.currentTarget as HTMLElement).closest('.template-canvas') as HTMLElement;
    if (!canvas) return;

    const move = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      const el = this._elements.find((item) => item.id === this.draggingId);
      if (el) {
        el.x = Math.round(x * 10) / 10;
        el.y = Math.round(y * 10) / 10;
      }
    };

    const up = () => {
      this.draggingId = null;
      this.emitChange();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  previewContent(el: PosReceiptTemplateElement): string {
    return el.content
      .replace('{{businessName}}', 'Your Store')
      .replace('{{businessAddress}}', '123 Main St')
      .replace('{{items}}', 'Item A x1 .... ₱100\nItem B x2 .... ₱200')
      .replace('{{total}}', '₱300.00')
      .replace('{{footer}}', 'Thank you!');
  }
}
