import { Injectable } from '@angular/core';
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

export const MHARMAL_DEFAULT_HOST = '127.0.0.1';
export const MHARMAL_DEFAULT_PORT = 22300;

/** How we encode the WebSocket print job for Magmal / Mharmal Printer. */
export type MharmalPayloadFormat =
  | 'image-datauri'
  | 'image-base64'
  | 'image-binary'
  | 'escpos-binary'
  | 'json-image';

const PAYLOAD_STORAGE_KEY = 'posMharmalPayloadFormat';

/**
 * Bridge to the Mharmal Printer Android app (com.escpos.printer).
 * Play Store: Base64 images (preferred) or raw ESC/POS bytes over ws://host:22300.
 */
@Injectable({ providedIn: 'root' })
export class PosMharmalPrinterService {
  private ws: WebSocket | null = null;
  private host = MHARMAL_DEFAULT_HOST;
  private port = MHARMAL_DEFAULT_PORT;
  private openPromise: Promise<void> | null = null;
  private lastServerMessage = '';

  isSupported(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  getPayloadFormat(): MharmalPayloadFormat {
    const saved = (localStorage.getItem(PAYLOAD_STORAGE_KEY) || 'image-datauri') as MharmalPayloadFormat;
    const allowed: MharmalPayloadFormat[] = [
      'image-datauri',
      'image-base64',
      'image-binary',
      'escpos-binary',
      'json-image',
    ];
    return allowed.includes(saved) ? saved : 'image-datauri';
  }

  setPayloadFormat(format: MharmalPayloadFormat): void {
    localStorage.setItem(PAYLOAD_STORAGE_KEY, format);
  }

  buildUrl(host = MHARMAL_DEFAULT_HOST, port = MHARMAL_DEFAULT_PORT): string {
    const h = (host || MHARMAL_DEFAULT_HOST).trim() || MHARMAL_DEFAULT_HOST;
    const p = Number(port) > 0 ? Number(port) : MHARMAL_DEFAULT_PORT;
    return `ws://${h}:${p}`;
  }

  isConnected(host?: string, port?: number): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (host != null && host.trim() && host.trim() !== this.host) return false;
    if (port != null && Number(port) > 0 && Number(port) !== this.port) return false;
    return true;
  }

  async connect(
    host = MHARMAL_DEFAULT_HOST,
    port = MHARMAL_DEFAULT_PORT,
  ): Promise<{ success: boolean; message?: string }> {
    if (!this.isSupported()) {
      return { success: false, message: 'WebSocket is not available in this browser.' };
    }

    const nextHost = (host || MHARMAL_DEFAULT_HOST).trim() || MHARMAL_DEFAULT_HOST;
    const nextPort = Number(port) > 0 ? Number(port) : MHARMAL_DEFAULT_PORT;

    if (this.isConnected(nextHost, nextPort)) {
      return { success: true, message: `Connected to Mharmal at ${this.buildUrl(nextHost, nextPort)}` };
    }

    this.disconnect();
    this.host = nextHost;
    this.port = nextPort;
    const url = this.buildUrl(nextHost, nextPort);

    try {
      await this.openSocket(url);
      return { success: true, message: `Connected to Mharmal at ${url}` };
    } catch (error) {
      this.disconnect();
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : `Could not reach Mharmal Printer at ${url}. Open the app and start the WebSocket service.`,
      };
    }
  }

  disconnect(): void {
    this.openPromise = null;
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  async restoreConnection(
    host = MHARMAL_DEFAULT_HOST,
    port = MHARMAL_DEFAULT_PORT,
  ): Promise<{ success: boolean; message?: string }> {
    return this.connect(host, port);
  }

  async printText(
    text: string,
    host = MHARMAL_DEFAULT_HOST,
    port = MHARMAL_DEFAULT_PORT,
    paperWidth = '80mm',
  ): Promise<{ success: boolean; message?: string }> {
    const linked = await this.connect(host, port);
    if (!linked.success) return linked;

    try {
      const canvas = this.renderReceiptCanvas(text, paperWidth);
      const dataUrl = canvas.toDataURL('image/png');
      const format = this.getPayloadFormat();
      this.sendPayload(format, canvas, dataUrl, text);
      const reply = this.lastServerMessage ? ` Server: ${this.lastServerMessage}` : '';
      return {
        success: true,
        message: `Print job sent as ${format}.${reply}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to build/send Mharmal print job.',
      };
    }
  }

  async testConnection(
    host = MHARMAL_DEFAULT_HOST,
    port = MHARMAL_DEFAULT_PORT,
  ): Promise<{ success: boolean; message?: string }> {
    return this.connect(host, port);
  }

  private sendPayload(
    format: MharmalPayloadFormat,
    canvas: HTMLCanvasElement,
    dataUrl: string,
    text: string,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Mharmal WebSocket is not connected.');
    }

    const bareBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;

    switch (format) {
      case 'image-datauri':
        // Preferred per Play Store (“Base64 encoded images”).
        this.ws.send(dataUrl);
        break;
      case 'image-base64':
        this.ws.send(bareBase64);
        break;
      case 'image-binary': {
        const raw = this.base64ToBytes(bareBase64);
        this.ws.send(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
        break;
      }
      case 'escpos-binary': {
        const bytes = this.encodeEscPosFromCanvas(canvas, text);
        this.ws.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        break;
      }
      case 'json-image':
        this.ws.send(JSON.stringify({ type: 'image', format: 'png', data: bareBase64 }));
        break;
      default:
        this.ws.send(dataUrl);
    }
  }

  private renderReceiptCanvas(text: string, paperWidth: string): HTMLCanvasElement {
    const widthPx = paperWidth === '58mm' ? 384 : 576; // multiples of 8 (required by ESC/POS raster)
    const lines = String(text ?? '').split(/\r?\n/);
    const fontSize = 22;
    const lineHeight = 28;
    const padX = 12;
    const padY = 16;
    const rawHeight = padY * 2 + lines.length * lineHeight + 48;
    const height = Math.max(Math.ceil(rawHeight / 8) * 8, 128);

    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas for receipt image.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, height);
    ctx.fillStyle = '#000000';
    ctx.font = `${fontSize}px "Courier New", Courier, monospace`;
    ctx.textBaseline = 'top';

    lines.forEach((line, i) => {
      ctx.fillText(line, padX, padY + i * lineHeight, widthPx - padX * 2);
    });

    return canvas;
  }

  private encodeEscPosFromCanvas(canvas: HTMLCanvasElement, fallbackText: string): Uint8Array {
    try {
      // Typings for this package omit `.image()`, but it exists at runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const encoder: any = new ReceiptPrinterEncoder({ language: 'esc-pos' });
      const encoded = encoder
        .initialize()
        .image(canvas, canvas.width, canvas.height, 'threshold')
        .newline()
        .cut()
        .encode();
      return encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    } catch {
      return this.encodeEscPosText(fallbackText);
    }
  }

  private encodeEscPosText(text: string): Uint8Array {
    try {
      const encoder = new ReceiptPrinterEncoder({ language: 'esc-pos' });
      const encoded = encoder
        .initialize()
        .codepage('auto')
        .text(text)
        .newline()
        .newline()
        .newline()
        .cut()
        .encode();
      return encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    } catch {
      return new TextEncoder().encode(`${text}\n\n\n`);
    }
  }

  private base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  private openSocket(url: string): Promise<void> {
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
        this.openPromise = null;
        reject(
          new Error(
            `Timed out connecting to ${url}. Make sure Mharmal Printer is installed and its WebSocket service is running.`,
          ),
        );
      }, 8000);

      try {
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        this.ws = ws;

        ws.onopen = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve();
        };

        ws.onmessage = (event) => {
          try {
            if (typeof event.data === 'string') {
              this.lastServerMessage = event.data.slice(0, 200);
            } else {
              this.lastServerMessage = `[binary ${event.data?.byteLength ?? 0} bytes]`;
            }
          } catch {
            this.lastServerMessage = '';
          }
        };

        ws.onerror = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          this.openPromise = null;
          this.ws = null;
          reject(
            new Error(
              `Could not connect to ${url}. Open Mharmal Printer on this tablet and start the service (port ${this.port}).`,
            ),
          );
        };

        ws.onclose = () => {
          this.ws = null;
          this.openPromise = null;
        };
      } catch (error) {
        window.clearTimeout(timer);
        this.openPromise = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return this.openPromise;
  }
}
