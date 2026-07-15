import { Injectable } from '@angular/core';
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

export const MHARMAL_DEFAULT_HOST = '127.0.0.1';
export const MHARMAL_DEFAULT_PORT = 22300;

/**
 * Bridge to the Mharmal Printer Android app (com.escpos.printer).
 * The app runs a local WebSocket server and forwards ESC/POS / Base64
 * jobs to a Bluetooth or USB thermal printer on the same tablet.
 *
 * Docs (Play Store): ws://localhost:22300 — Base64 images or raw ESC/POS bytes.
 */
@Injectable({ providedIn: 'root' })
export class PosMharmalPrinterService {
  private ws: WebSocket | null = null;
  private host = MHARMAL_DEFAULT_HOST;
  private port = MHARMAL_DEFAULT_PORT;
  private openPromise: Promise<void> | null = null;

  isSupported(): boolean {
    return typeof WebSocket !== 'undefined';
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

  /** Restore / keep the WebSocket alive after page reload (same tablet). */
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
  ): Promise<{ success: boolean; message?: string }> {
    const linked = await this.connect(host, port);
    if (!linked.success) return linked;

    const bytes = this.encodeReceipt(text);
    return this.sendEscPos(bytes);
  }

  async printEscPos(
    bytes: Uint8Array,
    host = MHARMAL_DEFAULT_HOST,
    port = MHARMAL_DEFAULT_PORT,
  ): Promise<{ success: boolean; message?: string }> {
    const linked = await this.connect(host, port);
    if (!linked.success) return linked;
    return this.sendEscPos(bytes);
  }

  /** Quick connectivity check used by printer settings. */
  async testConnection(
    host = MHARMAL_DEFAULT_HOST,
    port = MHARMAL_DEFAULT_PORT,
  ): Promise<{ success: boolean; message?: string }> {
    return this.connect(host, port);
  }

  private sendEscPos(bytes: Uint8Array): { success: boolean; message?: string } {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, message: 'Mharmal WebSocket is not connected.' };
    }

    try {
      // Single Base64 text frame of ESC/POS bytes (avoids double-print if both
      // formats were processed). Magmal accepts Base64 and raw ESC/POS.
      this.ws.send(this.toBase64(bytes));
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to send print job to Mharmal.',
      };
    }
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

  private encodeReceipt(text: string): Uint8Array {
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

  private toBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
}
