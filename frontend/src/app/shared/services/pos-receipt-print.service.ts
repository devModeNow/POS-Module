import { Injectable } from '@angular/core';
import {
  PosCashDrawerOpenOn,
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
  alignFromTemplateX,
  countTemplateBlockLines,
  formatPaymentSummaryLine,
  isPaymentSummaryBlock,
  padReceiptLine,
  parsePaymentPreviewParts,
  prepareTemplateElementsForPrint,
  receiptColumnCount,
  splitMultilinePaymentBlocks,
  sortTemplateElements,
  templateLogoBlankLines,
  templateSpacingBlankLines,
  templateSpacingHeightPx,
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
  /** When true, prints a "Re-print Only" watermark (My Sales / admin reprints). */
  reprint?: boolean;
};

export type PosPrinterConnection = {
  connectionType: PosPrinterConnectionType;
  host?: string;
  port?: number;
  usbVendorId?: string;
  usbProductId?: string;
  btDeviceId?: string;
};

/** ESC/POS pulse to pin 2 — standard cash drawer kick. */
export const CASH_DRAWER_ESC_PULSE = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);

// Re-export spacing helpers for callers that already import this module.
export {
  alignFromTemplateX,
  countTemplateBlockLines,
  padReceiptLine,
  receiptColumnCount,
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
      { id: 'hdr', type: 'text', content: '{{businessName}}', x: 50, y: 3, fontSize: 14, align: 'center', bold: true },
      { id: 'addr', type: 'text', content: '{{businessAddress}}', x: 50, y: 8, fontSize: 10, align: 'center' },
      { id: 'meta', type: 'text', content: '{{saleDate}}\nCashier: {{cashier}}\n{{paymentMethod}}', x: 50, y: 13, fontSize: 9, align: 'center' },
      { id: 'items', type: 'text', content: '{{items}}', x: 5, y: 28, fontSize: 11, align: 'left' },
      { id: 'total', type: 'text', content: 'Total: {{total}}', x: 8, y: 68, fontSize: 12, align: 'left', bold: true },
      { id: 'paid', type: 'text', content: 'Paid: {{amountPaid}}', x: 8, y: 72, fontSize: 11, align: 'left' },
      { id: 'change', type: 'text', content: 'Change: {{change}}', x: 8, y: 76, fontSize: 11, align: 'left' },
      { id: 'footer', type: 'text', content: '{{footer}}', x: 50, y: 92, fontSize: 10, align: 'center' },
    ];
  }

  resolveTemplateElements(json: string | null | undefined): PosReceiptTemplateElement[] {
    const parsed = this.comms.parseTemplate(json);
    const base = parsed.length ? parsed.map((e) => ({ ...e })) : this.defaultTemplateElements();
    // Editor shows saved positions; print path applies prepareTemplateElementsForPrint separately.
    return this.normalizeTemplateForPrint(splitMultilinePaymentBlocks(base));
  }

  /**
   * Ensure cashier line is present when missing; preserve saved align/content otherwise.
   */
  private normalizeTemplateForPrint(elements: PosReceiptTemplateElement[]): PosReceiptTemplateElement[] {
    const normalized = elements.map((e) => ({ ...e }));

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

  formatItemLine(
    item: { productName: string; variantName: string; quantitySold: number; unitType: string; totalAmount: number },
    usePeso = true,
    cols = 32,
  ): string {
    const name = (item.variantName || item.productName || 'Item').trim();
    const qty = Number(item.quantitySold);
    const qtyLabel = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
    const unit = String(item.unitType || 'pc').trim() || 'pc';
    const qtyUnit = `${qtyLabel}x ${unit}`;
    const sym = usePeso ? '₱' : 'P';
    const price = `${sym}${Number(item.totalAmount).toFixed(2)}`;
    const sep = ' .... ';
    const maxLeft = Math.max(8, cols - price.length - sep.length);
    let left = `${qtyUnit} - ${name}`;
    if (left.length > maxLeft) {
      left = `${left.slice(0, Math.max(6, maxLeft - 3))}...`;
    }
    return `${left}${sep}${price}`;
  }

  formatItemsLines(
    items: Array<{ productName: string; variantName: string; quantitySold: number; unitType: string; totalAmount: number }>,
    usePeso = true,
    paperWidth?: string,
  ): string {
    const cols = receiptColumnCount(paperWidth);
    return items.map((item) => this.formatItemLine(item, usePeso, cols)).join('\n');
  }

  /** Resolve alignment from saved template (explicit align + canvas X position). */
  resolveElementAlign(el: PosReceiptTemplateElement, rawContent?: string): 'left' | 'center' | 'right' {
    if (el.align === 'left' || el.align === 'center' || el.align === 'right') {
      return el.align;
    }
    const content = String(rawContent ?? el.content ?? '');
    if (
      /\{\{\s*(businessName|storeName|companyName|businessAddress|saleDate|cashier|paymentMethod|footer)\s*\}\}/i.test(
        content,
      ) ||
      /cashier\s*:/i.test(content)
    ) {
      return 'center';
    }
    return alignFromTemplateX(el.x);
  }

  reprintWatermarkHtml(): string {
    return `<div class="block center reprint-watermark" style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">Re-print Only</div>`;
  }

  reprintWatermarkText(cols = 32): string {
    const label = 'RE-PRINT ONLY';
    const pad = Math.max(0, Math.floor((cols - label.length) / 2));
    return `${' '.repeat(pad)}${label}`;
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
    const sorted = sortTemplateElements(prepareTemplateElementsForPrint(elements));
    const logoGap = templateLogoBlankLines(sorted[0]?.y ?? 8);
    const reprintBanner = ctx.reprint ? this.reprintWatermarkHtml() : '';
    const logoHtml = logo
      ? `${logo}<div class="spacer" style="height:${templateSpacingHeightPx(logoGap)}px"></div>${reprintBanner}`
      : reprintBanner;

    let prevY = sorted[0]?.y ?? 0;
    let prevLines = 1;
    const bodyParts: string[] = [];
    let first = true;
    for (const el of sorted) {
      const content = String(el.content ?? '');
      const align = this.resolveElementAlign(el, content);
      const fontSize = el.fontSize ?? 12;
      const weight = el.bold || /\{\{\s*businessName\s*\}\}/i.test(content) ? '700' : '400';

      if (!first) {
        const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines);
        if (blanks > 0) {
          bodyParts.push(`<div class="spacer" style="height:${templateSpacingHeightPx(blanks)}px"></div>`);
        }
      }

      if (el.type === 'image') {
        const w = Math.min(100, Math.max(20, el.width ?? 40));
        bodyParts.push(
          `<div class="block ${align}"><img src="${this.escapeAttr(el.content)}" alt="" style="width:${w}%;max-width:100%;height:auto;" /></div>`,
        );
        prevY = el.y ?? 0;
        prevLines = 2;
        first = false;
        continue;
      }

      const rendered = this.renderTemplateText(el.content, ctx).trim();
      if (!rendered) continue;

      if (isPaymentSummaryBlock(content)) {
        const fontSize = el.fontSize ?? 12;
        const weight = el.bold ? '700' : '400';
        for (const line of rendered.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parts = parsePaymentPreviewParts(content, trimmed);
          if (parts) {
            bodyParts.push(
              `<div class="payment-row" style="font-size:${fontSize}px;font-weight:${weight};"><span>${this.escapeHtml(parts.label)}</span><span>${this.escapeHtml(parts.amount)}</span></div>`,
            );
          } else {
            bodyParts.push(
              `<div class="block left" style="font-size:${fontSize}px;font-weight:${weight};line-height:1.1;">${this.escapeHtml(trimmed)}</div>`,
            );
          }
        }
      } else {
        const text = this.escapeHtml(rendered).replace(/\n/g, '<br/>');
        bodyParts.push(
          `<div class="block ${align}" style="font-size:${fontSize}px;font-weight:${weight};line-height:1.1;">${text}</div>`,
        );
      }
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
    padding: 1mm 3mm 3mm;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible;
  }
  .block {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    line-height: 1.1;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .spacer { display: block; width: 100%; }
  .block.left { text-align: left; }
  .block.center { text-align: center; }
  .block.right { text-align: right; }
  .logo {
    max-width: 55%;
    max-height: 36px;
    height: auto;
    display: inline-block;
    margin: 0 auto 1px;
  }
  .payment-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    margin: 0;
    padding: 0;
    line-height: 1.1;
  }
  .payment-row span:last-child { text-align: right; white-space: nowrap; }
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
    const cols = receiptColumnCount(ctx.paperWidth);
    const sorted = sortTemplateElements(
      prepareTemplateElementsForPrint(
        elements?.length ? elements : this.defaultTemplateElements(),
      ),
    );
    const lines: string[] = [];
    if (ctx.reprint) {
      lines.push(this.reprintWatermarkText(cols));
      lines.push('');
    }
    let prevY = sorted[0]?.y ?? 0;
    let prevLines = 1;
    let first = true;
    for (const el of sorted) {
      if (el.type === 'image') {
        if (!first) {
          const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines);
          for (let i = 0; i < blanks; i++) lines.push('');
        }
        prevY = el.y ?? 0;
        prevLines = 3;
        first = false;
        continue;
      }
      const content = String(el.content ?? '');
      const align = this.resolveElementAlign(el, content);
      const text = this.renderTemplateText(el.content, ctx).trim();
      if (!text) continue;

      if (!first) {
        const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines);
        for (let i = 0; i < blanks; i++) lines.push('');
      }

      let blockLines = 0;
      const isPayment = isPaymentSummaryBlock(content);
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        blockLines += 1;
        const sep = trimmed.lastIndexOf(' .... ');
        if (sep >= 0 && align === 'left' && !isPayment) {
          const left = trimmed.slice(0, sep).trim();
          const right = trimmed.slice(sep + 6).trim();
          const combined = `${left}${' '.repeat(Math.max(1, cols - left.length - right.length))}${right}`;
          lines.push(combined.length > cols ? combined.slice(0, cols) : combined);
        } else if (isPayment) {
          lines.push(formatPaymentSummaryLine(trimmed, cols));
        } else if (align === 'center' || align === 'right') {
          lines.push(padReceiptLine(trimmed, cols, align));
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
  async openCashDrawer(
    connection: PosPrinterConnection,
    paperWidth: string,
  ): Promise<{ success: boolean; message?: string }> {
    if (connection.connectionType === 'browser') {
      return { success: false, message: 'Cash drawer is not available with browser print.' };
    }

    if (connection.connectionType === 'network' && connection.host) {
      const pulse = String.fromCharCode(...CASH_DRAWER_ESC_PULSE);
      const r = await this.comms.printRawToNetworkPrinter(connection.host, connection.port || 9100, pulse);
      if (r?.success) return { success: true };
      return { success: false, message: r?.message ?? 'Network printer unavailable.' };
    }

    if (connection.connectionType === 'usb' && connection.usbVendorId && connection.usbProductId) {
      const r = await this.usbPrinter.sendRawBytes(
        connection.usbVendorId,
        connection.usbProductId,
        CASH_DRAWER_ESC_PULSE,
      );
      if (r.success) return { success: true };
      return { success: false, message: r.message ?? 'USB printer unavailable.' };
    }

    if (connection.connectionType === 'bluetooth' && connection.btDeviceId) {
      const r = await this.bluetoothPrinter.sendRawBytes(connection.btDeviceId, CASH_DRAWER_ESC_PULSE);
      if (r.success) return { success: true };
      return { success: false, message: r.message ?? 'Bluetooth printer unavailable.' };
    }

    if (connection.connectionType === 'printhub') {
      await this.printHub.autoConnect(paperWidth);
      if (!this.printHub.isConnected()) {
        return { success: false, message: 'Printer not connected.' };
      }
      return this.printHub.openCashDrawer();
    }

    if (connection.connectionType === 'mharmal') {
      const host = connection.host?.trim() || '127.0.0.1';
      const port = connection.port && connection.port > 0 ? connection.port : MHARMAL_DEFAULT_PORT;
      const pulse = String.fromCharCode(...CASH_DRAWER_ESC_PULSE);
      const r = await this.comms.printRawToNetworkPrinter(host, port, pulse);
      if (r?.success) return { success: true };
      return { success: false, message: r?.message ?? 'Mharmal printer unavailable.' };
    }

    return { success: false, message: 'Cash drawer is not configured for this printer type.' };
  }

  parseCashDrawerSettings(item: Record<string, unknown>): {
    enabled: boolean;
    openOn: PosCashDrawerOpenOn;
  } {
    const enabled = String(item['posCashDrawerEnabled'] ?? 'false').toLowerCase() === 'true';
    const raw = String(item['posCashDrawerOpenOn'] ?? 'before_receipt').trim() as PosCashDrawerOpenOn;
    const openOn: PosCashDrawerOpenOn =
      raw === 'after_receipt' || raw === 'manual_only' ? raw : 'before_receipt';
    return { enabled, openOn };
  }

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
      await this.printHub.autoConnect(paperWidth);
      if (!this.printHub.isConnected()) {
        this.printHub.requestConnectPrompt();
        return {
          success: false,
          message:
            'Printer not connected. Tap Connect when prompted (or the Bluetooth icon), then reprint from My Sales.',
        };
      }
      const r = await this.printHub.printReceipt(ctx, paperWidth, elements);
      if (r.success) return { success: true };
      this.printHub.requestConnectPrompt();
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
    options?: { reprint?: boolean; openCashDrawer?: boolean },
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
      itemsText: this.formatItemsLines(sale.items ?? [], true, paperWidth),
      total: `₱${Number(sale.totalAmount).toFixed(2)}`,
      amountPaid: sale.amountPaid != null ? `₱${Number(sale.amountPaid).toFixed(2)}` : '',
      change: sale.changeAmount != null ? `₱${Number(sale.changeAmount).toFixed(2)}` : '₱0.00',
      paymentMethod: String(sale.paymentMethod ?? '').trim(),
      cashier: cashierName,
      saleDate: new Date(sale.createdAt || sale.saleDate).toLocaleString('en-PH'),
      reprint: options?.reprint === true,
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
    const drawer = this.parseCashDrawerSettings(item);
    const shouldOpenDrawer =
      options?.openCashDrawer !== false && drawer.enabled && drawer.openOn !== 'manual_only';

    if (shouldOpenDrawer && drawer.openOn === 'before_receipt') {
      await this.openCashDrawer(connection, paperWidth);
    }

    const result = await this.printViaConnection(elements, ctx, paperWidth, connection);

    if (shouldOpenDrawer && drawer.openOn === 'after_receipt') {
      await this.openCashDrawer(connection, paperWidth);
    }

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
