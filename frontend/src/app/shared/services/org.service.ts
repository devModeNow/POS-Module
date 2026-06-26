import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { apiClient } from './api-client';

export interface OrgContext {
  id: number | null;
  code: string | null;
  name: string | null;
}

export interface OrgListItem {
  id: number;
  code: string;
  name: string;
  description: string | null;
  address: string | null;
  contact: string | null;
  email: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMenu {
  id: number;
  menuKey: string;
  menuLabel: string;
  menuIcon: string | null;
  menuOrder: number;
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class OrgService {
  private readonly contextSubject = new BehaviorSubject<OrgContext>({ id: null, code: null, name: null });
  readonly context$ = this.contextSubject.asObservable();

  setContext(ctx: OrgContext): void {
    this.contextSubject.next(ctx);
  }

  getContext(): OrgContext {
    return this.contextSubject.value;
  }

  getOrgId(): number | null {
    return this.contextSubject.value.id;
  }

  getOrgCode(): string | null {
    return this.contextSubject.value.code;
  }

  isPlatformUser(): boolean {
    return this.contextSubject.value.id === null;
  }

  isPosOrg(): boolean {
    const code = this.contextSubject.value.code;
    return code === 'point-of-sales' || code === 'pos';
  }

  reset(): void {
    this.contextSubject.next({ id: null, code: null, name: null });
  }

  async getPublicOrgs(): Promise<Array<{ id: number; code: string; name: string; logoUrl: string | null }>> {
    try {
      const response = await apiClient.get<{ success: boolean; data?: Array<{ id: number; code: string; name: string; logoUrl: string | null }> }>('/organizations/public');
      return response.data.data ?? [];
    } catch {
      return [];
    }
  }

  async getAll(): Promise<{ success: boolean; data?: OrgListItem[]; message?: string }> {
    const response = await apiClient.get<{ success: boolean; data?: OrgListItem[]; message?: string }>('/organizations');
    return response.data;
  }

  async getOne(id: number): Promise<{ success: boolean; data?: OrgListItem; message?: string }> {
    const response = await apiClient.get<{ success: boolean; data?: OrgListItem; message?: string }>(`/organizations/${id}`);
    return response.data;
  }

  async getMenus(orgId: number): Promise<OrgMenu[]> {
    const response = await apiClient.get<{ success: boolean; data?: OrgMenu[] }>(`/organizations/${orgId}/menus`);
    return response.data.data ?? [];
  }

  async create(payload: { code: string; name: string; description?: string; address?: string; contact?: string; email?: string }): Promise<{ success: boolean; id?: number; message?: string }> {
    const response = await apiClient.post<{ success: boolean; id?: number; message?: string }>('/organizations', payload);
    return response.data;
  }

  async update(id: number, payload: Partial<{ code: string; name: string; description: string; address: string; contact: string; email: string; isActive: boolean }>): Promise<{ success: boolean; data?: OrgListItem; message?: string }> {
    const response = await apiClient.patch<{ success: boolean; data?: OrgListItem; message?: string }>(`/organizations/${id}`, payload);
    return response.data;
  }

  async activate(id: number): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.patch<{ success: boolean; message?: string }>(`/organizations/${id}/activate`, {});
    return response.data;
  }

  async deactivate(id: number): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.patch<{ success: boolean; message?: string }>(`/organizations/${id}/deactivate`, {});
    return response.data;
  }
}
