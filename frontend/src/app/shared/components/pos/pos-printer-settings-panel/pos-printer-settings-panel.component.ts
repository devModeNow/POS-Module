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
    private readonly bluetoothPrinter: PosBluetoothPrinterService,
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
      this.usbVendorId = String(item['posPrinterUsbVendorId'] ?? '');
      this.usbProductId = String(item['posPrinterUsbProductId'] ?? '');
      this.usbProductName = String(item['posPrinterUsbProductName'] ?? '');
      this.btDeviceId = String(item['posPrinterBtDeviceId'] ?? '');
      this.btDeviceName = String(item['posPrinterBtDeviceName'] ?? '');
      this.connectionStatus = 'idle';
      this.connectionMessage = '';
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
    this.receiptPrint.printFromSettings(elements, ctx, this.paperWidth);
  }

  get usbSupported(): boolean {
    return this.usbPrinter.isSupported();
  }

  get bluetoothSupported(): boolean {
    return this.bluetoothPrinter.isSupported();
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
