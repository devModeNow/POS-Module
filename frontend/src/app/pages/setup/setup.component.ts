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

  constructor(private readonly router: Router) {}

  ngOnInit(): void {
    void this.checkStatus();
  }

  async checkStatus(): Promise<void> {
    this.state = 'loading';
    try {
      const r = await apiClient.get<{ success: boolean; data?: { isSetupComplete: boolean } }>(
        '/setup/status',
      );
      if (r.data.success && r.data.data?.isSetupComplete) {
        this.state = 'already-setup';
      } else {
        this.state = 'ready';
      }
    } catch {
      this.state = 'ready';
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
        this.summary = (r.data as any).data?.summary ?? null;
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
