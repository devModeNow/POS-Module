import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export type PosKeyboardMode = 'text' | 'numeric';

@Component({
  selector: 'app-pos-onscreen-keyboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pos-onscreen-keyboard.component.html',
  styles: `
    :host { display: block; }
    .key-btn { touch-action: manipulation; user-select: none; }
  `,
})
export class PosOnscreenKeyboardComponent {
  @Input() mode: PosKeyboardMode = 'text';
  @Input() visible = false;
  @Output() keyPress = new EventEmitter<string>();
  @Output() backspace = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
  @Output() done = new EventEmitter<void>();

  readonly textRows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', ' ', '.'],
  ];

  readonly numericRows = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    ['.', '0', '00'],
  ];

  get rows(): string[][] {
    return this.mode === 'numeric' ? this.numericRows : this.textRows;
  }

  press(key: string): void {
    this.keyPress.emit(key);
  }

  onBackspace(): void {
    this.backspace.emit();
  }

  onClear(): void {
    this.clear.emit();
  }

  onClose(): void {
    this.close.emit();
  }

  onDone(): void {
    this.done.emit();
  }
}
