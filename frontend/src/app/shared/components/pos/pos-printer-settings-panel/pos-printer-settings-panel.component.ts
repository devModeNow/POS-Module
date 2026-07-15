import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  PosCommunicationsService,
  PosPrinterConnectionType,
  PosReceiptTemplateElement,
} from '../../../services/pos-communications.service';
import { PosReceiptPrintService, ReceiptPrintContext } from '../../../services/pos-receipt-print.service';
import { PosUsbPrinterService } from '../../../services/pos-usb-printer.service';
import { PosBluetoothPrinterService } from '../../../services/pos-bluetooth-printer.service';
import {
  MHARMAL_DEFAULT_HOST,
  MHARMAL_DEFAULT_PORT,
  MharmalPayloadFormat,
  PosMharmalPrinterService,
} from '../../../services/pos-mharmal-printer.service';
import { PosReceiptTemplateEditorComponent } from '../pos-receipt-template-editor/pos-receipt-template-editor.component';

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'failed';

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

  connectionType: PosPrinterConnectionType = 'browser';
  printerHost = '';
  printerPort = '9100';
  usbVendorId = '';
  usbProductId = '';
  usbProductName = '';
  btDeviceId = '';
  btDeviceName = '';
  mharmalPayloadFormat: MharmalPayloadFormat = 'image-datauri';
  connectionStatus: ConnectionStatus = 'idle';
  connectionMessage = '';

  readonly printerOptions = [
    'System Default',
    'EPSON TM-T88',
    'EPSON TM-T20',
    'Star TSP100',
    'Custom / Network Printer',
  ];

  readonly mharmalPayloadOptions: Array<{ value: MharmalPayloadFormat; label: string }> = [
    { value: 'image-datauri', label: 'PNG image (data URI) — recommended' },
    { value: 'image-base64', label: 'PNG image (raw Base64)' },
    { value: 'image-binary', label: 'PNG image (binary frame)' },
    { value: 'escpos-binary', label: 'Raw ESC/POS bytes' },
    { value: 'json-image', label: 'JSON { type, data }' },
  ];

  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly receiptPrint: PosReceiptPrintService,
    private readonly usbPrinter: PosUsbPrinterService,
    private readonly bluetoothPrinter: PosBluetoothPrinterService,
    private readonly mharmalPrinter: PosMharmalPrinterService,
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
      this.businessName = String(item['businessName'] ?? '');
      this.businessAddress = String(item['businessAddress'] ?? '');
      this.logoUrl = (item['businessLogoLight'] as string) || (item['businessLogoDark'] as string) || null;
      this.templateElements = this.receiptPrint.resolveTemplateElements(String(item['posReceiptTemplateJson'] ?? ''));
      this.connectionType = (String(item['posPrinterConnectionType'] ?? 'browser') as PosPrinterConnectionType) || 'browser';
      this.printerHost = String(item['posPrinterHost'] ?? '');
      this.printerPort = String(item['posPrinterPort'] ?? '9100');
      if (this.connectionType === 'mharmal') {
        if (!this.printerHost.trim()) this.printerHost = MHARMAL_DEFAULT_HOST;
        if (!this.printerPort.trim() || this.printerPort === '9100') {
          this.printerPort = String(MHARMAL_DEFAULT_PORT);
        }
      }
      this.usbVendorId = String(item['posPrinterUsbVendorId'] ?? '');
      this.usbProductId = String(item['posPrinterUsbProductId'] ?? '');
      this.usbProductName = String(item['posPrinterUsbProductName'] ?? '');
      this.btDeviceId = String(item['posPrinterBtDeviceId'] ?? '');
      this.btDeviceName = String(item['posPrinterBtDeviceName'] ?? '');
      this.mharmalPayloadFormat = this.mharmalPrinter.getPayloadFormat();
      await this.restoreSavedConnection();
    } catch {
      this.error = 'Failed to load printer settings.';
      this.connectionStatus = 'idle';
      this.connectionMessage = '';
    } finally {
      this.loading = false;
    }
  }

  /** Keep previously saved printer linked after reload (no re-pair required). */
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

    if (this.connectionType === 'bluetooth' && this.btDeviceId) {
      this.connectionStatus = 'testing';
      this.connectionMessage = 'Reconnecting saved Bluetooth printer…';
      const info = await this.bluetoothPrinter.restoreConnection(this.btDeviceId);
      if (info) {
        this.btDeviceName = info.deviceName || this.btDeviceName;
        this.btDeviceId = info.deviceId;
        this.connectionStatus = 'connected';
        this.connectionMessage = `Reconnected to ${this.btDeviceName}.`;
      } else {
        this.connectionStatus = 'failed';
        this.connectionMessage =
          'Saved Bluetooth printer not in range or permission was reset. Select it again.';
      }
      return;
    }

    if (this.connectionType === 'mharmal') {
      this.connectionStatus = 'testing';
      this.connectionMessage = 'Connecting to Mharmal Printer…';
      const host = this.printerHost.trim() || MHARMAL_DEFAULT_HOST;
      const port = Number(this.printerPort) || MHARMAL_DEFAULT_PORT;
      const r = await this.mharmalPrinter.restoreConnection(host, port);
      this.connectionStatus = r.success ? 'connected' : 'failed';
      this.connectionMessage = r.message ?? (r.success ? 'Connected to Mharmal.' : 'Mharmal unreachable.');
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
        posPrinterConnectionType: this.connectionType,
        posPrinterHost: this.printerHost,
        posPrinterPort: this.printerPort,
        posPrinterUsbVendorId: this.usbVendorId,
        posPrinterUsbProductId: this.usbProductId,
        posPrinterUsbProductName: this.usbProductName,
        posPrinterBtDeviceId: this.btDeviceId,
        posPrinterBtDeviceName: this.btDeviceName,
      });
      if (!r?.success) {
        this.error = r?.message ?? 'Failed to save printer settings.';
        return;
      }
      // Keep connection active after save — do not reset to idle
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
    const ctx: ReceiptPrintContext = {
      businessName: this.businessName,
      businessAddress: this.businessAddress,
      footer: this.footerText || 'Thank you!',
      logoUrl: this.logoUrl,
      showLogo: this.showLogo,
      paperWidth: this.paperWidth,
      itemsText: 'Sample Item x1 pack .... ₱100.00\nSample Item 2 x2 .... ₱200.00',
      total: '₱300.00',
      amountPaid: '₱500.00',
      change: '₱200.00',
      paymentMethod: 'Cash',
      cashier: 'Cashier',
      saleDate: new Date().toLocaleString('en-PH'),
    };
    const elements = this.templateElements.length
      ? this.templateElements
      : this.receiptPrint.defaultTemplateElements();

    if (this.connectionType === 'mharmal') {
      const host = this.printerHost.trim() || MHARMAL_DEFAULT_HOST;
      const port = Number(this.printerPort) || MHARMAL_DEFAULT_PORT;
      this.mharmalPrinter.setPayloadFormat(this.mharmalPayloadFormat);
      void this.receiptPrint
        .printViaConnection(elements, ctx, this.paperWidth, {
          connectionType: 'mharmal',
          host,
          port,
        })
        .then((r) => {
          if (!r.success) {
            this.connectionStatus = 'failed';
            this.connectionMessage = r.message ?? 'Print via Mharmal failed.';
          } else {
            this.connectionStatus = 'connected';
            this.connectionMessage =
              r.message ??
              'Test receipt sent. If nothing prints, try another Payload format below.';
          }
        });
      return;
    }

    this.receiptPrint.printFromSettings(elements, ctx, this.paperWidth);
  }

  get usbSupported(): boolean {
    return this.usbPrinter.isSupported();
  }

  get bluetoothSupported(): boolean {
    return this.bluetoothPrinter.isSupported();
  }

  get mharmalSupported(): boolean {
    return this.mharmalPrinter.isSupported();
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
    if (this.connectionType === 'mharmal') {
      if (!this.printerHost.trim()) {
        this.printerHost = MHARMAL_DEFAULT_HOST;
      }
      if (!this.printerPort.trim() || this.printerPort === '9100') {
        this.printerPort = String(MHARMAL_DEFAULT_PORT);
      }
    } else if (this.connectionType === 'network') {
      if (this.printerPort === String(MHARMAL_DEFAULT_PORT)) {
        this.printerPort = '9100';
      }
      if (this.printerHost === MHARMAL_DEFAULT_HOST || this.printerHost === 'localhost') {
        this.printerHost = '';
      }
    }
  }

  async testConnection(): Promise<void> {
    if (this.connectionType === 'mharmal') {
      await this.testMharmalConnection();
      return;
    }

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

  onMharmalPayloadFormatChange(): void {
    this.mharmalPrinter.setPayloadFormat(this.mharmalPayloadFormat);
    this.connectionMessage = `Payload format set to ${this.mharmalPayloadFormat}. Try Print preview.`;
  }

  async testMharmalConnection(): Promise<void> {
    if (!this.mharmalSupported) {
      this.connectionStatus = 'failed';
      this.connectionMessage = 'WebSocket is not available in this browser.';
      return;
    }
    this.connectionStatus = 'testing';
    this.connectionMessage = 'Connecting to Mharmal Printer…';
    const host = this.printerHost.trim() || MHARMAL_DEFAULT_HOST;
    const port = Number(this.printerPort) || MHARMAL_DEFAULT_PORT;
    this.printerHost = host;
    this.printerPort = String(port);
    this.mharmalPrinter.setPayloadFormat(this.mharmalPayloadFormat);
    try {
      const r = await this.mharmalPrinter.testConnection(host, port);
      this.connectionStatus = r.success ? 'connected' : 'failed';
      this.connectionMessage = r.message ?? (r.success ? 'Connected.' : 'Could not connect.');
    } catch {
      this.connectionStatus = 'failed';
      this.connectionMessage = 'Failed to reach Mharmal Printer.';
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

  async selectBluetoothPrinter(): Promise<void> {
    if (!this.bluetoothSupported) {
      this.connectionStatus = 'failed';
      this.connectionMessage = 'Not supported in this browser. Use Chrome or Edge on HTTPS/localhost.';
      return;
    }
    this.connectionStatus = 'testing';
    this.connectionMessage = 'Waiting for Bluetooth device…';
    const info = await this.bluetoothPrinter.requestDevice();
    if (!info) {
      this.connectionStatus = 'failed';
      this.connectionMessage = 'No Bluetooth printer selected, or pairing was cancelled.';
      return;
    }
    this.btDeviceId = info.deviceId;
    this.btDeviceName = info.deviceName;
    this.connectionStatus = 'connected';
    this.connectionMessage = `Connected to ${info.deviceName}. Save settings to keep this printer.`;
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

  previewText(el: PosReceiptTemplateElement): string {
    return this.receiptPrint.renderTemplateText(el.content, {
      businessName: this.businessName,
      businessAddress: this.businessAddress,
      footer: this.footerText,
      itemsText: 'Sample Item x1 .... ₱100',
      total: '₱100.00',
      amountPaid: '₱200.00',
      change: '₱100.00',
      paymentMethod: 'Cash',
      cashier: 'Cashier',
      saleDate: new Date().toLocaleString('en-PH'),
    });
  }
}
