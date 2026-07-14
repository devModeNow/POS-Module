import { Injectable } from '@angular/core';

interface UsbEndpointLike { endpointNumber: number; direction: 'in' | 'out'; }
interface UsbAlternateInterfaceLike { alternateSetting: number; endpoints: UsbEndpointLike[]; }
interface UsbInterfaceLike { interfaceNumber: number; alternates: UsbAlternateInterfaceLike[]; }
interface UsbConfigurationLike { configurationValue: number; interfaces: UsbInterfaceLike[]; }
interface UsbDeviceLike {
  vendorId: number;
  productId: number;
  productName?: string;
  opened: boolean;
  configuration: UsbConfigurationLike | null;
  open(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ status: string; bytesWritten: number }>;
}
interface UsbLike {
  requestDevice(options: { filters: Array<Record<string, unknown>> }): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
}

function usbApi(): UsbLike | null {
  return (navigator as unknown as { usb?: UsbLike }).usb ?? null;
}

export type UsbPrinterInfo = { vendorId: string; productId: string; productName: string };

/**
 * Thin wrapper around the WebUSB API for sending plain-text receipts to a
 * locally connected thermal printer. Only supported in Chromium-based
 * browsers (Chrome/Edge) over a secure context.
 */
@Injectable({ providedIn: 'root' })
export class PosUsbPrinterService {
  private device: UsbDeviceLike | null = null;

  isSupported(): boolean {
    return !!usbApi();
  }

  async requestDevice(): Promise<UsbPrinterInfo | null> {
    const usb = usbApi();
    if (!usb) return null;
    try {
      const device = await usb.requestDevice({ filters: [] });
      this.device = device;
      return this.toInfo(device);
    } catch {
      return null;
    }
  }

  async printText(vendorId: string, productId: string, text: string): Promise<{ success: boolean; message?: string }> {
    const usb = usbApi();
    if (!usb) return { success: false, message: 'WebUSB is not supported in this browser.' };
    if (!vendorId || !productId) return { success: false, message: 'No USB printer selected.' };

    try {
      const device = await this.resolveDevice(usb, vendorId, productId);
      if (!device) {
        return { success: false, message: 'USB printer not connected. Click "Select USB printer" again.' };
      }

      if (!device.opened) await device.open();
      if (!device.configuration) await device.selectConfiguration(1);

      const iface = device.configuration?.interfaces.find((i) =>
        i.alternates.some((a) => a.endpoints.some((e) => e.direction === 'out')),
      );
      const alt = iface?.alternates.find((a) => a.endpoints.some((e) => e.direction === 'out'));
      const endpoint = alt?.endpoints.find((e) => e.direction === 'out');
      if (!iface || !endpoint) return { success: false, message: 'No writable USB endpoint found on this device.' };

      await device.claimInterface(iface.interfaceNumber);
      const bytes = new TextEncoder().encode(`${text}\n\n\n`);
      const result = await device.transferOut(endpoint.endpointNumber, bytes);
      if (result.status !== 'ok') return { success: false, message: `USB transfer failed (${result.status}).` };
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to print via USB.' };
    }
  }

  private async resolveDevice(usb: UsbLike, vendorId: string, productId: string): Promise<UsbDeviceLike | null> {
    const wantVendor = parseInt(vendorId, 16);
    const wantProduct = parseInt(productId, 16);
    if (this.device && this.device.vendorId === wantVendor && this.device.productId === wantProduct) {
      return this.device;
    }
    const known = await usb.getDevices();
    const found = known.find((d) => d.vendorId === wantVendor && d.productId === wantProduct) ?? null;
    if (found) this.device = found;
    return found;
  }

  private toInfo(device: UsbDeviceLike): UsbPrinterInfo {
    return {
      vendorId: device.vendorId.toString(16).padStart(4, '0'),
      productId: device.productId.toString(16).padStart(4, '0'),
      productName: device.productName?.trim() || 'USB Printer',
    };
  }
}
