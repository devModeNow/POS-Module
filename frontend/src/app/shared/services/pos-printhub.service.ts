import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import PrintHub from 'printhub';
import type { PosReceiptTemplateElement } from './pos-communications.service';
import type { ReceiptPrintContext } from './pos-receipt-print.service';
import {
  alignFromTemplateX,
  countTemplateBlockLines,
  formatPaymentSummaryLine,
  isPaymentSummaryBlock,
  padReceiptLine,
  prepareTemplateElementsForPrint,
  sortTemplateElements,
  templateLogoBlankLines,
  templateSpacingBlankLines,
} from './pos-receipt-spacing';

type PrintHubInstance = InstanceType<typeof PrintHub>;

/** Same GATT service PrintHub uses for BLE thermal printers. */
const PRINTHUB_BT_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb';
const LS_DEVICE_ID = 'pos.printhub.btDeviceId';
const LS_DEVICE_NAME = 'pos.printhub.btDeviceName';

/** Web Bluetooth rejects writeValue payloads over 512 bytes; stay well under for Android MTU. */
const BLE_WRITE_CHUNK = 180;
const BLE_CHUNKED_FLAG = '__posBleChunked';

type BleWriteChar = {
  writeValue: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
  [BLE_CHUNKED_FLAG]?: boolean;
  [key: string]: unknown;
};

type BluetoothGattLike = {
  connected: boolean;
  connect: () => Promise<unknown>;
  getPrimaryService: (uuid: string) => Promise<{
    getCharacteristics: () => Promise<
      Array<{
        properties: { write?: boolean; writeWithoutResponse?: boolean };
        writeValue: (data: BufferSource) => Promise<void>;
        writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
      }>
    >;
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
  private pendingConnectPrompt = false;
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
   * After login (or failed sale print), ask UI to show a Connect button.
   * Needed on tablets: Web Bluetooth picker requires a fresh user gesture,
   * and the Sign In click is consumed by the login API await.
   */
  requestConnectPrompt(): void {
    this.pendingConnectPrompt = true;
  }

  consumeConnectPrompt(): boolean {
    if (!this.pendingConnectPrompt) return false;
    this.pendingConnectPrompt = false;
    return true;
  }

  hasConnectPrompt(): boolean {
    return this.pendingConnectPrompt;
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
            this.ensureChunkedPrintChar(hub);
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
          (hub as PrintHubInstance & { printChar: unknown }).printChar =
            this.wrapBleWriteChar(writeChar as BleWriteChar);
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
    // Always try silent reconnect first (tablets often drop GATT between sales).
    if (!this.isConnected() || !this.printer) {
      await this.trySilentReconnect(paperWidth);
    }
    if (!this.isConnected() || !this.printer) {
      this.requestConnectPrompt();
      return {
        success: false,
        message:
          'Printer not connected. Tap the Bluetooth icon (or Connect when prompted), choose your printer, then try again.',
      };
    }

    const hub = this.printer;
    const width = paperWidth || this.paperWidth || '58mm';
    this.paperWidth = width.includes('80') ? '80mm' : '58mm';
    hub.setPaperSize(this.paperWidth.includes('80') ? '80' : '58');
    this.ensureChunkedPrintChar(hub);

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
        this.requestConnectPrompt();
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
            this.ensureChunkedPrintChar(print);
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
          this.requestConnectPrompt();
          resolve({
            success: false,
            message:
              message ||
              'PrintHub connection lost. Tap the Bluetooth icon to reconnect.',
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
    const sorted = sortTemplateElements(prepareTemplateElementsForPrint(elements));

    await this.writeLogoIfEnabled(print, ctx, templateLogoBlankLines(sorted[0]?.y ?? 8));
    if (ctx.reprint) {
      await this.writeReprintWatermark(print);
    }

    let wroteAnything = false;
    let prevY = sorted[0]?.y ?? 0;
    let prevLines = 1;
    let first = true;

    for (const el of sorted) {
      if (el.type === 'image') {
        const src = String(el.content ?? '').trim();
        if (src) {
          if (!first) {
            const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines);
            if (blanks > 0) await print.writeLineBreak({ count: blanks });
          }
          try {
            // Avoid PrintHub putImageWithUrl — its bitmap threshold prints garbage on many BLE printers.
            await this.safePrintLogo(print, src, 0);
            wroteAnything = true;
            prevY = el.y ?? 0;
            prevLines = 2;
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
        const blanks = templateSpacingBlankLines(prevY, el.y ?? 0, prevLines);
        if (blanks > 0) await print.writeLineBreak({ count: blanks });
      }

      wroteAnything = true;
      prevLines = await this.writeTemplateTextBlock(print, raw, el, ctx, cols);
      prevY = el.y ?? 0;
      first = false;
    }
    if (!wroteAnything) {
      await this.writeReceipt(print, ctx, false);
      return;
    }
    // Small feed so paper can tear; vertical gaps between blocks come from template Y only.
    await print.writeLineBreak({ count: 2 });
  }

  /** Print a template text block in one call when possible (tight line spacing). */
  private async writeTemplateTextBlock(
    print: PrintHubInstance,
    raw: string,
    el: PosReceiptTemplateElement,
    ctx: ReceiptPrintContext,
    cols: number,
  ): Promise<number> {
    const align = this.resolveAlign(el, el.content);
    const useDouble = align !== 'center' && (el.fontSize ?? 12) >= 14;
    const lines = raw
      .split('\n')
      .map((l) => this.toThermalText(l).trim())
      .filter(Boolean);
    if (!lines.length) return 1;

    const isPayment = isPaymentSummaryBlock(el.content);
    const hasItemColumns = lines.some(
      (l) => l.lastIndexOf(' .... ') >= 0 && align === 'left' && !isPayment,
    );

    if (hasItemColumns) {
      let blockLines = 0;
      for (const line of lines) {
        const sep = line.lastIndexOf(' .... ');
        if (sep >= 0) {
          await print.writeTextWith2Column(
            line.slice(0, sep).trim(),
            line.slice(sep + 6).trim(),
            { bold: !!el.bold, align: 'left' },
          );
        } else {
          await print.writeText(line, {
            bold: !!el.bold,
            align: 'left',
            size: useDouble ? 'double' : 'normal',
          });
        }
        blockLines += useDouble ? 2 : 1;
      }
      return Math.max(1, blockLines);
    }

    if (isPayment && lines.length >= 1) {
      let blockLines = 0;
      for (const line of lines) {
        const m = line.match(/^(.+?:)\s*(.+)$/);
        if (m) {
          await print.writeTextWith2Column(m[1].trim(), m[2].trim(), {
            bold: !!el.bold,
            align: 'left',
            size: useDouble ? 'double' : 'normal',
          });
        } else {
          await print.writeText(line, {
            bold: !!el.bold,
            align: 'left',
            size: useDouble ? 'double' : 'normal',
          });
        }
        blockLines += useDouble ? 2 : 1;
      }
      return Math.max(1, blockLines);
    }

    const formatted = lines
      .map((line) => {
        if (isPayment) return this.toThermalText(formatPaymentSummaryLine(line, cols));
        if (align === 'center' || align === 'right') return padReceiptLine(line, cols, align);
        return line;
      })
      .join('\n');

    const bold =
      !!el.bold ||
      (align === 'center' &&
        /\{\{\s*(businessName|storeName|companyName)\s*\}\}/i.test(el.content)) ||
      (align === 'center' && formatted.includes(this.toThermalText(ctx.businessName || '')));

    await print.writeText(formatted, {
      bold,
      align: 'left',
      size: useDouble ? 'double' : 'normal',
    });

    return Math.max(1, lines.length * (useDouble ? 2 : 1));
  }

  /** Prefer explicit saved align; fall back to canvas X and header heuristics. */
  private resolveAlign(el: PosReceiptTemplateElement, rawContent?: string): 'left' | 'center' | 'right' {
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

  private async writeReprintWatermark(print: PrintHubInstance): Promise<void> {
    const cols = this.columnCount();
    const label = 'RE-PRINT ONLY';
    const padded = this.centerPad(label, cols);
    await print.writeText(padded, { bold: true, align: 'left', size: 'normal' });
    await print.writeLineBreak({ count: 1 });
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
    await this.safePrintLogo(print, logo, blankLinesAfter);
  }

  /**
   * Print a logo as ESC/POS raster with a correct dark-pixel threshold.
   * PrintHub's built-in putImageWithUrl treats any non-black RGB as ink (inverted /
   * noisy) and often dumps binary as "random characters" on cheap BLE printers.
   */
  private async safePrintLogo(
    print: PrintHubInstance,
    logoUrl: string,
    blankLinesAfter = 1,
  ): Promise<void> {
    const printChar = (print as PrintHubInstance & {
      printChar?: { writeValue: (data: BufferSource) => Promise<void> };
    }).printChar;
    if (!printChar?.writeValue) return;

    try {
      const img = await this.loadHtmlImage(logoUrl);
      const maxDots = this.paperWidth.includes('80') ? 384 : 240;
      const raster = this.buildMonoRasterEscPos(img, maxDots);
      if (!raster.length) return;

      await this.writeBleChunks(printChar, new Uint8Array([0x1b, 0x61, 0x01])); // center
      await this.writeBleChunks(printChar, raster);
      await this.writeBleChunks(printChar, new Uint8Array([0x1b, 0x61, 0x00])); // left
      const gaps = Math.max(0, Math.min(5, blankLinesAfter));
      if (gaps > 0) {
        await print.writeLineBreak({ count: gaps });
      }
    } catch {
      /* skip logo — never leave partial binary in the print stream */
    }
  }

  private loadHtmlImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // data: URLs must not set crossOrigin; http(s) logos need CORS for canvas read.
      if (/^https?:/i.test(src)) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load logo image'));
      img.src = src;
    });
  }

  /** GS v 0 raster; dark pixels = ink (fixes PrintHub inverted threshold). */
  private buildMonoRasterEscPos(img: HTMLImageElement, maxWidthDots: number): Uint8Array {
    const srcW = Math.max(1, img.naturalWidth || img.width || 1);
    const srcH = Math.max(1, img.naturalHeight || img.height || 1);
    let width = Math.min(maxWidthDots, srcW);
    width = Math.max(8, Math.floor(width / 8) * 8);
    const height = Math.max(1, Math.round((srcH * width) / srcW));
    // Cap height so BLE transfers stay reliable on tablets.
    const cappedH = Math.min(height, 80);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = cappedH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new Uint8Array();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, cappedH);
    ctx.drawImage(img, 0, 0, width, cappedH);

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, width, cappedH).data;
    } catch {
      // Tainted canvas (CORS) — skip logo rather than garbage-print.
      return new Uint8Array();
    }

    const widthBytes = width / 8;
    const out = new Uint8Array(8 + widthBytes * cappedH);
    out[0] = 0x1d; // GS
    out[1] = 0x76; // v
    out[2] = 0x30; // 0
    out[3] = 0x00; // normal
    out[4] = widthBytes & 0xff;
    out[5] = (widthBytes >> 8) & 0xff;
    out[6] = cappedH & 0xff;
    out[7] = (cappedH >> 8) & 0xff;

    let o = 8;
    for (let y = 0; y < cappedH; y++) {
      for (let xByte = 0; xByte < widthBytes; xByte++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit;
          const i = (y * width + x) * 4;
          const r = data[i] ?? 255;
          const g = data[i + 1] ?? 255;
          const b = data[i + 2] ?? 255;
          const a = data[i + 3] ?? 255;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          // Dark (or opaque dark) pixels become ink.
          const ink = a > 32 && lum < 160;
          if (ink) byte |= 0x80 >> bit;
        }
        out[o++] = byte;
      }
    }
    return out;
  }

  private async writeBleChunks(
    printChar: { writeValue: (data: BufferSource) => Promise<void> },
    data: Uint8Array,
  ): Promise<void> {
    // Prefer one call when characteristic is already wrapped; otherwise chunk here.
    const wrapped = printChar as BleWriteChar;
    if (wrapped[BLE_CHUNKED_FLAG]) {
      await printChar.writeValue(data as BufferSource);
      return;
    }
    for (let offset = 0; offset < data.length; offset += BLE_WRITE_CHUNK) {
      const slice = data.slice(offset, offset + BLE_WRITE_CHUNK);
      await printChar.writeValue(slice as BufferSource);
      // Brief yield so Android BLE stack can keep up.
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /**
   * PrintHub's writeText sends the whole string in one writeValue (no chunking).
   * Long receipt blocks (item lists on re-print) exceed the Web Bluetooth 512-byte cap.
   * Wrap the GATT characteristic so every write is split safely.
   */
  private wrapBleWriteChar(char: BleWriteChar): BleWriteChar {
    if (char[BLE_CHUNKED_FLAG]) return char;

    const originalWrite = char.writeValue.bind(char);
    const originalWriteWo = char.writeValueWithoutResponse?.bind(char);

    const writeChunked = async (
      writeFn: (data: BufferSource) => Promise<void>,
      data: BufferSource,
    ): Promise<void> => {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data instanceof Uint8Array
            ? data
            : new Uint8Array(
                (data as ArrayBufferView).buffer,
                (data as ArrayBufferView).byteOffset,
                (data as ArrayBufferView).byteLength,
              );
      if (bytes.length <= BLE_WRITE_CHUNK) {
        await writeFn(bytes as BufferSource);
        return;
      }
      for (let offset = 0; offset < bytes.length; offset += BLE_WRITE_CHUNK) {
        const slice = bytes.slice(offset, offset + BLE_WRITE_CHUNK);
        await writeFn(slice as BufferSource);
        await new Promise((r) => setTimeout(r, 15));
      }
    };

    return new Proxy(char, {
      get(target, prop, receiver) {
        if (prop === BLE_CHUNKED_FLAG) return true;
        if (prop === 'writeValue') {
          return (data: BufferSource) => writeChunked(originalWrite, data);
        }
        if (prop === 'writeValueWithoutResponse' && originalWriteWo) {
          return (data: BufferSource) => writeChunked(originalWriteWo, data);
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as BleWriteChar;
  }

  private ensureChunkedPrintChar(hub: PrintHubInstance): void {
    const holder = hub as PrintHubInstance & { printChar?: BleWriteChar | null };
    if (!holder.printChar?.writeValue) return;
    holder.printChar = this.wrapBleWriteChar(holder.printChar);
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
      await this.writeLogoIfEnabled(print, ctx, 0);
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

  /** ESC/POS pulse to pin 2 — standard cash drawer kick. */
  async openCashDrawer(): Promise<{ success: boolean; message?: string }> {
    if (!this.isConnected()) {
      const r = await this.autoConnect(this.paperWidth);
      if (!r.success) {
        return { success: false, message: r.message ?? 'Printer not connected.' };
      }
    }
    const printChar = (this.printer as PrintHubInstance & {
      printChar?: { writeValue: (data: BufferSource) => Promise<void> };
    })?.printChar;
    if (!printChar?.writeValue) {
      return { success: false, message: 'Printer not ready for cash drawer.' };
    }
    try {
      this.ensureChunkedPrintChar(this.printer!);
      const pulse = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);
      const char = (this.printer as PrintHubInstance & { printChar: BleWriteChar }).printChar;
      await this.writeBleChunks(char, pulse);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to open cash drawer.',
      };
    }
  }
}
