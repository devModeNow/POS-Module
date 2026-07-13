import { Injectable } from '@angular/core';
import {
  PosCommunicationsService,
  PosReceiptTemplateElement,
} from './pos-communications.service';
import { PosService } from './pos.service';

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

@Injectable({ providedIn: 'root' })
export class PosReceiptPrintService {
  constructor(
    private readonly comms: PosCommunicationsService,
    private readonly pos: PosService,
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
    const widthPx = paperWidth === '58mm' ? 220 : 300;
    const itemLines = (ctx.itemsText ?? '').split('\n').filter(Boolean).length;
    const heightPx = Math.max(420, 160 + itemLines * 22);
    const logo = ctx.showLogo !== false && ctx.logoUrl
      ? `<img src="${ctx.logoUrl}" alt="" style="max-width:60%;max-height:48px;display:block;margin:0 auto 8px;" />`
      : '';

    const body = elements
      .map((el) => {
        const style = this.elementStyle(el);
        const styleStr = Object.entries(style)
          .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}:${v}`)
          .join(';');
        if (el.type === 'image') {
          return `<div style="position:absolute;${styleStr}"><img src="${el.content}" alt="" style="width:100%;object-fit:contain;" /></div>`;
        }
        const text = this.renderTemplateText(el.content, ctx)
          .replace(/\n/g, '<br/>')
          .replace(/ /g, '&nbsp;');
        return `<div style="position:absolute;${styleStr}">${text}</div>`;
      })
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
<style>
  @page { size: ${paperWidth} auto; margin: 4mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: monospace, ui-monospace, monospace; color: #111; }
  .receipt { position: relative; width: ${widthPx}px; min-height: ${heightPx}px; margin: 0 auto; overflow: hidden; }
  @media print {
    html, body { width: ${widthPx}px; }
    .receipt { page-break-after: always; }
  }
</style></head><body>
  <div class="receipt">${logo}${body}</div>
  <script>window.onload = function(){ window.focus(); window.print(); }<\/script>
</body></html>`;
  }

  openPrintWindow(html: string): void {
    const win = window.open('', '_blank', 'width=420,height=720');
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

  async printSaleReceipt(saleId: number): Promise<boolean> {
    const [settingsRes, saleRes] = await Promise.all([
      this.comms.getPrinterSettings(),
      this.pos.getTransactionDetail(saleId),
    ]);
    if (!saleRes?.success || !saleRes.data) return false;
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
    this.printFromSettings(elements, ctx, paperWidth);
    return true;
  }
}
