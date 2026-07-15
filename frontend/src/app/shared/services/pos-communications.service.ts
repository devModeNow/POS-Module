import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export type PosChatUser = {
  id: number;
  name: string;
  roleName: string | null;
  profilePicture?: string | null;
  isOnline: boolean;
  lastSeen?: string | null;
};

export type PosChatMessage = {
  id: number;
  senderId: number;
  recipientId?: number | null;
  senderName: string;
  roleName: string | null;
  senderProfilePicture?: string | null;
  message: string;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  createdAt: string;
};

export type PosNotification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  referenceType: string | null;
  referenceId: number | null;
  isRead: boolean;
  createdAt: string;
};

export type PosReceiptTemplateElement = {
  id: string;
  type: 'text' | 'image';
  content: string;
  x: number;
  y: number;
  width?: number;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
};

export type PosPrinterConnectionType = 'browser' | 'network' | 'usb' | 'bluetooth' | 'mharmal';

export type PosPrinterSettings = {
  posReceiptPaperWidth: string;
  posReceiptShowLogo: boolean;
  posReceiptFooterText: string;
  posPrinterName: string;
  posReceiptTemplateJson: string;
  posPrinterConnectionType: PosPrinterConnectionType;
  posPrinterHost: string;
  posPrinterPort: string;
  posPrinterUsbVendorId: string;
  posPrinterUsbProductId: string;
  posPrinterUsbProductName: string;
  posPrinterBtDeviceId: string;
  posPrinterBtDeviceName: string;
  businessName?: string | null;
  businessAddress?: string | null;
  businessLogoLight?: string | null;
  businessLogoDark?: string | null;
};

export type PosSaleDetail = {
  id: number;
  saleDate: string;
  createdAt: string;
  cashier: string;
  paymentMethod: string;
  paymentStatus: string;
  amountPaid: number | null;
  changeAmount: number | null;
  discountAmount: number;
  totalAmount: number;
  itemCount: number;
  items: Array<{
    id: number;
    variantId: number;
    productName: string;
    variantName: string;
    quantitySold: number;
    unitType: string;
    unitPrice: number;
    totalAmount: number;
  }>;
};

@Injectable({ providedIn: 'root' })
export class PosCommunicationsService {
  async listChatUsers() {
    const r = await apiClient.get<{ success: boolean; data?: PosChatUser[]; message?: string }>(
      '/api/pos/communications/chat/users',
    );
    return r.data;
  }

  async listChatMessages(sinceId = 0, mode: 'team' | 'private' = 'team', recipientId?: number) {
    const params: Record<string, string> = { sinceId: String(sinceId), mode };
    if (mode === 'private' && recipientId) params['recipientId'] = String(recipientId);
    const r = await apiClient.get<{ success: boolean; data?: PosChatMessage[]; message?: string }>(
      '/api/pos/communications/chat/messages',
      { params },
    );
    return r.data;
  }

  async sendChatMessage(
    message: string,
    mode: 'team' | 'private' = 'team',
    recipientId?: number,
    image?: File | null,
  ) {
    const peer = recipientId != null ? Number(recipientId) : undefined;
    const form = new FormData();
    form.append('message', message ?? '');
    form.append('mode', mode);
    if (mode === 'private' && peer && peer > 0) form.append('recipientId', String(peer));
    if (image) form.append('image', image);
    const r = await apiClient.post<{ success: boolean; data?: PosChatMessage; message?: string }>(
      '/api/pos/communications/chat/messages',
      form,
    );
    return r.data;
  }

  async listNotifications() {
    const r = await apiClient.get<{ success: boolean; data?: PosNotification[]; message?: string }>(
      '/api/pos/communications/notifications',
    );
    return r.data;
  }

  async unreadNotificationCount() {
    const r = await apiClient.get<{ success: boolean; count?: number }>(
      '/api/pos/communications/notifications/unread-count',
    );
    return r.data;
  }

  async markNotificationsRead(id?: number) {
    const r = await apiClient.patch<{ success: boolean; message?: string }>(
      '/api/pos/communications/notifications/read',
      id ? { id } : {},
    );
    return r.data;
  }

  async getPrinterSettings() {
    const r = await apiClient.get<{ success: boolean; item?: Record<string, unknown>; message?: string }>(
      '/api/pos/printer-settings',
    );
    return r.data;
  }

  async savePrinterSettings(payload: Partial<PosPrinterSettings>) {
    const r = await apiClient.put<{ success: boolean; item?: Record<string, unknown>; message?: string }>(
      '/api/pos/printer-settings',
      {
        posReceiptPaperWidth: payload.posReceiptPaperWidth,
        posReceiptShowLogo: payload.posReceiptShowLogo != null ? String(payload.posReceiptShowLogo) : undefined,
        posReceiptFooterText: payload.posReceiptFooterText,
        posPrinterName: payload.posPrinterName,
        posReceiptTemplateJson: payload.posReceiptTemplateJson,
        posPrinterConnectionType: payload.posPrinterConnectionType,
        posPrinterHost: payload.posPrinterHost,
        posPrinterPort: payload.posPrinterPort,
        posPrinterUsbVendorId: payload.posPrinterUsbVendorId,
        posPrinterUsbProductId: payload.posPrinterUsbProductId,
        posPrinterUsbProductName: payload.posPrinterUsbProductName,
        posPrinterBtDeviceId: payload.posPrinterBtDeviceId,
        posPrinterBtDeviceName: payload.posPrinterBtDeviceName,
      },
    );
    return r.data;
  }

  async testPrinterConnection(host: string, port: number) {
    const r = await apiClient.post<{ success: boolean; message?: string }>(
      '/api/pos/printer-settings/test-connection',
      { host, port },
    );
    return r.data;
  }

  async printRawToNetworkPrinter(host: string, port: number, text: string) {
    const r = await apiClient.post<{ success: boolean; message?: string }>(
      '/api/pos/printer-settings/print-raw',
      { host, port, text },
    );
    return r.data;
  }

  parseTemplate(json: string | null | undefined): PosReceiptTemplateElement[] {
    if (!json?.trim()) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  templateElementStyle(el: PosReceiptTemplateElement): Record<string, string> {
    const transforms: string[] = [];
    if (el.align === 'center') transforms.push('translateX(-50%)');
    else if (el.align === 'right') transforms.push('translateX(-100%)');
    return {
      position: 'absolute',
      left: `${el.x}%`,
      top: `${el.y}%`,
      transform: transforms.join(' ') || 'none',
      fontSize: `${el.fontSize ?? 12}px`,
      fontWeight: el.bold ? '700' : '400',
      textAlign: el.align ?? 'left',
      maxWidth: el.type === 'image' ? `${el.width ?? 40}%` : '90%',
    };
  }

  previewTemplateText(content: string, ctx: { businessName?: string; businessAddress?: string; footer?: string }): string {
    return content
      .replace('{{businessName}}', ctx.businessName || 'Store')
      .replace('{{businessAddress}}', ctx.businessAddress || '')
      .replace('{{items}}', 'Sample Item x1 .... ₱100')
      .replace('{{total}}', '₱100.00')
      .replace('{{footer}}', ctx.footer || 'Thank you!');
  }
}
