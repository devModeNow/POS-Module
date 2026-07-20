import { Injectable } from '@angular/core';
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

/** Common BLE GATT services used by thermal / portable receipt printers. */
const PRINTER_SERVICE_UUIDS = [
  // Nordic UART Service (NUS)
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  // Generic “FFE0” serial service (many Chinese BLE POS printers)
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

interface BluetoothRemoteGATTCharacteristicLike {
  uuid: string;
  properties: {
    write?: boolean;
    writeWithoutResponse?: boolean;
  };
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTServiceLike {
  uuid: string;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristicLike[]>;
}

interface BluetoothRemoteGATTServerLike {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServerLike>;
  getPrimaryServices(): Promise<BluetoothRemoteGATTServiceLike[]>;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTServiceLike>;
}

interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServerLike;
  addEventListener(type: string, listener: () => void): void;
}

interface BluetoothLike {
  requestDevice(options: Record<string, unknown>): Promise<BluetoothDeviceLike>;
  getDevices?(): Promise<BluetoothDeviceLike[]>;
}

function bluetoothApi(): BluetoothLike | null {
  return (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth ?? null;
}

export type BluetoothPrinterInfo = {
  deviceId: string;
  deviceName: string;
};

/**
 * Browser-native Web Bluetooth printer bridge (no third-party desktop app).
 * Pairs BLE thermal printers in Chrome/Edge and reconnects via getDevices()
 * after page reload when the permission is still granted.
 */
@Injectable({ providedIn: 'root' })
export class PosBluetoothPrinterService {
  private device: BluetoothDeviceLike | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristicLike | null = null;
  private lastDeviceId = '';

  isSupported(): boolean {
    return !!bluetoothApi();
  }

  async requestDevice(): Promise<BluetoothPrinterInfo | null> {
    const bt = bluetoothApi();
    if (!bt) return null;
    try {
      const device = await bt.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICE_UUIDS,
      });
      this.device = device;
      this.writeChar = null;
      this.lastDeviceId = device.id;
      device.addEventListener('gattserverdisconnected', () => {
        this.writeChar = null;
      });
      await this.connectAndResolveWriteChar(device);
      return this.toInfo(device);
    } catch {
      return null;
    }
  }

  /**
   * Reconnect to a previously permitted Bluetooth printer without prompting.
   * Returns connection info when successful.
   */
  async restoreConnection(deviceId: string): Promise<BluetoothPrinterInfo | null> {
    if (!deviceId || !this.isSupported()) return null;
    const bt = bluetoothApi();
    if (!bt) return null;
    try {
      const device = await this.resolveDevice(bt, deviceId);
      if (!device) return null;
      const char = await this.connectAndResolveWriteChar(device);
      if (!char) return null;
      this.lastDeviceId = device.id;
      return this.toInfo(device);
    } catch {
      return null;
    }
  }

  async isConnected(deviceId?: string): Promise<boolean> {
    const id = deviceId || this.lastDeviceId;
    if (!id || !this.device || this.device.id !== id) return false;
    return !!this.device.gatt?.connected && !!this.writeChar;
  }

  async printText(deviceId: string, text: string): Promise<{ success: boolean; message?: string }> {
    const bt = bluetoothApi();
    if (!bt) return { success: false, message: 'Web Bluetooth is not supported in this browser.' };
    if (!deviceId) return { success: false, message: 'No Bluetooth printer selected.' };

    try {
      const device = await this.resolveDevice(bt, deviceId);
      if (!device) {
        return {
          success: false,
          message: 'Bluetooth printer not found. Click “Select Bluetooth printer” again.',
        };
      }

      const char = await this.connectAndResolveWriteChar(device);
      if (!char) {
        return {
          success: false,
          message:
            'Connected, but no writable Bluetooth characteristic was found. This printer may use classic Bluetooth — use Network/USB or Browser Print instead.',
        };
      }

      const bytes = this.encodeReceipt(text);
      await this.writeInChunks(char, bytes);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to print via Bluetooth.',
      };
    }
  }

  async sendRawBytes(deviceId: string, data: Uint8Array): Promise<{ success: boolean; message?: string }> {
    const bt = bluetoothApi();
    if (!bt) return { success: false, message: 'Web Bluetooth is not supported in this browser.' };
    if (!deviceId) return { success: false, message: 'No Bluetooth printer selected.' };

    try {
      const device = await this.resolveDevice(bt, deviceId);
      if (!device) {
        return {
          success: false,
          message: 'Bluetooth printer not found. Click “Select Bluetooth printer” again.',
        };
      }

      const char = await this.connectAndResolveWriteChar(device);
      if (!char) {
        return {
          success: false,
          message: 'Connected, but no writable Bluetooth characteristic was found.',
        };
      }

      await this.writeInChunks(char, data);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to send to Bluetooth printer.',
      };
    }
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

  private async resolveDevice(bt: BluetoothLike, deviceId: string): Promise<BluetoothDeviceLike | null> {
    if (this.device?.id === deviceId) return this.device;
    if (typeof bt.getDevices === 'function') {
      const known = await bt.getDevices();
      const found = known.find((d) => d.id === deviceId) ?? null;
      if (found) {
        this.device = found;
        found.addEventListener('gattserverdisconnected', () => {
          this.writeChar = null;
        });
      }
      return found;
    }
    return null;
  }

  private async connectAndResolveWriteChar(
    device: BluetoothDeviceLike,
  ): Promise<BluetoothRemoteGATTCharacteristicLike | null> {
    if (!device.gatt) return null;
    if (!device.gatt.connected) await device.gatt.connect();

    for (const uuid of PRINTER_SERVICE_UUIDS) {
      try {
        const service = await device.gatt.getPrimaryService(uuid);
        const char = await this.findWritableCharacteristic(service);
        if (char) {
          this.writeChar = char;
          return char;
        }
      } catch {
        /* try next service */
      }
    }

    try {
      const services = await device.gatt.getPrimaryServices();
      for (const service of services) {
        const char = await this.findWritableCharacteristic(service);
        if (char) {
          this.writeChar = char;
          return char;
        }
      }
    } catch {
      /* unrestricted primary-service scan may be blocked */
    }

    return this.writeChar;
  }

  private async findWritableCharacteristic(
    service: BluetoothRemoteGATTServiceLike,
  ): Promise<BluetoothRemoteGATTCharacteristicLike | null> {
    const chars = await service.getCharacteristics();
    return (
      chars.find((c) => c.properties.writeWithoutResponse || c.properties.write) ?? null
    );
  }

  private async writeInChunks(
    char: BluetoothRemoteGATTCharacteristicLike,
    data: Uint8Array,
  ): Promise<void> {
    const chunkSize = 20;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.slice(offset, offset + chunkSize);
      if (char.properties.writeWithoutResponse && char.writeValueWithoutResponse) {
        await char.writeValueWithoutResponse(chunk);
      } else {
        await char.writeValue(chunk);
      }
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  private toInfo(device: BluetoothDeviceLike): BluetoothPrinterInfo {
    return {
      deviceId: device.id,
      deviceName: device.name?.trim() || 'Bluetooth Printer',
    };
  }
}
