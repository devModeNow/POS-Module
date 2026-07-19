import { Injectable } from '@angular/core';
import PrintHub from 'printhub';
import type { ReceiptPrintContext } from './pos-receipt-print.service';

type PrintHubInstance = InstanceType<typeof PrintHub>;

/**
 * PrintHub (Web Bluetooth) bridge — same library used by the Quasar POS-Demo.
 * Connection is session-scoped; call connect() from a user click (header / settings),
 * then printReceipt() reuses that session without opening the browser dialog.
 */
@Injectable({ providedIn: 'root' })
export class PosPrintHubService {
  private printer: PrintHubInstance | null = null;
  private connected = false;
  private deviceLabel = '';
  private paperWidth = '58mm';

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!(navigator as Navigator & { bluetooth?: unknown }).bluetooth;
  }

  isConnected(): boolean {
    return this.connected && !!this.printer;
  }

  getDeviceLabel(): string {
    return this.deviceLabel || 'PrintHub printer';
  }

  /**
   * Opens the browser Bluetooth device picker. Must be called from a user gesture.
   */
  connect(paperWidth = '58mm', printerType: 'bluetooth' | 'usb' = 'bluetooth'): Promise<{
    success: boolean;
    message?: string;
    deviceName?: string;
  }> {
    if (printerType === 'bluetooth' && !this.isSupported()) {
      return Promise.resolve({
        success: false,
        message: 'Web Bluetooth is not supported. Use Chrome or Edge on HTTPS/localhost.',
      });
    }

    this.paperWidth = paperWidth;
    const paperSize = paperWidth.includes('80') ? '80' : '58';

    return new Promise((resolve) => {
      try {
        const hub = new PrintHub({ paperSize, printerType });
        void hub.connectToPrint({
          onReady: () => {
            this.printer = hub;
            this.connected = true;
            this.deviceLabel = printerType === 'usb' ? 'PrintHub USB printer' : 'PrintHub Bluetooth printer';
            resolve({
              success: true,
              message: `Connected via PrintHub (${paperSize}mm).`,
              deviceName: this.deviceLabel,
            });
          },
          onFailed: (message: string) => {
            this.printer = null;
            this.connected = false;
            resolve({
              success: false,
              message: message || 'Failed to connect via PrintHub.',
            });
          },
        });
      } catch (error) {
        this.printer = null;
        this.connected = false;
        resolve({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to start PrintHub.',
        });
      }
    });
  }

  disconnect(): void {
    this.printer = null;
    this.connected = false;
    this.deviceLabel = '';
  }

  /**
   * Prints via the active PrintHub session (same pattern as POS-Demo).
   * Does not open the Bluetooth picker — connect() must succeed first.
   */
  async printReceipt(
    ctx: ReceiptPrintContext,
    paperWidth = '58mm',
  ): Promise<{ success: boolean; message?: string }> {
    if (!this.isConnected() || !this.printer) {
      return {
        success: false,
        message:
          'PrintHub is not connected. Tap the Bluetooth icon in the POS header (or Printer Settings → Connect PrintHub), then try again.',
      };
    }

    const hub = this.printer;
    const width = paperWidth || this.paperWidth;
    hub.setPaperSize(width.includes('80') ? '80' : '58');

    return new Promise((resolve) => {
      void hub.connectToPrint({
        onReady: async (print) => {
          try {
            await this.writeReceipt(print, ctx);
            resolve({ success: true });
          } catch (error) {
            this.connected = false;
            resolve({
              success: false,
              message: error instanceof Error ? error.message : 'Failed to print via PrintHub.',
            });
          }
        },
        onFailed: (message: string) => {
          this.connected = false;
          this.printer = null;
          resolve({
            success: false,
            message:
              message ||
              'PrintHub connection lost. Tap the Bluetooth icon to reconnect, then complete another sale.',
          });
        },
      });
    });
  }

  private async writeReceipt(print: PrintHubInstance, ctx: ReceiptPrintContext): Promise<void> {
    // Thermal printers / PrintHub TextEncoder usually lack ₱ — use ASCII-safe currency.
    const money = (value: string | undefined, fallback = 'P0.00') =>
      this.toThermalText(value || fallback);

    await print.writeText(this.toThermalText(ctx.businessName || 'Store'), {
      align: 'center',
      bold: true,
      size: 'double',
    });
    if (ctx.businessAddress) {
      await print.writeText(this.toThermalText(ctx.businessAddress), { align: 'center' });
    }
    await print.writeDashLine();

    if (ctx.saleDate) {
      await print.writeTextWith2Column('Date', this.toThermalText(ctx.saleDate));
    }
    if (ctx.cashier) {
      await print.writeTextWith2Column('Cashier', this.toThermalText(ctx.cashier));
    }
    if (ctx.paymentMethod) {
      await print.writeTextWith2Column('Payment', this.toThermalText(ctx.paymentMethod));
    }
    await print.writeDashLine();

    if (ctx.itemsText) {
      for (const line of ctx.itemsText.split('\n')) {
        const trimmed = this.toThermalText(line).trim();
        if (!trimmed) continue;
        const sep = trimmed.lastIndexOf(' .... ');
        if (sep >= 0) {
          await print.writeTextWith2Column(
            trimmed.slice(0, sep).trim(),
            trimmed.slice(sep + 6).trim(),
          );
        } else {
          await print.writeText(trimmed);
        }
      }
    }

    await print.writeDashLine();
    await print.writeTextWith2Column('Total', money(ctx.total), { bold: true });
    if (ctx.amountPaid) {
      await print.writeTextWith2Column('Paid', money(ctx.amountPaid));
    }
    if (ctx.change) {
      await print.writeTextWith2Column('Change', money(ctx.change));
    }
    await print.writeDashLine();
    await print.writeText(this.toThermalText(ctx.footer || 'Thank you!'), { align: 'center' });
    await print.writeLineBreak({ count: 3 });
  }

  /**
   * Map characters thermal printers typically cannot render (e.g. ₱) to ASCII-safe text.
   */
  private toThermalText(value: string): string {
    return String(value ?? '')
      .replace(/\u20B1/g, 'P') // ₱
      .replace(/₱/g, 'P')
      .replace(/\u00A0/g, ' '); // non-breaking space
  }
}
