import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { apiClient } from '../../shared/services/api-client';

type PageState = 'loading' | 'ready' | 'uploading' | 'success' | 'already-setup' | 'error';

interface RestorationSummary {
  tablesCreated: number;
  tableNames: string[];
  usersCount: number;
  organizationsCount: number;
  rolesCount: number;
  nextSteps: string[];
}

interface SetupConnectionStatus {
  connected: boolean;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  mode: string;
  schema: string;
  latencyMs: number;
  checkedAt: string;
  serverVersion?: string;
  code?: string;
  error?: string;
  hint?: string;
}

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './setup.component.html',
})
export class SetupComponent implements OnInit {
  state: PageState = 'loading';
  errorMessage = '';
  successMessage = '';
  uploadProgress = '';
  isDragOver = false;
  selectedFile: File | null = null;
  summary: RestorationSummary | null = null;
  connection: SetupConnectionStatus | null = null;
  checkingConnection = false;
  apiUnreachable = false;

  constructor(private readonly router: Router) {}

  ngOnInit(): void {
    void this.checkStatus();
  }

  get connectionTarget(): string {
    if (!this.connection) {
      return '';
    }
    return `${this.connection.host}:${this.connection.port}`;
  }

  async checkStatus(): Promise<void> {
    this.state = 'loading';
    this.apiUnreachable = false;
    this.checkingConnection = true;
    try {
      const r = await apiClient.get<{
        success: boolean;
        data?: { isSetupComplete: boolean; connection?: SetupConnectionStatus };
      }>('/setup/status');
      this.connection = r.data.data?.connection ?? null;
      if (r.data.success && r.data.data?.isSetupComplete) {
        this.state = 'already-setup';
      } else {
        this.state = 'ready';
      }
    } catch {
      this.state = 'ready';
      this.connection = null;
      this.apiUnreachable = true;
    } finally {
      this.checkingConnection = false;
    }
  }

  async recheckConnection(): Promise<void> {
    this.checkingConnection = true;
    this.apiUnreachable = false;
    try {
      const r = await apiClient.get<{
        success: boolean;
        data?: { connection?: SetupConnectionStatus };
      }>('/setup/connection');
      this.connection = r.data.data?.connection ?? null;
    } catch {
      this.connection = null;
      this.apiUnreachable = true;
    } finally {
      this.checkingConnection = false;
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    const file = event.dataTransfer?.files[0];
    if (file) this.selectFile(file);
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.selectFile(file);
    input.value = '';
  }

  selectFile(file: File): void {
    if (!file.name.endsWith('.sql')) {
      this.errorMessage = 'Only .sql files are accepted.';
      return;
    }
    this.selectedFile = file;
    this.errorMessage = '';
  }

  removeFile(): void {
    this.selectedFile = null;
    this.errorMessage = '';
  }

  async restore(): Promise<void> {
    if (!this.selectedFile) return;
    if (this.connection && !this.connection.connected) {
      this.errorMessage = this.connection.error || 'Cannot reach PostgreSQL.';
      return;
    }

    this.state = 'uploading';
    this.uploadProgress = 'Uploading and executing SQL...';
    this.errorMessage = '';

    const formData = new FormData();
    formData.append('file', this.selectedFile);

    try {
      const r = await apiClient.post<{ success: boolean; message?: string }>(
        '/setup/restore',
        formData,
      );
      if (r.data.success) {
        this.state = 'success';
        this.successMessage = r.data.message || 'Database restored successfully!';
        this.summary = (r.data as { data?: { summary?: RestorationSummary } }).data?.summary ?? null;
      } else {
        this.state = 'error';
        this.errorMessage = r.data.message || 'Failed to restore database.';
      }
    } catch (e: unknown) {
      this.state = 'error';
      const axiosErr = e as { response?: { data?: { message?: string } } };
      this.errorMessage = axiosErr?.response?.data?.message || 'Failed to restore. Check your SQL file.';
    }
  }

  goToLogin(): void {
    void this.router.navigateByUrl('/');
  }
}
