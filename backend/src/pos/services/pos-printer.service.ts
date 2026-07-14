import { Injectable } from '@nestjs/common';
import { Socket } from 'net';

const CONNECT_TIMEOUT_MS = 4000;
const DEFAULT_PORT = 9100;

@Injectable()
export class PosPrinterService {
  async testConnection(host: string, port: number): Promise<{ success: boolean; message?: string }> {
    const targetHost = (host ?? '').trim();
    const targetPort = port > 0 ? port : DEFAULT_PORT;
    if (!targetHost) return { success: false, message: 'Printer host/IP is required' };

    try {
      await this.connect(targetHost, targetPort, (socket) => { socket.end(); });
      return { success: true, message: `Connected to ${targetHost}:${targetPort}` };
    } catch (error) {
      return { success: false, message: this.connectErrorMessage(error, targetHost, targetPort) };
    }
  }

  async printRaw(host: string, port: number, text: string): Promise<{ success: boolean; message?: string }> {
    const targetHost = (host ?? '').trim();
    const targetPort = port > 0 ? port : DEFAULT_PORT;
    if (!targetHost) return { success: false, message: 'Printer host/IP is required' };
    if (!text) return { success: false, message: 'Nothing to print' };

    try {
      await this.connect(targetHost, targetPort, (socket) =>
        new Promise<void>((resolve, reject) => {
          const payload = Buffer.concat([
            Buffer.from(text, 'utf8'),
            Buffer.from([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]), // feed + partial-cut (ESC/POS best-effort)
          ]);
          socket.write(payload, (err) => {
            if (err) { reject(err); return; }
            socket.end();
            resolve();
          });
        }),
      );
      return { success: true, message: `Sent to ${targetHost}:${targetPort}` };
    } catch (error) {
      return { success: false, message: this.connectErrorMessage(error, targetHost, targetPort) };
    }
  }

  private connect(
    host: string,
    port: number,
    onConnect: (socket: Socket) => void | Promise<void>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        if (err) reject(err); else resolve();
      };

      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once('timeout', () => finish(new Error('Connection timed out')));
      socket.once('error', (err) => finish(err));
      socket.once('close', () => finish());

      socket.connect(port, host, () => {
        void Promise.resolve(onConnect(socket))
          .then(() => finish())
          .catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
      });
    });
  }

  private connectErrorMessage(error: unknown, host: string, port: number): string {
    const raw = error instanceof Error ? error.message : String(error);
    return `Could not reach printer at ${host}:${port} (${raw})`;
  }
}
