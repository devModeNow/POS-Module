import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PosCommunicationsService, PosReceiptTemplateElement } from '../../../services/pos-communications.service';
import { PosReceiptTemplateEditorComponent } from '../pos-receipt-template-editor/pos-receipt-template-editor.component';

@Component({
  selector: 'app-pos-printer-settings-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, PosReceiptTemplateEditorComponent],
  templateUrl: './pos-printer-settings-panel.component.html',
})
export class PosPrinterSettingsPanelComponent implements OnInit {
  @Input() embedded = false;
  @Output() saved = new EventEmitter<void>();

  loading = false;
  saving = false;
  error = '';

  printerName = '';
  paperWidth = '80mm';
  showLogo = true;
  footerText = '';
  businessName = '';
  businessAddress = '';
  logoUrl: string | null = null;
  templateElements: PosReceiptTemplateElement[] = [];

  readonly printerOptions = [
    'System Default',
    'EPSON TM-T88',
    'EPSON TM-T20',
    'Star TSP100',
    'Custom / Network Printer',
  ];

  constructor(private readonly comms: PosCommunicationsService) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const r = await this.comms.getPrinterSettings();
      const item = r?.item ?? {};
      this.printerName = String(item['posPrinterName'] ?? 'System Default');
      this.paperWidth = String(item['posReceiptPaperWidth'] ?? '80mm');
      this.showLogo = String(item['posReceiptShowLogo'] ?? 'true').toLowerCase() !== 'false';
      this.footerText = String(item['posReceiptFooterText'] ?? '');
      this.businessName = String(item['businessName'] ?? '');
      this.businessAddress = String(item['businessAddress'] ?? '');
      this.logoUrl = (item['businessLogoLight'] as string) || (item['businessLogoDark'] as string) || null;
      this.templateElements = this.comms.parseTemplate(String(item['posReceiptTemplateJson'] ?? ''));
    } catch {
      this.error = 'Failed to load printer settings.';
    } finally {
      this.loading = false;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    this.error = '';
    try {
      const r = await this.comms.savePrinterSettings({
        posPrinterName: this.printerName,
        posReceiptPaperWidth: this.paperWidth,
        posReceiptShowLogo: this.showLogo,
        posReceiptFooterText: this.footerText,
        posReceiptTemplateJson: JSON.stringify(this.templateElements),
      });
      if (!r?.success) {
        this.error = r?.message ?? 'Failed to save printer settings.';
        return;
      }
      this.saved.emit();
    } catch {
      this.error = 'Failed to save printer settings.';
    } finally {
      this.saving = false;
    }
  }

  printPreview(): void {
    window.print();
  }

  get previewWidthClass(): string {
    return this.paperWidth === '58mm' ? 'max-w-[220px]' : 'max-w-[300px]';
  }

  elementStyle(el: PosReceiptTemplateElement): Record<string, string> {
    return this.comms.templateElementStyle(el);
  }

  previewText(el: PosReceiptTemplateElement): string {
    return this.comms.previewTemplateText(el.content, {
      businessName: this.businessName,
      businessAddress: this.businessAddress,
      footer: this.footerText,
    });
  }
}
