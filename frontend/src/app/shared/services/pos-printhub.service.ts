import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import PrintHub from 'printhub';
import type { PosReceiptTemplateElement } from './pos-communications.service';
import type { ReceiptPrintContext } from './pos-receipt-print.service';
import {
  countTemplateBlockLines,
  templateLogoBlankLines,
  templateSpacingBlankLines,
} from './pos-receipt-spacing';

type PrintHubInstance = InstanceType<typeof PrintHub>;

/** Same GATT service PrintHub uses for BLE thermal printers. */
const PRINTHUB_BT_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb';
const LS_DEVICE_ID = 'pos.printhub.btDeviceId';
const LS_DEVICE_NAME = 'pos.printhub.btDeviceName';

type BluetoothGattLike = {
  connected: boolean;
  connect: () => Promise<unknown>;
  getPrimaryService: (uuid: string) => Promise<{
    getCharacteristics: () => Promise<Array<{ properties: { write?: boolean; writeWithoutResponse?: boolean } }>>;
  }>;
};

type BluetoothDeviceLike = {
  id: string;
  name?: string;
  gatt?: BluetoothGattLike;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

type BluetoothLike = {
  getDevices?: () => Promise<BluetoothDeviceLike[]>;
};

@Injectable({ providedIn: 'root' })
export class PosPrintHubService {
  private printer: PrintHubInstance | null = null;
  private connected = false;
  private deviceLabel = '';
  private paperWidth = '58mm';
  private reconnecting = false;
  private activeDevice: BluetoothDeviceLike | null = null;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly connectedSubject = new BehaviorSubject<boolean>(false);
  readonly connected$ = this.connectedSubject.asObservable();

  private readonly onGattDisconnected = () => {
    this.setConnected(false);
    this.printer = null;
    this.scheduleAutoReconnect(1500);
  };

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!(navigator as Navigator & { bluetooth?: unknown }).bluetooth;
  }

  isConnected(): boolean {
    return this.connected && !!this.printer && !!(this.printer as PrintHubInstance & { printChar?: unknown }).printChar;
  }

  getDeviceLabel(): string {
    return this.deviceLabel || this.readStoredName() || 'PrintHub printer';
  }

  /**
   * Connect to PrintHub Bluetooth.
   * Prefers silent reconnect to a previously permitted device (no picker).
   * Opens the Bluetooth picker only when no permitted device can be restored.
   * Pass `{ forcePicker: true }` (e.g. header icon click) to always open the device chooser
   * so the user can switch printers even when already connected.
   */
  async connect(
    paperWidth = '58mm',
    printerType: 'bluetooth' | 'usb' = 'bluetooth',
    options?: { forcePicker?: boolean },
  ): Promise<{
    success: boolean;
    message?: string;
    deviceName?: string;
  }> {
    if (printerType === 'bluetooth' && !this.isSupported()) {
      return {
        success: false,
        message: 'Web Bluetooth is not supported. Use Chrome or Edge on HTTPS/localhost.',
      };
    }

    this.paperWidth = paperWidth || this.paperWidth;

    if (options?.forcePicker) {
      return this.connectWithPicker(this.paperWidth, printerType, true);
    }

    if (printerType === 'bluetooth') {
      const silent = await this.trySilentReconnect(this.paperWidth);
      if (silent.success) {
        return {
          success: true,
          message: silent.message || 'Connected to Bluetooth printer.',
          deviceName: this.deviceLabel,
        };
      }
    }

    return this.connectWithPicker(this.paperWidth, printerType, false);
  }

  /** Background auto-connect used on POS load / visibility / watchdog. */
  async autoConnect(paperWidth?: string): Promise<{ success: boolean; message?: string }> {
    const width = paperWidth || this.paperWidth || '58mm';
    this.paperWidth = width.includes('80') ? '80mm' : '58mm';
    if (this.isConnected()) {
      return { success: true, message: 'Already connected.' };
    }
    return this.trySilentReconnect(this.paperWidth);
  }

  private connectWithPicker(
    paperWidth: string,
    printerType: 'bluetooth' | 'usb',
    forceNew = false,
  ): Promise<{ success: boolean; message?: string; deviceName?: string }> {
    const paperSize = paperWidth.includes('80') ? '80' : '58';

    // Drop the current session so PrintHub can show the Bluetooth chooser again.
    if (forceNew || this.isConnected()) {
      this.clearReconnectTimer();
      this.unbindDeviceDisconnect();
      this.printer = null;
      this.setConnected(false);
    }

    return new Promise((resolve) => {
      try {
        const hub = new PrintHub({ paperSize, printerType });
        void hub.connectToPrint({
          onReady: () => {
            this.printer = hub;
            this.setConnected(true);
            this.deviceLabel = printerType === 'usb' ? 'PrintHub USB printer' : 'PrintHub Bluetooth printer';
            try {
              localStorage.setItem('pos.printerConnectionType', 'printhub');
            } catch {
              /* ignore */
            }
            void this.rememberPairedDevice().then(() => {
              void this.attachDisconnectWatcherFromPermittedDevices();
            });
            resolve({
              success: true,
              message: forceNew
                ? `Connected via PrintHub (${paperSize}mm). You can switch printers anytime from the Bluetooth icon.`
                : `Connected via PrintHub (${paperSize}mm).`,
              deviceName: this.deviceLabel,
            });
          },
          onFailed: (message: string) => {
            this.printer = null;
            this.setConnected(false);
            // If user cancelled while switching, try restoring the previous paired device.
            if (forceNew) {
              void this.trySilentReconnect(paperWidth).then((restored) => {
                resolve({
                  success: restored.success,
                  message: restored.success
                    ? restored.message
                    : message || 'Printer selection cancelled.',
                  deviceName: restored.success ? this.deviceLabel : undefined,
                });
              });
              return;
            }
            resolve({
              success: false,
              message: message || 'Failed to connect via PrintHub.',
            });
          },
        });
      } catch (error) {
        this.printer = null;
        this.setConnected(false);
        resolve({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to start PrintHub.',
        });
      }
    });
  }

  /**
   * Background-friendly reconnect using previously permitted Bluetooth devices
   * (no picker). Requires a prior successful PrintHub pair in this browser.
   */
  async trySilentReconnect(paperWidth = '58mm'): Promise<{ success: boolean; message?: string }> {
    if (this.isConnected()) {
      return { success: true, message: 'Already connected.' };
    }
    if (!this.isSupported() || this.reconnecting) {
      return { success: false, message: 'Bluetooth unavailable or reconnect already in progress.' };
    }

    const bt = (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;
    if (!bt?.getDevices) {
      return { success: false, message: 'Silent Bluetooth reconnect is not supported in this browser.' };
    }

    this.reconnecting = true;
    this.paperWidth = paperWidth || this.paperWidth;
    const paperSize = this.paperWidth.includes('80') ? '80' : '58';

    try {
      const devices = await bt.getDevices();
      if (!devices.length) {
        return { success: false, message: 'No previously paired Bluetooth printer found.' };
      }

      const preferredId = this.readStoredDeviceId();
      const ordered = preferredId
        ? [...devices].sort((a, b) => (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0))
        : devices;

      for (const device of ordered) {
        try {
          if (!device.gatt) continue;
          if (!device.gatt.connected) await device.gatt.connect();
          const service = await device.gatt.getPrimaryService(PRINTHUB_BT_SERVICE);
          const chars = await service.getCharacteristics();
          const writeChar = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
          if (!writeChar) continue;

          const hub = new PrintHub({ paperSize, printerType: 'bluetooth' });
          (hub as PrintHubInstance & { printChar: unknown }).printChar = writeChar;
          this.printer = hub;
          this.deviceLabel = device.name?.trim() || this.readStoredName() || 'PrintHub Bluetooth printer';
          this.storeDevice(device.id, this.deviceLabel);
          this.bindDeviceDisconnect(device);
          this.setConnected(true);
          try {
            localStorage.setItem('pos.printerConnectionType', 'printhub');
          } catch {
            /* ignore */
          }
          return { success: true, message: `Connected to ${this.deviceLabel}.` };
        } catch {
          /* try next permitted device */
        }
      }
      return { success: false, message: 'Could not reconnect to a paired PrintHub printer.' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Silent reconnect failed.',
      };
    } finally {
      this.reconnecting = false;
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.unbindDeviceDisconnect();
    this.printer = null;
    this.setConnected(false);
    this.deviceLabel = '';
  }

  async printReceipt(
    ctx: ReceiptPrintContext,
    paperWidth = '58mm',
    elements?: PosReceiptTemplateElement[],
  ): Promise<{ success: boolean; message?: string }> {
    if (!this.isConnected() || !this.printer) {
      await this.trySilentReconnect(paperWidth);
    }
    if (!this.isConnected() || !this.printer) {
      return {
        success: false,
        message:
          'PrintHub is not connected. Tap the Bluetooth icon in the POS header (or Printer Settings → Connect PrintHub), then try again.',
      };
    }

    const hub = this.printer;
    const width = paperWidth || this.paperWidth || '58mm';
    this.paperWidth = width.includes('80') ? '80mm' : '58mm';
    hub.setPaperSize(this.paperWidth.includes('80') ? '80' : '58');

    // Already have a live GATT characteristic — print directly (avoid reopening the picker).
    if ((hub as PrintHubInstance & { printChar?: unknown }).printChar) {
      try {
        if (elements?.length) {
          await this.writeReceiptFromTemplate(hub, ctx, elements);
        } else {
          await this.writeReceipt(hub, ctx);
        }
        return { success: true };
      } catch (error) {
        this.setConnected(false);
        this.printer = null;
        this.scheduleAutoReconnect(1000);
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to print via PrintHub.',
        };
      }
    }

    return new Promise((resolve) => {
      void hub.connectToPrint({
        onReady: async (print) => {
          try {
            if (elements?.length) {
              await this.writeReceiptFromTemplate(print, ctx, elements);
            } else {
              await this.writeReceipt(print, ctx);
            }
            resolve({ success: true });
          } catch (error) {
            this.setConnected(false);
            resolve({
              success: false,
              message: error instanceof Error ? error.message : 'Failed to print via PrintHub.',
            });
          }
        },
        onFailed: (message: string) => {
          this.setConnected(false);
          this.printer = null;
          this.scheduleAutoReconnect(1500);
          resolve({
            success: false,
            message:
              message ||
              'PrintHub connection lost. Reconnecting automatically — or tap the Bluetooth icon.',
          });
        },
      });
    });
  }

  private setConnected(value: boolean): void {
    this.connected = value;
    if (this.connectedSubject.value !== value) {
      this.connectedSubject.next(value);
    }
  }

  private scheduleAutoReconnect(delayMs: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      void this.trySilentReconnect(this.paperWidth);
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private bindDeviceDisconnect(device: BluetoothDeviceLike): void {
    this.unbindDeviceDisconnect();
    this.activeDevice = device;
    device.addEventListener?.('gattserverdisconnected', this.onGattDisconnected);
  }

  private unbindDeviceDisconnect(): void {
    this.activeDevice?.removeEventListener?.('gattserverdisconnected', this.onGattDisconnected);
    this.activeDevice = null;
  }

  private async attachDisconnectWatcherFromPermittedDevices(): Promise<void> {
    try {
      const bt = (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;
      if (!bt?.getDevices) return;
      const devices = await bt.getDevices();
      const preferredId = this.readStoredDeviceId();
      const match =
        (preferredId ? devices.find((d) => d.id === preferredId) : undefined) ??
        devices.find((d) => d.name) ??
        devices[0];
      if (match) this.bindDeviceDisconnect(match);
    } catch {
      /* ignore */
    }
  }

  private async rememberPairedDevice(): Promise<void> {
    try {
      const bt = (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;
      if (!bt?.getDevices) return;
      const devices = await bt.getDevices();
      const match = devices.find((d) => d.name) ?? devices[0];
      if (match) this.storeDevice(match.id, match.name?.trim() || this.deviceLabel);
    } catch {
      /* ignore */
    }
  }

  private storeDevice(id: string, name: string): void {
    try {
      localStorage.setItem(LS_DEVICE_ID, id);
      localStorage.setItem(LS_DEVICE_NAME, name);
    } catch {
      /* ignore */
    }
  }

  private readStoredDeviceId(): string {
    try {
      return localStorage.getItem(LS_DEVICE_ID) ?? '';
    } catch {
      return '';
    }
  }

  private readStoredName(): string {
    try {
      return localStorage.getItem(LS_DEVICE_NAME) ?? '';
    } catch {
      return '';
    }
  }

  private async writeReceiptFromTemplate(
    print: PrintHubInstance,
    ctx: ReceiptPrintContext,
    elements: PosReceiptTemplateElement[],
  ): Promise<void> {
    const cols = this.columnCount();
    const sorted = [...elements].sort(
      (a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0),
    );

    await this.writeLogoIfEnabled(print, ctx, templateLogoBlankLines(sorted[0]?.y ?? 8));

    let wroteAnything = false;
    let prevY = sorted[0]?.y ?? 0;
    let prevLines = 1;
    let first = true;

    for (const el of sorted) {
      if (el.type === 'image') {
        const src = String(el.content ?? '').trim();
        if (src) {
          if (!first) {
            const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines, el.content);
            if (blanks > 0) await print.writeLineBreak({ count: blanks });
          }
          try {
            await print.putImageWithUrl(src, { align: 'center' });
            wroteAnything = true;
            prevY = el.y ?? 0;
            prevLines = 3;
            first = false;
          } catch {
            /* skip broken image */
          }
        }
        continue;
      }
      const raw = this.renderTemplateText(el.content, ctx).trim();
      if (!raw) continue;

      if (!first) {
        const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines, el.content);
        if (blanks > 0) await print.writeLineBreak({ count: blanks });
      }

      wroteAnything = true;
      const align = this.resolveAlign(el, el.content);
      // Avoid double-width on header lines — many cheap BLE printers mishandle center + double.
      const useDouble = align !== 'center' && (el.fontSize ?? 12) >= 14;
      let blockLines = 0;
      for (const line of raw.split('\n')) {
        const trimmed = this.toThermalText(line).trim();
        if (!trimmed) continue;
        blockLines += 1;
        const sep = trimmed.lastIndexOf(' .... ');
        if (sep >= 0 && align === 'left') {
          await print.writeTextWith2Column(
            trimmed.slice(0, sep).trim(),
            trimmed.slice(sep + 6).trim(),
            { bold: !!el.bold, align: 'left' },
          );
        } else if (align === 'center') {
          // Space-pad with LEFT align only. ESC center + pad double-shifts on many BLE printers.
          const padded = this.centerPad(trimmed, cols);
          await print.writeText(padded, {
            bold:
              !!el.bold ||
              /\{\{\s*(businessName|storeName|companyName)\s*\}\}/i.test(el.content) ||
              trimmed === this.toThermalText(ctx.businessName || ''),
            align: 'left',
            size: 'normal',
          });
        } else {
          await print.writeText(trimmed, {
            bold: !!el.bold,
            align,
            size: useDouble ? 'double' : 'normal',
          });
        }
      }
      prevY = el.y ?? 0;
      prevLines = Math.max(1, blockLines || countTemplateBlockLines(raw));
      first = false;
    }
    if (!wroteAnything) {
      await this.writeReceipt(print, ctx, false);
      return;
    }
    await print.writeLineBreak({ count: 3 });
  }

  /** Prefer explicit align; header placeholders always center. */
  private resolveAlign(el: PosReceiptTemplateElement, rawContent?: string): 'left' | 'center' | 'right' {
    const content = String(rawContent ?? el.content ?? '');
    if (
      /\{\{\s*(businessName|storeName|companyName|businessAddress|saleDate|cashier|paymentMethod|footer)\s*\}\}/i.test(
        content,
      ) ||
      /cashier\s*:/i.test(content)
    ) {
      return 'center';
    }
    if (el.align === 'left' || el.align === 'center' || el.align === 'right') return el.align;
    if ((el.x ?? 0) >= 40) return 'center';
    return 'left';
  }

  private columnCount(): number {
    return (this.paperWidth || '58mm').includes('80') ? 42 : 32;
  }

  /** Visual center via leading spaces; caller must use align:'left' (not ESC center). */
  private centerPad(text: string, cols: number): string {
    const t = text.length > cols ? text.slice(0, cols) : text;
    const pad = Math.max(0, Math.floor((cols - t.length) / 2));
    return `${' '.repeat(pad)}${t}`;
  }

  private async writeLogoIfEnabled(
    print: PrintHubInstance,
    ctx: ReceiptPrintContext,
    blankLinesAfter = 1,
  ): Promise<void> {
    if (ctx.showLogo === false) return;
    const logo = String(ctx.logoUrl ?? '').trim();
    if (!logo) return;
    try {
      await print.putImageWithUrl(logo, { align: 'center' });
      const gaps = Math.max(1, Math.min(5, blankLinesAfter));
      await print.writeLineBreak({ count: gaps });
    } catch {
      /* logo optional — continue printing text */
    }
  }

  private renderTemplateText(content: string, ctx: ReceiptPrintContext): string {
    const store = (ctx.businessName || '').trim() || 'Store';
    const cashier = (ctx.cashier || '').trim() || 'Cashier';
    return content
      .replace(/\{\{\s*businessName\s*\}\}/gi, store)
      .replace(/\{\{\s*storeName\s*\}\}/gi, store)
      .replace(/\{\{\s*companyName\s*\}\}/gi, store)
      .replace(/\{\{\s*businessAddress\s*\}\}/gi, ctx.businessAddress || '')
      .replace(/\{\{\s*items\s*\}\}/gi, ctx.itemsText || '')
      .replace(/\{\{\s*total\s*\}\}/gi, ctx.total || 'P0.00')
      .replace(/\{\{\s*amountPaid\s*\}\}/gi, ctx.amountPaid || 'P0.00')
      .replace(/\{\{\s*change\s*\}\}/gi, ctx.change || 'P0.00')
      .replace(/\{\{\s*footer\s*\}\}/gi, ctx.footer || 'Thank you!')
      .replace(/\{\{\s*paymentMethod\s*\}\}/gi, ctx.paymentMethod || '')
      .replace(/\{\{\s*cashier\s*\}\}/gi, cashier)
      .replace(/\{\{\s*saleDate\s*\}\}/gi, ctx.saleDate || '');
  }

  private async writeReceipt(
    print: PrintHubInstance,
    ctx: ReceiptPrintContext,
    includeLogo = true,
  ): Promise<void> {
    const money = (value: string | undefined, fallback = 'P0.00') =>
      this.toThermalText(value || fallback);
    const cols = this.columnCount();
    const store = this.toThermalText((ctx.businessName || '').trim() || 'Store');
    const cashier = this.toThermalText((ctx.cashier || '').trim() || 'Cashier');
    const writeCentered = async (text: string, bold = false) => {
      await print.writeText(this.centerPad(text, cols), { align: 'left', bold, size: 'normal' });
    };

    if (includeLogo) {
      await this.writeLogoIfEnabled(print, ctx, 2);
    }

    await writeCentered(store, true);
    if (ctx.businessAddress) {
      await writeCentered(this.toThermalText(ctx.businessAddress));
    }
    await print.writeDashLine();

    if (ctx.saleDate) {
      await writeCentered(this.toThermalText(ctx.saleDate));
    }
    await writeCentered(`Cashier: ${cashier}`);
    if (ctx.paymentMethod) {
      await writeCentered(this.toThermalText(ctx.paymentMethod));
    }
    await print.writeLineBreak({ count: 2 });
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

    await print.writeLineBreak({ count: 1 });
    await print.writeDashLine();
    await print.writeTextWith2Column('Total', money(ctx.total), { bold: true });
    if (ctx.amountPaid) {
      await print.writeTextWith2Column('Paid', money(ctx.amountPaid));
    }
    if (ctx.change) {
      await print.writeTextWith2Column('Change', money(ctx.change));
    }
    await print.writeLineBreak({ count: 1 });
    await print.writeDashLine();
    await writeCentered(this.toThermalText(ctx.footer || 'Thank you!'));
    await print.writeLineBreak({ count: 3 });
  }

  private toThermalText(value: string): string {
    return String(value ?? '')
      .replace(/\u20B1/g, 'P')
      .replace(/₱/g, 'P')
      .replace(/\u00A0/g, ' ');
  }
}
