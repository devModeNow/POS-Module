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
import { OrgService } from './org.service';
import {
  countTemplateBlockLines,
  templateLogoBlankLines,
  templateSpacingBlankLines,
} from './pos-receipt-spacing';

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

// Re-export spacing helpers for callers that already import this module.
export {
  countTemplateBlockLines,
  templateLogoBlankLines,
  templateSpacingBlankLines,
} from './pos-receipt-spacing';

@Injectable({ providedIn: 'root' })
export class PosReceiptPrintService {
  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly pos: PosService,
    private readonly usbPrinter: PosUsbPrinterService,
    private readonly bluetoothPrinter: PosBluetoothPrinterService,
    private readonly printHub: PosPrintHubService,
    private readonly mharmalPrinter: PosMharmalPrinterService,
    private readonly org: OrgService,
  ) {}

  defaultTemplateElements(): PosReceiptTemplateElement[] {
    return [
      { id: 'hdr', type: 'text', content: '{{businessName}}', x: 50, y: 6, fontSize: 14, align: 'center', bold: true },
      { id: 'addr', type: 'text', content: '{{businessAddress}}', x: 50, y: 16, fontSize: 10, align: 'center' },
      { id: 'meta', type: 'text', content: '{{saleDate}}\nCashier: {{cashier}}\n{{paymentMethod}}', x: 50, y: 24, fontSize: 9, align: 'center' },
      { id: 'items', type: 'text', content: '{{items}}', x: 5, y: 40, fontSize: 11, align: 'left' },
      { id: 'total', type: 'text', content: 'Total: {{total}}', x: 5, y: 72, fontSize: 12, align: 'left', bold: true },
      { id: 'paid', type: 'text', content: 'Paid: {{amountPaid}}\nChange: {{change}}', x: 5, y: 80, fontSize: 11, align: 'left' },
      { id: 'footer', type: 'text', content: '{{footer}}', x: 50, y: 92, fontSize: 10, align: 'center' },
    ];
  }

  resolveTemplateElements(json: string | null | undefined): PosReceiptTemplateElement[] {
    const parsed = this.comms.parseTemplate(json);
    const base = parsed.length ? parsed.map((e) => ({ ...e })) : this.defaultTemplateElements();
    return this.normalizeTemplateForPrint(base);
  }

  /**
   * Ensure header/footer stay centered and cashier line is present for print.
   */
  private normalizeTemplateForPrint(elements: PosReceiptTemplateElement[]): PosReceiptTemplateElement[] {
    const normalized = elements.map((el) => {
      const content = String(el.content ?? '');
      const isHeader =
        /\{\{\s*(businessName|storeName|companyName|businessAddress|saleDate|cashier|paymentMethod|footer)\s*\}\}/i.test(
          content,
        ) || /cashier\s*:/i.test(content);
      if (!isHeader || el.type === 'image') return el;
      return { ...el, align: 'center' as const };
    });

    const joined = normalized.map((e) => e.content).join('\n');
    const hasCashier = /\{\{\s*cashier\s*\}\}/i.test(joined) || /cashier\s*:/i.test(joined);
    if (!hasCashier) {
      const addrIdx = normalized.findIndex((e) => /\{\{\s*businessAddress\s*\}\}/i.test(e.content));
      const insertAt = addrIdx >= 0 ? addrIdx + 1 : Math.min(2, normalized.length);
      normalized.splice(insertAt, 0, {
        id: `cashier-${Date.now()}`,
        type: 'text',
        content: 'Cashier: {{cashier}}',
        x: 50,
        y: (normalized[insertAt - 1]?.y ?? 20) + 8,
        fontSize: 9,
        align: 'center',
      });
    }
    return normalized;
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
    const store = (ctx.businessName || '').trim() || 'Store';
    const cashier = (ctx.cashier || '').trim() || 'Cashier';
    return content
      .replace(/\{\{\s*businessName\s*\}\}/gi, store)
      .replace(/\{\{\s*storeName\s*\}\}/gi, store)
      .replace(/\{\{\s*companyName\s*\}\}/gi, store)
      .replace(/\{\{\s*businessAddress\s*\}\}/gi, ctx.businessAddress || '')
      .replace(/\{\{\s*items\s*\}\}/gi, ctx.itemsText || '')
      .replace(/\{\{\s*total\s*\}\}/gi, ctx.total || '₱0.00')
      .replace(/\{\{\s*amountPaid\s*\}\}/gi, ctx.amountPaid || '₱0.00')
      .replace(/\{\{\s*change\s*\}\}/gi, ctx.change || '₱0.00')
      .replace(/\{\{\s*footer\s*\}\}/gi, ctx.footer || 'Thank you!')
      .replace(/\{\{\s*paymentMethod\s*\}\}/gi, ctx.paymentMethod || '')
      .replace(/\{\{\s*cashier\s*\}\}/gi, cashier)
      .replace(/\{\{\s*saleDate\s*\}\}/gi, ctx.saleDate || '');
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
    const logoGap = templateLogoBlankLines(sorted[0]?.y ?? 8);
    const logoHtml = logo
      ? `${logo}<div class="spacer" style="height:${logoGap * 12}px"></div>`
      : '';

    let prevY = sorted[0]?.y ?? 0;
    let prevLines = 1;
    const bodyParts: string[] = [];
    let first = true;
    for (const el of sorted) {
      const content = String(el.content ?? '');
      const forceCenter =
        /\{\{\s*(businessName|storeName|companyName|businessAddress|saleDate|cashier|paymentMethod|footer)\s*\}\}/i.test(
          content,
        ) || /cashier\s*:/i.test(content);
      const align = forceCenter
        ? 'center'
        : el.align === 'left' || el.align === 'center' || el.align === 'right'
          ? el.align
          : (el.x ?? 0) >= 40
            ? 'center'
            : 'left';
      const fontSize = el.fontSize ?? 12;
      const weight = el.bold || /\{\{\s*businessName\s*\}\}/i.test(content) ? '700' : '400';

      if (!first) {
        const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines, content);
        if (blanks > 0) {
          bodyParts.push(`<div class="spacer" style="height:${blanks * 12}px"></div>`);
        }
      }

      if (el.type === 'image') {
        const w = Math.min(100, Math.max(20, el.width ?? 40));
        bodyParts.push(
          `<div class="block ${align}"><img src="${this.escapeAttr(el.content)}" alt="" style="width:${w}%;max-width:100%;height:auto;" /></div>`,
        );
        prevY = el.y ?? 0;
        prevLines = 3;
        first = false;
        continue;
      }

      const rendered = this.renderTemplateText(el.content, ctx).trim();
      if (!rendered) continue;
      const text = this.escapeHtml(rendered).replace(/\n/g, '<br/>');
      bodyParts.push(
        `<div class="block ${align}" style="font-size:${fontSize}px;font-weight:${weight};">${text}</div>`,
      );
      prevY = el.y ?? 0;
      prevLines = countTemplateBlockLines(rendered);
      first = false;
    }
    const body = bodyParts.join('');

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
    margin: 0;
    line-height: 1.25;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .spacer { display: block; width: 100%; }
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
  <div class="receipt">${logoHtml}${body}</div>
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

  /** Build plain receipt text from saved template element order (for thermal printers). */
  buildReceiptTextFromTemplate(
    elements: PosReceiptTemplateElement[],
    ctx: ReceiptPrintContext,
  ): string {
    const cols = (ctx.paperWidth || '80mm').includes('58') ? 32 : 42;
    const sorted = [...(elements?.length ? elements : this.defaultTemplateElements())].sort(
      (a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0),
    );
    const lines: string[] = [];
    let prevY = sorted[0]?.y ?? 0;
    let prevLines = 1;
    let first = true;
    for (const el of sorted) {
      if (el.type === 'image') {
        if (!first) {
          const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines, el.content);
          for (let i = 0; i < blanks; i++) lines.push('');
        }
        prevY = el.y ?? 0;
        prevLines = 3;
        first = false;
        continue;
      }
      const content = String(el.content ?? '');
      const forceCenter =
        /\{\{\s*(businessName|storeName|companyName|businessAddress|saleDate|cashier|paymentMethod|footer)\s*\}\}/i.test(
          content,
        ) || /cashier\s*:/i.test(content);
      const align = forceCenter
        ? 'center'
        : el.align === 'left' || el.align === 'center' || el.align === 'right'
          ? el.align
          : (el.x ?? 0) >= 40
            ? 'center'
            : 'left';
      const text = this.renderTemplateText(el.content, ctx).trim();
      if (!text) continue;

      if (!first) {
        const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines, content);
        for (let i = 0; i < blanks; i++) lines.push('');
      }

      let blockLines = 0;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        blockLines += 1;
        if (align === 'center') {
          const t = trimmed.length > cols ? trimmed.slice(0, cols) : trimmed;
          const pad = Math.max(0, Math.floor((cols - t.length) / 2));
          lines.push(`${' '.repeat(pad)}${t}`);
        } else {
          lines.push(trimmed);
        }
      }
      prevY = el.y ?? 0;
      prevLines = Math.max(1, blockLines);
      first = false;
    }
    return lines.length ? lines.join('\n') : this.buildReceiptText(ctx);
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
      const text = this.buildReceiptTextFromTemplate(elements, ctx);
      const r = await this.comms.printRawToNetworkPrinter(connection.host, connection.port || 9100, text);
      if (r?.success) return { success: true };
      return { success: false, message: r?.message ?? 'Network printer unavailable.' };
    }

    if (connection.connectionType === 'usb' && connection.usbVendorId && connection.usbProductId) {
      const text = this.buildReceiptTextFromTemplate(elements, ctx);
      const r = await this.usbPrinter.printText(connection.usbVendorId, connection.usbProductId, text);
      if (r.success) return { success: true };
      return { success: false, message: r.message ?? 'USB printer unavailable.' };
    }

    if (connection.connectionType === 'bluetooth' && connection.btDeviceId) {
      const text = this.buildReceiptTextFromTemplate(elements, ctx);
      const r = await this.bluetoothPrinter.printText(connection.btDeviceId, text);
      if (r.success) return { success: true };
      return { success: false, message: r.message ?? 'Bluetooth printer unavailable.' };
    }

    if (connection.connectionType === 'printhub') {
      const r = await this.printHub.printReceipt(ctx, paperWidth, elements);
      if (r.success) return { success: true };
      return { success: false, message: r.message ?? 'PrintHub printer unavailable.' };
    }

    if (connection.connectionType === 'mharmal') {
      const text = this.buildReceiptTextFromTemplate(elements, ctx);
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
    const orgName = String(this.org.getContext().name ?? '').trim();
    const settingsName = String(item['businessName'] ?? '').trim();
    const businessName = settingsName || orgName || 'Store';
    const cashierName =
      String(sale.cashier ?? '').trim() ||
      'Cashier';
    const ctx: ReceiptPrintContext = {
      businessName,
      businessAddress: String(item['businessAddress'] ?? '').trim(),
      footer: String(item['posReceiptFooterText'] ?? 'Thank you!').trim() || 'Thank you!',
      logoUrl: (item['businessLogoLight'] as string) || (item['businessLogoDark'] as string) || null,
      showLogo: String(item['posReceiptShowLogo'] ?? 'true').toLowerCase() !== 'false',
      paperWidth,
      itemsText: this.formatItemsLines(sale.items ?? []),
      total: `₱${Number(sale.totalAmount).toFixed(2)}`,
      amountPaid: sale.amountPaid != null ? `₱${Number(sale.amountPaid).toFixed(2)}` : '',
      change: sale.changeAmount != null ? `₱${Number(sale.changeAmount).toFixed(2)}` : '₱0.00',
      paymentMethod: String(sale.paymentMethod ?? '').trim(),
      cashier: cashierName,
      saleDate: new Date(sale.createdAt || sale.saleDate).toLocaleString('en-PH'),
    };
    const savedType = (item['posPrinterConnectionType'] as PosPrinterConnectionType) || 'printhub';
    // Prefer a live PrintHub session / local preference over a stale "browser" DB value
    // (common when printer-settings save previously failed with entity-too-large).
    const connectionType = this.resolveConnectionType(
      savedType === 'bluetooth' || savedType === 'mharmal' ? 'printhub' : savedType,
    );
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

  /** Silently restore saved printer connection after page load / in background. */
  async restoreSavedPrinterConnection(): Promise<void> {
    try {
      const r = await this.comms.getPrinterSettings();
      const item = r?.item ?? {};
      let type = String(item['posPrinterConnectionType'] ?? 'printhub');
      try {
        const preferred = localStorage.getItem('pos.printerConnectionType');
        const pairedId = localStorage.getItem('pos.printhub.btDeviceId');
        if (preferred === 'printhub' || pairedId) type = 'printhub';
        else if ((!type || type === 'browser') && preferred) type = preferred;
      } catch {
        /* ignore */
      }
      if (type === 'bluetooth' || type === 'mharmal') type = 'printhub';

      const paperWidth = String(item['posReceiptPaperWidth'] ?? '58mm');
      try {
        localStorage.setItem('pos.receiptPaperWidth', paperWidth);
      } catch {
        /* ignore */
      }

      if (type === 'printhub') {
        await this.printHub.autoConnect(paperWidth);
      } else if (type === 'usb') {
        const vendor = String(item['posPrinterUsbVendorId'] ?? '');
        const product = String(item['posPrinterUsbProductId'] ?? '');
        if (vendor && product) await this.usbPrinter.restoreConnection(vendor, product);
      } else if (type === 'bluetooth') {
        const id = String(item['posPrinterBtDeviceId'] ?? '');
        if (id) await this.bluetoothPrinter.restoreConnection(id);
      } else if (type === 'mharmal') {
        const host = String(item['posPrinterHost'] ?? '127.0.0.1') || '127.0.0.1';
        const port = Number(item['posPrinterPort']) || MHARMAL_DEFAULT_PORT;
        await this.mharmalPrinter.restoreConnection(host, port);
      }
    } catch {
      /* ignore — user can re-select in settings */
    }
  }

  /** Periodic background check used by app layout on both dashboards. */
  async ensurePrinterConnectedInBackground(): Promise<void> {
    try {
      if (this.printHub.isConnected()) return;
      await this.restoreSavedPrinterConnection();
      if (!this.printHub.isConnected()) {
        try {
          if (localStorage.getItem('pos.printhub.btDeviceId')) {
            const paper = localStorage.getItem('pos.receiptPaperWidth') || '58mm';
            await this.printHub.autoConnect(paper);
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
}
