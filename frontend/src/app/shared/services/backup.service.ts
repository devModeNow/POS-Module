import { Injectable } from '@angular/core';
import { apiClient } from './api-client';
import type {
  BackupMetadata,
  CreateBackupParams,
  CreateBackupResponse,
  DeleteBackupResponse,
} from '../interfaces/backup.interfaces';

/**
 * Service for managing database backup operations.
 * Communicates with the backend /backups REST API endpoints.
 *
 * @see Requirements 2.3, 3.1, 5.2, 6.3
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  /**
   * Retrieves the list of all backups sorted by creation date descending.
   * GET /backups → BackupMetadata[]
   */
  async listBackups(): Promise<BackupMetadata[]> {
    const response = await apiClient.get<BackupMetadata[]>('/backups');
    return response.data;
  }

  /**
   * Triggers a new database backup with the specified type and format.
   * POST /backups → CreateBackupResponse
   */
  async createBackup(params: CreateBackupParams): Promise<CreateBackupResponse> {
    const response = await apiClient.post<CreateBackupResponse>('/backups', params);
    return response.data;
  }

  /**
   * Downloads a completed backup file by ID.
   * GET /backups/:id/download with responseType: 'blob'
   * Returns the full axios response so the caller can access Content-Disposition headers
   * for filename extraction.
   */
  async downloadBackup(id: string) {
    const response = await apiClient.get(`/backups/${id}/download`, {
      responseType: 'blob',
    });
    return response;
  }

  /**
   * Deletes a backup by ID.
   * DELETE /backups/:id → DeleteBackupResponse
   */
  async deleteBackup(id: string): Promise<DeleteBackupResponse> {
    const response = await apiClient.delete<DeleteBackupResponse>(`/backups/${id}`);
    return response.data;
  }
}
