import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  PosCashDrawerOpenOn,
  PosCommunicationsService,
  PosPrinterConnectionType,
  PosReceiptTemplateElement,
} from '../../../services/pos-communications.service';
import { PosReceiptPrintService, ReceiptPrintContext } from '../../../services/pos-receipt-print.service';
import { alignFromTemplateX, parsePaymentPreviewParts } from '../../../services/pos-receipt-spacing';
import { PosUsbPrinterService } from '../../../services/pos-usb-printer.service';
import { PosPrintHubService } from '../../../services/pos-printhub.service';
import { PosReceiptTemplateEditorComponent } from '../pos-receipt-template-editor/pos-receipt-template-editor.component';
import { OrgService } from '../../../services/org.service';
import { RbacService } from '../../../services/rbac.service';

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'failed';

@Component({
  selector: 'app-pos-printer-settings-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, PosReceiptTemplateEditorComponent],
  templateUrl: './pos-printer-settings-panel.component.html',
  styles: `
    .receipt-preview-canvas {
      background: repeating-linear-gradient(0deg, #fafafa, #fafafa 12px, #f3f4f6 12px, #f3f4f6 13px);
    }
    .payment-preview {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
      font-family: 'Courier New', Courier, monospace;
    }
    .payment-preview .payment-amount { text-align: right; white-space: nowrap; }
  `,
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

  connectionType: PosPrinterConnectionType = 'printhub';
  printerHost = '';
  printerPort = '9100';
  usbVendorId = '';
  usbProductId = '';
  usbProductName = '';
  btDeviceId = '';
  btDeviceName = '';
  cashDrawerEnabled = false;
  cashDrawerOpenOn: PosCashDrawerOpenOn = 'before_receipt';
  connectionStatus: ConnectionStatus = 'idle';
  connectionMessage = '';

  readonly printerOptions = [
    'System Default',
    'EPSON TM-T88',
    'EPSON TM-T20',
    'Star TSP100',
    'Custom / Network Printer',
  ];

  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly receiptPrint: PosReceiptPrintService,
    private readonly usbPrinter: PosUsbPrinterService,
    private readonly printHub: PosPrintHubService,
    private readonly org: OrgService,
    private readonly rbac: RbacService,
  ) {}

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
      const orgName = String(this.org.getContext().name ?? '').trim();
      this.businessName = String(item['businessName'] ?? '').trim() || orgName;
      this.businessAddress = String(item['businessAddress'] ?? '');
      this.logoUrl = (item['businessLogoLight'] as string) || (item['businessLogoDark'] as string) || null;
      this.templateElements = this.receiptPrint.resolveTemplateElements(String(item['posReceiptTemplateJson'] ?? ''));
      const rawType = String(item['posPrinterConnectionType'] ?? 'printhub') as PosPrinterConnectionType;
      this.connectionType =
        rawType === 'bluetooth' || rawType === 'mharmal' || !rawType ? 'printhub' : rawType;
      this.printerHost = String(item['posPrinterHost'] ?? '');
      this.printerPort = String(item['posPrinterPort'] ?? '9100');
      this.usbVendorId = String(item['posPrinterUsbVendorId'] ?? '');
      this.usbProductId = String(item['posPrinterUsbProductId'] ?? '');
      this.usbProductName = String(item['posPrinterUsbProductName'] ?? '');
      this.btDeviceId = String(item['posPrinterBtDeviceId'] ?? '');
      this.btDeviceName = String(item['posPrinterBtDeviceName'] ?? '');
      this.cashDrawerEnabled = String(item['posCashDrawerEnabled'] ?? 'false').toLowerCase() === 'true';
      const openOn = String(item['posCashDrawerOpenOn'] ?? 'before_receipt').trim() as PosCashDrawerOpenOn;
      this.cashDrawerOpenOn =
        openOn === 'after_receipt' || openOn === 'manual_only' ? openOn : 'before_receipt';
      await this.restoreSavedConnection();
    } catch {
      this.error = 'Failed to load printer settings.';
      this.connectionStatus = 'idle';
      this.connectionMessage = '';
    } finally {
      this.loading = false;
    }
  }

  private async restoreSavedConnection(): Promise<void> {
    this.connectionStatus = 'idle';
    this.connectionMessage = '';

    if (this.connectionType === 'browser') {
      this.connectionStatus = 'connected';
      this.connectionMessage = 'Using browser print dialog.';
      return;
    }

    if (this.connectionType === 'network' && this.printerHost.trim()) {
      this.connectionStatus = 'testing';
      try {
        const r = await this.comms.testPrinterConnection(
          this.printerHost.trim(),
          Number(this.printerPort) || 9100,
        );
        this.connectionStatus = r?.success ? 'connected' : 'failed';
        this.connectionMessage = r?.success
          ? `Connected to ${this.printerHost}:${this.printerPort || 9100}`
          : (r?.message ?? 'Saved network printer unreachable.');
      } catch {
        this.connectionStatus = 'failed';
        this.connectionMessage = 'Saved network printer unreachable.';
      }
      return;
    }

    if (this.connectionType === 'usb' && this.usbVendorId && this.usbProductId) {
      this.connectionStatus = 'testing';
      this.connectionMessage = 'Reconnecting saved USB printer…';
      const info = await this.usbPrinter.restoreConnection(this.usbVendorId, this.usbProductId);
      if (info) {
        this.usbProductName = info.productName || this.usbProductName;
        this.connectionStatus = 'connected';
        this.connectionMessage = `Reconnected to ${this.usbProductName || 'USB printer'}.`;
      } else {
        this.connectionStatus = 'failed';
        this.connectionMessage = 'Saved USB printer not found. Plug it in or select it again.';
      }
      return;
    }

    if (this.connectionType === 'printhub') {
      if (this.printHub.isConnected()) {
        this.btDeviceName = this.printHub.getDeviceLabel();
        this.connectionStatus = 'connected';
        this.connectionMessage = `Connected to ${this.btDeviceName}.`;
      } else {
        this.connectionStatus = 'testing';
        this.connectionMessage = 'Connecting to Bluetooth printer…';
        const r = await this.printHub.autoConnect(this.paperWidth);
        if (r.success) {
          this.btDeviceName = this.printHub.getDeviceLabel();
          this.connectionStatus = 'connected';
          this.connectionMessage = `Connected to ${this.btDeviceName}.`;
        } else {
          this.connectionStatus = 'idle';
          this.connectionMessage =
            'Printer will reconnect automatically if previously paired. Otherwise click Connect PrintHub once.';
        }
      }
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    this.error = '';
    try {
      try {
        localStorage.setItem('pos.printerConnectionType', this.connectionType);
      } catch {
        /* ignore */
      }

      // Body limit is 10mb — keep template images (only strip absurdly large ones).
      const templateForSave = this.templateElements.map((el) => {
        if (
          el.type === 'image' &&
          typeof el.content === 'string' &&
          el.content.startsWith('data:') &&
          el.content.length > 2_500_000
        ) {
          return { ...el, content: '' };
        }
        if (el.type === 'text') {
          const align =
            el.align === 'left' || el.align === 'center' || el.align === 'right'
              ? el.align
              : alignFromTemplateX(el.x);
          return { ...el, align };
        }
        return { ...el };
      });

      const r = await this.comms.savePrinterSettings({
        posPrinterName: this.printerName,
        posReceiptPaperWidth: this.paperWidth,
        posReceiptShowLogo: this.showLogo,
        posReceiptFooterText: this.footerText,
        posReceiptTemplateJson: JSON.stringify(templateForSave),
        posPrinterConnectionType: this.connectionType,
        posPrinterHost: this.printerHost,
        posPrinterPort: this.printerPort,
        posPrinterUsbVendorId: this.usbVendorId,
        posPrinterUsbProductId: this.usbProductId,
        posPrinterUsbProductName: this.usbProductName,
        posPrinterBtDeviceId: this.btDeviceId,
        posPrinterBtDeviceName: this.btDeviceName,
        posCashDrawerEnabled: this.cashDrawerEnabled,
        posCashDrawerOpenOn: this.cashDrawerOpenOn,
      });
      if (!r?.success) {
        this.error = r?.message ?? 'Failed to save printer settings.';
        return;
      }
      const saved = r.item ?? {};
      this.connectionType =
        (String(saved['posPrinterConnectionType'] ?? this.connectionType) as PosPrinterConnectionType) ||
        this.connectionType;
      this.templateElements = this.receiptPrint.resolveTemplateElements(
        String(saved['posReceiptTemplateJson'] ?? JSON.stringify(templateForSave)),
      );
      this.showLogo = String(saved['posReceiptShowLogo'] ?? this.showLogo).toLowerCase() !== 'false';
      this.cashDrawerEnabled = String(saved['posCashDrawerEnabled'] ?? this.cashDrawerEnabled).toLowerCase() === 'true';
      const openOn = String(saved['posCashDrawerOpenOn'] ?? this.cashDrawerOpenOn).trim() as PosCashDrawerOpenOn;
      this.cashDrawerOpenOn =
        openOn === 'after_receipt' || openOn === 'manual_only' ? openOn : 'before_receipt';
      if (this.connectionStatus !== 'connected') {
        await this.restoreSavedConnection();
      } else if (!this.connectionMessage) {
        this.connectionMessage = 'Printer settings saved. Connection kept active.';
      }
      this.saved.emit();
    } catch {
      this.error = 'Failed to save printer settings.';
    } finally {
      this.saving = false;
    }
  }

  printPreview(): void {
    const orgName = String(this.org.getContext().name ?? '').trim();
    const cashierName = this.rbac.getDisplayName()?.trim() || 'Cashier';
    const ctx: ReceiptPrintContext = {
      businessName: (this.businessName || '').trim() || orgName || 'Store',
      businessAddress: this.businessAddress,
      footer: this.footerText || 'Thank you!',
      logoUrl: this.logoUrl,
      showLogo: this.showLogo,
      paperWidth: this.paperWidth,
      itemsText: '2x pack - Sample item A .... ₱100.00\n1x pc - Long product name trunc... .... ₱200.00',
      total: '₱300.00',
      amountPaid: '₱500.00',
      change: '₱200.00',
      paymentMethod: 'Cash',
      cashier: cashierName,
      saleDate: new Date().toLocaleString('en-PH'),
    };
    const elements = this.templateElements.length
      ? this.templateElements
      : this.receiptPrint.defaultTemplateElements();

    if (this.connectionType === 'printhub') {
      void this.receiptPrint
        .printViaConnection(elements, ctx, this.paperWidth, { connectionType: 'printhub' })
        .then((r) => {
          if (!r.success) {
            this.connectionStatus = 'failed';
            this.connectionMessage = r.message ?? 'Print via PrintHub failed.';
          } else {
            this.btDeviceName = this.printHub.getDeviceLabel();
            this.connectionStatus = 'connected';
            this.connectionMessage = 'Test receipt sent via PrintHub.';
          }
        });
      return;
    }

    if (this.connectionType === 'network' || this.connectionType === 'usb') {
      void this.receiptPrint.printViaConnection(elements, ctx, this.paperWidth, {
        connectionType: this.connectionType,
        host: this.printerHost,
        port: Number(this.printerPort) || 9100,
        usbVendorId: this.usbVendorId,
        usbProductId: this.usbProductId,
      });
      return;
    }

    this.receiptPrint.printFromSettings(elements, ctx, this.paperWidth);
  }

  async testCashDrawer(): Promise<void> {
    if (!this.cashDrawerEnabled) return;
    const connectionType =
      this.connectionType === 'bluetooth' || this.connectionType === 'mharmal' ? 'printhub' : this.connectionType;
    const r = await this.receiptPrint.openCashDrawer(
      {
        connectionType,
        host: this.printerHost,
        port: Number(this.printerPort) || 9100,
        usbVendorId: this.usbVendorId,
        usbProductId: this.usbProductId,
        btDeviceId: this.btDeviceId,
      },
      this.paperWidth,
    );
    if (!r.success) {
      this.error = r.message ?? 'Cash drawer pulse failed.';
    } else {
      this.error = '';
      this.connectionMessage = 'Cash drawer pulse sent.';
    }
  }

  get usbSupported(): boolean {
    return this.usbPrinter.isSupported();
  }

  get printHubSupported(): boolean {
    return this.printHub.isSupported();
  }

  get connectionStatusLabel(): string {
    switch (this.connectionStatus) {
      case 'testing': return 'Testing…';
      case 'connected': return 'Connected';
      case 'failed': return 'Not connected';
      default: return this.connectionType === 'browser' ? 'Using browser print dialog' : 'Not tested yet';
    }
  }

  get connectionStatusClass(): string {
    switch (this.connectionStatus) {
      case 'testing': return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300';
      case 'connected': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
      case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    }
  }

  onConnectionTypeChange(): void {
    this.connectionStatus = 'idle';
    this.connectionMessage = '';
    if (this.connectionType === 'network' && (!this.printerPort.trim() || this.printerPort === '22300')) {
      this.printerPort = '9100';
    }
  }

  async testConnection(): Promise<void> {
    if (!this.printerHost.trim()) {
      this.connectionStatus = 'failed';
      this.connectionMessage = 'Enter a host/IP address first.';
      return;
    }
    this.connectionStatus = 'testing';
    this.connectionMessage = '';
    try {
      const r = await this.comms.testPrinterConnection(this.printerHost.trim(), Number(this.printerPort) || 9100);
      this.connectionStatus = r?.success ? 'connected' : 'failed';
      this.connectionMessage = r?.message ?? (r?.success ? 'Connected.' : 'Could not connect.');
    } catch {
      this.connectionStatus = 'failed';
      this.connectionMessage = 'Failed to reach the printer.';
    }
  }

  async selectUsbPrinter(): Promise<void> {
    if (!this.usbSupported) {
      this.connectionStatus = 'failed';
      this.connectionMessage = 'Not supported in this browser. Use Chrome or Edge.';
      return;
    }
    const info = await this.usbPrinter.requestDevice();
    if (!info) {
      this.connectionMessage = 'No USB printer selected.';
      return;
    }
    this.usbVendorId = info.vendorId;
    this.usbProductId = info.productId;
    this.usbProductName = info.productName;
    this.connectionStatus = 'connected';
    this.connectionMessage = `Selected ${info.productName}.`;
  }

  async connectPrintHub(): Promise<void> {
    if (!this.printHubSupported) {
      this.connectionStatus = 'failed';
      this.connectionMessage = 'Not supported in this browser. Use Chrome or Edge on HTTPS/localhost.';
      return;
    }
    this.connectionStatus = 'testing';
    this.connectionMessage = 'Waiting for Bluetooth device (PrintHub)…';
    const r = await this.printHub.connect(this.paperWidth, 'bluetooth', { forcePicker: true });
    if (!r.success) {
      this.connectionStatus = 'failed';
      this.connectionMessage = r.message ?? 'PrintHub connection failed or was cancelled.';
      return;
    }
    this.connectionType = 'printhub';
    try {
      localStorage.setItem('pos.printerConnectionType', 'printhub');
    } catch {
      /* ignore */
    }
    this.btDeviceName = r.deviceName || this.printHub.getDeviceLabel();
    this.btDeviceId = 'printhub-session';
    this.connectionStatus = 'connected';
    this.connectionMessage = `${r.message ?? 'Connected.'} Click Save, then complete a sale — no browser print dialog.`;
  }

  get previewWidthClass(): string {
    return this.paperWidth === '58mm' ? 'max-w-[220px]' : 'max-w-[300px]';
  }

  get previewElements(): PosReceiptTemplateElement[] {
    return this.templateElements.length
      ? this.templateElements
      : this.receiptPrint.defaultTemplateElements();
  }

  elementStyle(el: PosReceiptTemplateElement): Record<string, string> {
    return this.comms.templateElementStyle(el);
  }

  paymentPreviewParts(el: PosReceiptTemplateElement): { label: string; amount: string } | null {
    return parsePaymentPreviewParts(el.content, this.previewText(el));
  }

  previewText(el: PosReceiptTemplateElement): string {
    const orgName = String(this.org.getContext().name ?? '').trim();
    return this.receiptPrint.renderTemplateText(el.content, {
      businessName: (this.businessName || '').trim() || orgName || 'Store',
      businessAddress: this.businessAddress,
      footer: this.footerText,
      itemsText: '2x pack - Sample item A .... ₱100.00\n1x pc - Long product name trunc... .... ₱200.00',
      total: '₱300.00',
      amountPaid: '₱500.00',
      change: '₱200.00',
      paymentMethod: 'Cash',
      cashier: this.rbac.getDisplayName()?.trim() || 'Cashier',
      saleDate: new Date().toLocaleString('en-PH'),
    });
  }
}
