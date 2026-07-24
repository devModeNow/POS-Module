import axios, { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import {
  clearAccessToken,
  getAccessToken,
  getRefreshToken,
  isSessionPersistent,
  setSessionTokens,
  setStoredDeniedPermissionKeys,
  setStoredEffectivePermissionKeys,
} from './auth-storage';

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/**
 * API base URL resolution (build-time via @ngx-env/builder):
 * 1) NG_APP_API_BASE_URL from .env / .env.production / Docker build-arg
 * 2) localhost → http://localhost:3000
 * 3) production fallback → same-origin /api (only if env was missing at build)
 *
 * Browsers cannot read .env at runtime. Rebuild the frontend image after changing the API URL.
 */
const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const rawConfiguredApiBaseUrl = String(appEnv?.['NG_APP_API_BASE_URL'] ?? '').trim().replace(/\/+$/, '');
const hostName = String(globalThis.location?.hostname ?? '').trim().toLowerCase();
const isLocalHost = hostName === 'localhost' || hostName === '127.0.0.1';
const isLocalApiUrl =
  rawConfiguredApiBaseUrl.includes('localhost') || rawConfiguredApiBaseUrl.includes('127.0.0.1');

// Never ship a localhost API URL to a real deployed host.
const configuredApiBaseUrl =
  rawConfiguredApiBaseUrl && !(!isLocalHost && isLocalApiUrl) ? rawConfiguredApiBaseUrl : '';

if (!configuredApiBaseUrl && !isLocalHost) {
  console.warn(
    '[api-client] NG_APP_API_BASE_URL is missing in this build. Using same-origin /api fallback. ' +
      'Rebuild frontend with NG_APP_API_BASE_URL=https://api-pcmazepos.pcmazing.com',
  );
}

export const API_BASE_URL = (
  configuredApiBaseUrl || (isLocalHost ? 'http://localhost:3000' : `${globalThis.location?.origin ?? ''}/api`)
).replace(/\/+$/, '');

console.info('[api-client] API_BASE_URL =', API_BASE_URL);

const ACTIVE_BRANCH_STORAGE_KEY = 'activeBranchId';
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function notifyRefreshQueue(token: string | null): void {
  refreshQueue.forEach((resolve) => resolve(token));
  refreshQueue = [];
}

function extractUserIdFromJwt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payloadBase64);
    const payload = JSON.parse(decoded) as { sub?: string | number };
    const userId = Number(payload?.sub);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

function getActiveBranchIdFromStorage(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(ACTIVE_BRANCH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const branchId = Number(raw);
  return Number.isFinite(branchId) && branchId > 0 ? branchId : null;
}

async function syncEffectivePermissionKeysWithToken(accessToken: string): Promise<void> {
  const userId = extractUserIdFromJwt(accessToken);
  if (!userId) {
    return;
  }

  try {
    const response = await axios.get<{
      success: boolean;
      data?: Array<{ permissionKey: string; isAllowed: boolean }>;
    }>(`${API_BASE_URL}/users/${userId}/effective-permissions`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.data?.success) {
      return;
    }

    const keys = (response.data.data ?? [])
      .filter((item) => item.isAllowed)
      .map((item) => String(item.permissionKey ?? '').trim())
      .filter((item) => item.length > 0);

    const deniedKeys = (response.data.data ?? [])
      .filter((item) => !item.isAllowed)
      .map((item) => String(item.permissionKey ?? '').trim())
      .filter((item) => item.length > 0);

    setStoredEffectivePermissionKeys(keys, isSessionPersistent());
    setStoredDeniedPermissionKeys(deniedKeys, isSessionPersistent());
  } catch {
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  try {
    const response = await axios.post<{
      success: boolean;
      accessToken?: string;
      refreshToken?: string;
    }>(`${API_BASE_URL}/login/refresh`, { refreshToken });

    if (response.data.success && response.data.accessToken && response.data.refreshToken) {
      setSessionTokens(
        response.data.accessToken,
        response.data.refreshToken,
        isSessionPersistent(),
      );

      void syncEffectivePermissionKeysWithToken(response.data.accessToken);

      return response.data.accessToken;
    }

    return null;
  } catch {
    return null;
  }
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  const activeBranchId = getActiveBranchIdFromStorage();

  config.headers ??= new AxiosHeaders();

  // Let the browser set multipart boundary for file uploads.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (config.headers instanceof AxiosHeaders) {
      config.headers.delete('Content-Type');
    } else {
      delete (config.headers as Record<string, string>)['Content-Type'];
    }
  } else if (config.headers instanceof AxiosHeaders) {
    const contentType = config.headers.get('Content-Type');
    if (typeof contentType === 'string' && contentType.startsWith('multipart/form-data')) {
      config.headers.delete('Content-Type');
    }
  } else {
    const headers = config.headers as Record<string, string>;
    if (headers['Content-Type']?.startsWith('multipart/form-data')) {
      delete headers['Content-Type'];
    }
  }

  if (config.headers instanceof AxiosHeaders) {
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }

    if (activeBranchId) {
      config.headers.set('x-active-branch-id', String(activeBranchId));
    } else {
      config.headers.delete('x-active-branch-id');
    }
  } else {
    const headers = config.headers as Record<string, string>;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (activeBranchId) {
      headers['x-active-branch-id'] = String(activeBranchId);
    } else {
      delete headers['x-active-branch-id'];
    }
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status as number | undefined;
    const originalRequest = error?.config as RetryConfig | undefined;

    if (status !== 401 || !originalRequest || originalRequest._retry) {
      if (status === 401) {
        clearAccessToken();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((newToken) => {
          if (!newToken) {
            reject(error);
            return;
          }

          originalRequest.headers ??= new AxiosHeaders();
          if (originalRequest.headers instanceof AxiosHeaders) {
            originalRequest.headers.set('Authorization', `Bearer ${newToken}`);
          } else {
            (originalRequest.headers as Record<string, string>)['Authorization'] =
              `Bearer ${newToken}`;
          }

          resolve(apiClient(originalRequest));
        });
      });
    }

    isRefreshing = true;

    try {
      const nextToken = await refreshAccessToken();
      if (!nextToken) {
        clearAccessToken();
        notifyRefreshQueue(null);
        return Promise.reject(error);
      }

      notifyRefreshQueue(nextToken);
      originalRequest.headers ??= new AxiosHeaders();
      if (originalRequest.headers instanceof AxiosHeaders) {
        originalRequest.headers.set('Authorization', `Bearer ${nextToken}`);
      } else {
        (originalRequest.headers as Record<string, string>)['Authorization'] =
          `Bearer ${nextToken}`;
      }

      return apiClient(originalRequest);
    } finally {
      isRefreshing = false;
    }
  },
);
