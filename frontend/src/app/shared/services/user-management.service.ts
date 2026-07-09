import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface UserApiItem {
  id: number;
  username: string;
  fullname?: string | null;
  fullName?: string | null;
  full_name?: string | null;
  email?: string | null;
  roleId?: number | null;
  roleid?: number | null;
  role_id?: number | null;
  roleName?: string | null;
  rolename?: string | null;
  roleMenus?: string | null;
  rolemenus?: string | null;
  rolePermission?: string | null;
  rolepermission?: string | null;
  status?: number | string | null;
  isDeleted?: boolean | string | number | null;
  is_deleted?: boolean | string | number | null;
  deletedAt?: string | null;
  deleted_at?: string | null;
  birthdate?: string | null;
  address?: string | null;
  contact?: string | null;
  orgId?: number | null;
  orgName?: string | null;
  orgCode?: string | null;
  profilePicture?: string | null;
}

export interface RoleApiItem {
  id: number;
  roleName?: string | null;
  rolename?: string | null;
  roleMenus?: string | null;
  rolemenus?: string | null;
  rolePermission?: string | null;
  rolepermission?: string | null;
  orgId?: number | null;
}

export interface PermissionKeyApiItem {
  key: string;
  label: string;
  module: string;
  scope: 'feature' | 'menu' | 'tab' | 'action' | string;
}

export interface CreatePermissionKeyPayload {
  key: string;
  label: string;
  module: string;
  scope: 'feature' | 'menu' | 'tab' | 'action';
}

export interface RolePermissionApiItem {
  permissionKey: string;
  label: string;
  module: string;
  scope: 'feature' | 'menu' | 'tab' | 'action' | string;
}

export interface UserPermissionOverrideApiItem {
  permissionKey: string;
  effect: 'allow' | 'deny';
  reason?: string | null;
}

export interface UserEffectivePermissionApiItem {
  permissionKey: string;
  permissionLabel: string;
  module: string;
  scope: 'feature' | 'menu' | 'tab' | 'action' | string;
  isAllowed: boolean;
  source: 'role' | 'user-allow' | 'user-deny' | 'none' | string;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  fullname: string;
  birthdate?: string;
  address?: string;
  email?: string;
  contact?: string;
  status?: number;
  roleId?: number;
  orgId?: number | null;
}

interface ApiListResponse<TItem> {
  success: boolean;
  message?: string;
  data?: TItem[];
}

interface ApiCreateResponse {
  success: boolean;
  message?: string;
  id?: number;
}

interface ApiItemResponse<TItem> {
  success: boolean;
  message?: string;
  data?: TItem;
}

@Injectable({
  providedIn: 'root',
})
export class UserManagementService {
  async getUsers(includeDeleted = false, orgId?: number | null): Promise<ApiListResponse<UserApiItem>> {
    const params: Record<string, string> = {};
    if (includeDeleted) params['includeDeleted'] = 'true';
    if (orgId) params['orgId'] = String(orgId);
    const response = await apiClient.get<ApiListResponse<UserApiItem>>('/users', {
      params: Object.keys(params).length ? params : undefined,
    });
    return response.data;
  }

  async getRoles(orgId?: number | null): Promise<ApiListResponse<RoleApiItem>> {
    const response = await apiClient.get<ApiListResponse<RoleApiItem>>('/users/roles', {
      params: orgId ? { orgId: String(orgId) } : undefined,
    });
    return response.data;
  }

  async getPermissionKeys(): Promise<ApiListResponse<PermissionKeyApiItem>> {
    const response = await apiClient.get<ApiListResponse<PermissionKeyApiItem>>('/users/permission-keys');
    return response.data;
  }

  async createPermissionKey(payload: CreatePermissionKeyPayload): Promise<ApiListResponse<PermissionKeyApiItem>> {
    const response = await apiClient.post<ApiListResponse<PermissionKeyApiItem>>('/users/permission-keys', payload);
    return response.data;
  }

  async getRolePermissions(roleId: number): Promise<ApiListResponse<RolePermissionApiItem>> {
    const response = await apiClient.get<ApiListResponse<RolePermissionApiItem>>(`/users/roles/${roleId}/permissions`);
    return response.data;
  }

  async saveRolePermissions(roleId: number, permissionKeys: string[]): Promise<ApiListResponse<RolePermissionApiItem>> {
    const response = await apiClient.put<ApiListResponse<RolePermissionApiItem>>(
      `/users/roles/${roleId}/permissions`,
      { permissionKeys },
    );
    return response.data;
  }

  async getUserPermissionOverrides(userId: number): Promise<ApiListResponse<UserPermissionOverrideApiItem>> {
    const response = await apiClient.get<ApiListResponse<UserPermissionOverrideApiItem>>(`/users/${userId}/permission-overrides`);
    return response.data;
  }

  async saveUserPermissionOverrides(
    userId: number,
    overrides: UserPermissionOverrideApiItem[],
  ): Promise<{ success: boolean; message?: string; data?: UserPermissionOverrideApiItem[] }> {
    const response = await apiClient.put<{ success: boolean; message?: string; data?: UserPermissionOverrideApiItem[] }>(
      `/users/${userId}/permission-overrides`,
      { overrides },
    );
    return response.data;
  }

  async getUserEffectivePermissions(userId: number): Promise<ApiListResponse<UserEffectivePermissionApiItem>> {
    const response = await apiClient.get<ApiListResponse<UserEffectivePermissionApiItem>>(`/users/${userId}/effective-permissions`);
    return response.data;
  }

  async createUser(payload: CreateUserPayload): Promise<ApiCreateResponse> {
    const response = await apiClient.post<ApiCreateResponse>('/users', payload);
    return response.data;
  }

  async getMe(): Promise<ApiItemResponse<UserApiItem>> {
    const response = await apiClient.get<ApiItemResponse<UserApiItem>>('/users/me');
    return response.data;
  }

  async updateMe(payload: Partial<CreateUserPayload>): Promise<ApiCreateResponse> {
    const response = await apiClient.patch<ApiCreateResponse>('/users/me', payload);
    return response.data;
  }

  async uploadMyProfilePicture(file: File): Promise<ApiItemResponse<UserApiItem>> {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<ApiItemResponse<UserApiItem>>('/users/me/profile-picture', form);
    return response.data;
  }

  async removeMyProfilePicture(): Promise<ApiItemResponse<UserApiItem>> {
    const response = await apiClient.delete<ApiItemResponse<UserApiItem>>('/users/me/profile-picture');
    return response.data;
  }

  async getUserById(userId: number): Promise<ApiItemResponse<UserApiItem>> {
    const response = await apiClient.get<ApiItemResponse<UserApiItem>>(`/users/${userId}`);
    return response.data;
  }

  async updateUser(userId: number, payload: Partial<CreateUserPayload>): Promise<ApiCreateResponse> {
    const response = await apiClient.patch<ApiCreateResponse>(`/users/${userId}`, payload);
    return response.data;
  }

  async deleteUser(userId: number): Promise<ApiCreateResponse> {
    const response = await apiClient.delete<ApiCreateResponse>(`/users/${userId}`);
    return response.data;
  }

  async restoreUser(userId: number): Promise<ApiCreateResponse> {
    const response = await apiClient.patch<ApiCreateResponse>(`/users/${userId}/restore`, {});
    return response.data;
  }
}
