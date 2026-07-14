import { Injectable } from '@angular/core';

/** Common BLE GATT services used by thermal / portable receipt printers. */
const PRINTER_SERVICE_UUIDS = [
  // Nordic UART Service (NUS) — common on BLE thermal printers
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  // Generic “FFE0” serial service used by many Chinese BLE POS printers
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  // Hot printer / ESC-POS BLE adapters
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
 * Thin wrapper around the Web Bluetooth API for sending plain-text /
 * ESC/POS-style receipts to a BLE thermal printer.
 * Requires Chrome/Edge on desktop or Android (HTTPS / localhost).
 * Classic (non-BLE) Bluetooth printers are not supported by browsers —
 * pair those via OS settings and use Browser Print Dialog instead.
 */
@Injectable({ providedIn: 'root' })
export class PosBluetoothPrinterService {
  private device: BluetoothDeviceLike | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristicLike | null = null;

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
      device.addEventListener('gattserverdisconnected', () => {
        this.writeChar = null;
      });
      // Probe connect so the user learns early if GATT fails
      await this.connectAndResolveWriteChar(device);
      return this.toInfo(device);
    } catch {
      return null;
    }
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
            'Connected, but no writable Bluetooth characteristic was found. This printer may use classic Bluetooth — pair it in OS settings and use Browser Print Dialog instead.',
        };
      }

      const payload = new TextEncoder().encode(`${text}\n\n\n`);
      await this.writeInChunks(char, payload);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to print via Bluetooth.',
      };
    }
  }

  private async resolveDevice(bt: BluetoothLike, deviceId: string): Promise<BluetoothDeviceLike | null> {
    if (this.device?.id === deviceId) return this.device;
    if (typeof bt.getDevices === 'function') {
      const known = await bt.getDevices();
      const found = known.find((d) => d.id === deviceId) ?? null;
      if (found) this.device = found;
      return found;
    }
    return null;
  }

  private async connectAndResolveWriteChar(
    device: BluetoothDeviceLike,
  ): Promise<BluetoothRemoteGATTCharacteristicLike | null> {
    if (!device.gatt) return null;
    if (!device.gatt.connected) await device.gatt.connect();

    // Prefer known printer services first, then scan all primary services.
    for (const uuid of PRINTER_SERVICE_UUIDS) {
      try {
        const service = await device.gatt.getPrimaryService(uuid);
        const char = await this.findWritableCharacteristic(service);
        if (char) {
          this.writeChar = char;
          return char;
        }
      } catch {
        // Service not present on this device — try the next UUID.
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
      // Some platforms reject unrestricted primary-service scans.
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
    // Stay under typical BLE ATT MTU (20 bytes without negotiation).
    const chunkSize = 20;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.slice(offset, offset + chunkSize);
      if (char.properties.writeWithoutResponse && char.writeValueWithoutResponse) {
        await char.writeValueWithoutResponse(chunk);
      } else {
        await char.writeValue(chunk);
      }
      // Small delay so low-end printer controllers keep up.
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
