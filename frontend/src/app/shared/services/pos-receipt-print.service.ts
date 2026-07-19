import { Injectable } from '@angular/core';
import {
  PosCommunicationsService,
  PosPrinterConnectionType,
  PosReceiptTemplateElement,
} from './pos-communications.service';
import { PosService } from './pos.service';
import { PosUsbPrinterService } from './pos-usb-printer.service';
import { PosBluetoothPrinterService } from './pos-bluetooth-printer.service';
import { PosPrintHubService } from './pos-printhub.service';
import { PosMharmalPrinterService, MHARMAL_DEFAULT_PORT } from './pos-mharmal-printer.service';

export type ReceiptPrintContext = {
  businessName?: string;
  businessAddress?: string;
  footer?: string;
  logoUrl?: string | null;
  showLogo?: boolean;
  paperWidth?: string;
  itemsText?: string;
  total?: string;
  amountPaid?: string;
  change?: string;
  paymentMethod?: string;
  cashier?: string;
  saleDate?: string;
};

export type PosPrinterConnection = {
  connectionType: PosPrinterConnectionType;
  host?: string;
  port?: number;
  usbVendorId?: string;
  usbProductId?: string;
  btDeviceId?: string;
};

@Injectable({ providedIn: 'root' })
export class PosReceiptPrintService {
  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly pos: PosService,
    private readonly usbPrinter: PosUsbPrinterService,
    private readonly bluetoothPrinter: PosBluetoothPrinterService,
    private readonly printHub: PosPrintHubService,
    private readonly mharmalPrinter: PosMharmalPrinterService,
  ) {}

  defaultTemplateElements(): PosReceiptTemplateElement[] {
    return [
      { id: 'hdr', type: 'text', content: '{{businessName}}', x: 50, y: 8, fontSize: 14, align: 'center', bold: true },
      { id: 'addr', type: 'text', content: '{{businessAddress}}', x: 50, y: 18, fontSize: 10, align: 'center' },
      { id: 'meta', type: 'text', content: '{{saleDate}}\n{{cashier}} · {{paymentMethod}}', x: 50, y: 26, fontSize: 9, align: 'center' },
      { id: 'items', type: 'text', content: '{{items}}', x: 5, y: 35, fontSize: 11, align: 'left' },
      { id: 'total', type: 'text', content: 'Total: {{total}}', x: 5, y: 72, fontSize: 12, align: 'left', bold: true },
      { id: 'paid', type: 'text', content: 'Paid: {{amountPaid}}\nChange: {{change}}', x: 5, y: 80, fontSize: 11, align: 'left' },
      { id: 'footer', type: 'text', content: '{{footer}}', x: 50, y: 92, fontSize: 10, align: 'center' },
    ];
  }

  resolveTemplateElements(json: string | null | undefined): PosReceiptTemplateElement[] {
    const parsed = this.comms.parseTemplate(json);
    return parsed.length ? parsed : this.defaultTemplateElements();
  }

  formatItemsLines(
    items: Array<{ productName: string; variantName: string; quantitySold: number; unitType: string; totalAmount: number }>,
  ): string {
    return items
      .map((item) => {
        const name = item.variantName || item.productName;
        const qty = `${item.quantitySold}${item.unitType ? ' ' + item.unitType : ''}`;
        return `${name} x${qty} .... ₱${item.totalAmount.toFixed(2)}`;
      })
      .join('\n');
  }

  renderTemplateText(content: string, ctx: ReceiptPrintContext): string {
    return content
      .replace(/\{\{businessName\}\}/g, ctx.businessName || 'Store')
      .replace(/\{\{businessAddress\}\}/g, ctx.businessAddress || '')
      .replace(/\{\{items\}\}/g, ctx.itemsText || '')
      .replace(/\{\{total\}\}/g, ctx.total || '₱0.00')
      .replace(/\{\{amountPaid\}\}/g, ctx.amountPaid || '₱0.00')
      .replace(/\{\{change\}\}/g, ctx.change || '₱0.00')
      .replace(/\{\{footer\}\}/g, ctx.footer || 'Thank you!')
      .replace(/\{\{paymentMethod\}\}/g, ctx.paymentMethod || '')
      .replace(/\{\{cashier\}\}/g, ctx.cashier || '')
      .replace(/\{\{saleDate\}\}/g, ctx.saleDate || '');
  }

  elementStyle(el: PosReceiptTemplateElement): Record<string, string> {
    return this.comms.templateElementStyle(el);
  }

  buildReceiptHtml(
    elements: PosReceiptTemplateElement[],
    ctx: ReceiptPrintContext,
    paperWidth = '80mm',
  ): string {
    const widthMm = paperWidth === '58mm' ? '58mm' : '80mm';
    const widthPx = paperWidth === '58mm' ? 220 : 302;
    const logo = ctx.showLogo !== false && ctx.logoUrl
      ? `<div class="block center"><img class="logo" src="${this.escapeAttr(ctx.logoUrl)}" alt="" /></div>`
      : '';

    // Flow layout (top → bottom) so printed height hugs content instead of a fixed blank page.
    const sorted = [...elements].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    const body = sorted
      .map((el) => {
        const align = el.align ?? 'left';
        const fontSize = el.fontSize ?? 12;
        const weight = el.bold ? '700' : '400';
        if (el.type === 'image') {
          const w = Math.min(100, Math.max(20, el.width ?? 40));
          return `<div class="block ${align}"><img src="${this.escapeAttr(el.content)}" alt="" style="width:${w}%;max-width:100%;height:auto;" /></div>`;
        }
        const text = this.escapeHtml(this.renderTemplateText(el.content, ctx)).replace(/\n/g, '<br/>');
        return `<div class="block ${align}" style="font-size:${fontSize}px;font-weight:${weight};">${text}</div>`;
      })
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
<style>
  @page {
    size: ${widthMm} auto;
    margin: 0;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: ${widthMm};
    height: auto !important;
    background: #fff;
    color: #111;
    font-family: "Courier New", Courier, monospace;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt {
    width: ${widthPx}px;
    max-width: 100%;
    margin: 0;
    padding: 2mm 3mm 4mm;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible;
  }
  .block {
    display: block;
    width: 100%;
    margin: 0 0 4px;
    line-height: 1.25;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .block.left { text-align: left; }
  .block.center { text-align: center; }
  .block.right { text-align: right; }
  .logo {
    max-width: 60%;
    max-height: 48px;
    height: auto;
    display: inline-block;
  }
  @media print {
    html, body {
      width: ${widthMm} !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .receipt {
      width: 100% !important;
      margin: 0 !important;
      page-break-inside: avoid;
      page-break-after: avoid;
      page-break-before: avoid;
    }
  }
</style></head><body>
  <div class="receipt">${logo}${body}</div>
  <script>
    window.onload = function () {
      window.focus();
      setTimeout(function () { window.print(); }, 50);
    };
  <\/script>
</body></html>`;
  }

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapeAttr(value: string): string {
    return this.escapeHtml(value).replace(/'/g, '&#39;');
  }

  buildReceiptText(ctx: ReceiptPrintContext): string {
    const rule = '--------------------------------';
    const lines: string[] = [ctx.businessName || 'Store'];
    if (ctx.businessAddress) lines.push(ctx.businessAddress);
    lines.push(rule);
    if (ctx.saleDate) lines.push(ctx.saleDate);
    const metaLine = [ctx.cashier, ctx.paymentMethod].filter(Boolean).join(' · ');
    if (metaLine) lines.push(metaLine);
    lines.push(rule);
    if (ctx.itemsText) lines.push(ctx.itemsText);
    lines.push(rule);
    lines.push(`Total: ${ctx.total ?? '₱0.00'}`);
    if (ctx.amountPaid) lines.push(`Paid: ${ctx.amountPaid}`);
    if (ctx.change) lines.push(`Change: ${ctx.change}`);
    lines.push(rule);
    lines.push(ctx.footer || 'Thank you!');
    return lines.join('\n');
  }

  /**
   * Prints a receipt using the configured connection type.
   * Only the "browser" type opens the system print dialog — other types must not fall back to it.
   */
  async printViaConnection(
    elements: PosReceiptTemplateElement[],
    ctx: ReceiptPrintContext,
    paperWidth: string,
    connection: PosPrinterConnection,
  ): Promise<{ success: boolean; message?: string; usedFallback?: boolean }> {
    if (connection.connectionType === 'network' && connection.host) {
      const text = this.buildReceiptText(ctx);
      const r = await this.comms.printRawToNetworkPrinter(connection.host, connection.port || 9100, text);
      if (r?.success) return { success: true };
      return { success: false, message: r?.message ?? 'Network printer unavailable.' };
    }

    if (connection.connectionType === 'usb' && connection.usbVendorId && connection.usbProductId) {
      const text = this.buildReceiptText(ctx);
      const r = await this.usbPrinter.printText(connection.usbVendorId, connection.usbProductId, text);
      if (r.success) return { success: true };
      return { success: false, message: r.message ?? 'USB printer unavailable.' };
    }

    if (connection.connectionType === 'bluetooth' && connection.btDeviceId) {
      const text = this.buildReceiptText(ctx);
      const r = await this.bluetoothPrinter.printText(connection.btDeviceId, text);
      if (r.success) return { success: true };
      return { success: false, message: r.message ?? 'Bluetooth printer unavailable.' };
    }

    if (connection.connectionType === 'printhub') {
      const r = await this.printHub.printReceipt(ctx, paperWidth);
      if (r.success) return { success: true };
      return { success: false, message: r.message ?? 'PrintHub printer unavailable.' };
    }

    if (connection.connectionType === 'mharmal') {
      const text = this.buildReceiptText(ctx);
      const host = connection.host?.trim() || '127.0.0.1';
      const port = connection.port && connection.port > 0 ? connection.port : MHARMAL_DEFAULT_PORT;
      const r = await this.mharmalPrinter.printText(text, host, port, paperWidth);
      if (r.success) return { success: true, message: r.message };
      return { success: false, message: r.message ?? 'Mharmal Printer unavailable.' };
    }

    // Explicit browser / unknown → system print dialog
    this.printFromSettings(elements, ctx, paperWidth);
    return { success: true };
  }

  openPrintWindow(html: string): void {
    const width = 420;
    // Short popup — actual print height is driven by receipt content / @page size
    const win = window.open('', '_blank', `width=${width},height=640`);
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  printFromSettings(
    elements: PosReceiptTemplateElement[],
    ctx: ReceiptPrintContext,
    paperWidth = '80mm',
  ): void {
    const html = this.buildReceiptHtml(elements, ctx, paperWidth);
    this.openPrintWindow(html);
  }

  async printSaleReceipt(
    saleId: number,
  ): Promise<{ success: boolean; message?: string; connectionType?: PosPrinterConnectionType }> {
    const [settingsRes, saleRes] = await Promise.all([
      this.comms.getPrinterSettings(),
      this.pos.getTransactionDetail(saleId),
    ]);
    if (!saleRes?.success || !saleRes.data) {
      return { success: false, message: 'Sale details unavailable for printing.' };
    }
    const item = settingsRes?.item ?? {};
    const sale = saleRes.data;
    const elements = this.resolveTemplateElements(String(item['posReceiptTemplateJson'] ?? ''));
    const paperWidth = String(item['posReceiptPaperWidth'] ?? '80mm');
    const ctx: ReceiptPrintContext = {
      businessName: String(item['businessName'] ?? ''),
      businessAddress: String(item['businessAddress'] ?? ''),
      footer: String(item['posReceiptFooterText'] ?? 'Thank you!'),
      logoUrl: (item['businessLogoLight'] as string) || (item['businessLogoDark'] as string) || null,
      showLogo: String(item['posReceiptShowLogo'] ?? 'true').toLowerCase() !== 'false',
      paperWidth,
      itemsText: this.formatItemsLines(sale.items ?? []),
      total: `₱${Number(sale.totalAmount).toFixed(2)}`,
      amountPaid: sale.amountPaid != null ? `₱${Number(sale.amountPaid).toFixed(2)}` : '',
      change: sale.changeAmount != null ? `₱${Number(sale.changeAmount).toFixed(2)}` : '₱0.00',
      paymentMethod: sale.paymentMethod,
      cashier: sale.cashier,
      saleDate: new Date(sale.createdAt || sale.saleDate).toLocaleString('en-PH'),
    };
    const savedType = (item['posPrinterConnectionType'] as PosPrinterConnectionType) || 'browser';
    // Prefer a live PrintHub session / local preference over a stale "browser" DB value
    // (common when printer-settings save previously failed with entity-too-large).
    const connectionType = this.resolveConnectionType(savedType);
    const rawPort = Number(item['posPrinterPort']);
    const defaultPort = connectionType === 'mharmal' ? MHARMAL_DEFAULT_PORT : 9100;
    const connection: PosPrinterConnection = {
      connectionType,
      host: String(item['posPrinterHost'] ?? (connectionType === 'mharmal' ? '127.0.0.1' : '')),
      port: Number.isFinite(rawPort) && rawPort > 0 ? rawPort : defaultPort,
      usbVendorId: String(item['posPrinterUsbVendorId'] ?? ''),
      usbProductId: String(item['posPrinterUsbProductId'] ?? ''),
      btDeviceId: String(item['posPrinterBtDeviceId'] ?? ''),
    };
    const result = await this.printViaConnection(elements, ctx, paperWidth, connection);
    return { ...result, connectionType };
  }

  /**
   * If PrintHub is connected this session, always use it (no browser dialog).
   * Also honor a local preference when DB still says "browser".
   */
  private resolveConnectionType(savedType: PosPrinterConnectionType): PosPrinterConnectionType {
    if (this.printHub.isConnected()) {
      return 'printhub';
    }
    try {
      const preferred = localStorage.getItem('pos.printerConnectionType');
      if (preferred === 'printhub' || preferred === 'bluetooth' || preferred === 'usb' || preferred === 'network' || preferred === 'mharmal' || preferred === 'browser') {
        // Prefer saved DB value when it is already a non-browser type.
        if (savedType && savedType !== 'browser') return savedType;
        return preferred as PosPrinterConnectionType;
      }
    } catch {
      /* ignore */
    }
    return savedType || 'browser';
  }

  /** Silently restore Bluetooth/USB/Mharmal printer connection after page load. */
  async restoreSavedPrinterConnection(): Promise<void> {
    try {
      const r = await this.comms.getPrinterSettings();
      const item = r?.item ?? {};
      const type = String(item['posPrinterConnectionType'] ?? 'browser');
      if (type === 'bluetooth') {
        const id = String(item['posPrinterBtDeviceId'] ?? '');
        if (id) await this.bluetoothPrinter.restoreConnection(id);
      } else if (type === 'usb') {
        const vendor = String(item['posPrinterUsbVendorId'] ?? '');
        const product = String(item['posPrinterUsbProductId'] ?? '');
        if (vendor && product) await this.usbPrinter.restoreConnection(vendor, product);
      } else if (type === 'mharmal') {
        const host = String(item['posPrinterHost'] ?? '127.0.0.1') || '127.0.0.1';
        const port = Number(item['posPrinterPort']) || MHARMAL_DEFAULT_PORT;
        await this.mharmalPrinter.restoreConnection(host, port);
      }
    } catch {
      /* ignore — user can re-select in settings */
    }
  }
}
