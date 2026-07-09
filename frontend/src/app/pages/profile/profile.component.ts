import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { UserManagementService } from '../../shared/services/user-management.service';
import { NotificationService } from '../../shared/services/notification.service';
import { ActionBusyService } from '../../shared/services/action-busy.service';
import { PROFILE_PICTURE_SESSION_KEY } from '../../shared/services/profile.constants';
import { RbacService } from '../../shared/services/rbac.service';
import { PosPageHeaderComponent } from '../pos/shared/pos-page-header.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, PosPageHeaderComponent],
  templateUrl: './profile.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class ProfileComponent implements OnInit {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  readonly isCashierMode: boolean;

  loading = true;
  saving = false;
  uploadingPicture = false;
  profilePicture = '';

  form = {
    fullname: '',
    username: '',
    email: '',
    contact: '',
    address: '',
    birthdate: '',
    password: '',
    confirmPassword: '',
  };

  meta = {
    roleName: '',
    orgName: '',
  };

  constructor(
    private readonly users: UserManagementService,
    private readonly notify: NotificationService,
    private readonly actionBusy: ActionBusyService,
    rbac: RbacService,
  ) {
    this.isCashierMode = rbac.isCashier();
  }

  get initials(): string {
    const source = this.form.fullname.trim() || this.form.username.trim() || '?';
    return source.charAt(0).toUpperCase();
  }

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await this.users.getMe();
      if (!r.success || !r.data) {
        this.notify.error('Load failed', r.message ?? 'Could not load profile.');
        return;
      }
      const d = r.data;
      this.form = {
        fullname: String(d.fullname ?? d.fullName ?? '').trim(),
        username: String(d.username ?? '').trim(),
        email: String(d.email ?? '').trim(),
        contact: String(d.contact ?? '').trim(),
        address: String(d.address ?? '').trim(),
        birthdate: this.normalizeDate(String(d.birthdate ?? '').trim()),
        password: '',
        confirmPassword: '',
      };
      this.meta = {
        roleName: String(d.roleName ?? '').trim(),
        orgName: String(d.orgName ?? '').trim(),
      };
      this.setProfilePicture(String(d.profilePicture ?? '').trim());
    } finally {
      this.loading = false;
    }
  }

  async onPictureSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.notify.warning('Invalid file', 'Please choose an image file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.notify.warning('File too large', 'Image must be under 2MB.');
      return;
    }

    this.uploadingPicture = true;
    try {
      await this.actionBusy.run('profile-picture-upload', async () => {
        const r = await this.users.uploadMyProfilePicture(file);
        if (!r.success || !r.data) {
          this.notify.error('Upload failed', r.message ?? 'Could not upload profile picture.');
          return;
        }
        this.setProfilePicture(String(r.data.profilePicture ?? '').trim());
        this.notify.success('Updated', 'Profile picture updated.');
      });
    } catch (error) {
      this.notify.error('Upload failed', this.extractErrorMessage(error, 'Could not upload profile picture.'));
    } finally {
      this.uploadingPicture = false;
    }
  }

  openPicturePicker(): void {
    if (this.uploadingPicture) return;
    this.fileInput?.nativeElement.click();
  }

  async removePicture(): Promise<void> {
    this.uploadingPicture = true;
    try {
      await this.actionBusy.run('profile-picture-remove', async () => {
        const r = await this.users.removeMyProfilePicture();
        if (!r.success) {
          this.notify.error('Remove failed', r.message ?? 'Could not remove profile picture.');
          return;
        }
        this.setProfilePicture('');
        this.notify.success('Removed', 'Profile picture removed.');
      });
    } catch (error) {
      this.notify.error('Remove failed', this.extractErrorMessage(error, 'Could not remove profile picture.'));
    } finally {
      this.uploadingPicture = false;
    }
  }

  async save(): Promise<void> {
    if (!this.form.fullname.trim()) {
      this.notify.warning('Required', 'Full name is required.');
      return;
    }
    if (!this.form.username.trim()) {
      this.notify.warning('Required', 'Username is required.');
      return;
    }
    if (this.form.password.trim() && this.form.password !== this.form.confirmPassword) {
      this.notify.warning('Password mismatch', 'New password and confirmation do not match.');
      return;
    }

    this.saving = true;
    try {
      await this.actionBusy.run('profile-save', async () => {
        const payload: Record<string, string> = {
          fullname: this.form.fullname.trim(),
          username: this.form.username.trim(),
          email: this.form.email.trim(),
          contact: this.form.contact.trim(),
          address: this.form.address.trim(),
          birthdate: this.form.birthdate.trim(),
        };
        if (this.form.password.trim()) {
          payload['password'] = this.form.password.trim();
        }

        const r = await this.users.updateMe(payload);
        if (!r.success) {
          this.notify.error('Save failed', r.message ?? 'Could not update profile.');
          return;
        }

        this.form.password = '';
        this.form.confirmPassword = '';
        this.notify.success('Saved', 'Profile updated successfully.');
        void this.load();
      });
    } catch (error) {
      this.notify.error('Save failed', this.extractErrorMessage(error, 'Could not update profile.'));
    } finally {
      this.saving = false;
    }
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object') {
      const response = (error as { response?: { data?: { message?: unknown } } }).response;
      const message = response?.data?.message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return fallback;
  }

  private normalizeDate(value: string): string {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }

  private setProfilePicture(value: string): void {
    this.profilePicture = value || '';
    if (this.profilePicture) {
      sessionStorage.setItem(PROFILE_PICTURE_SESSION_KEY, this.profilePicture);
    } else {
      sessionStorage.removeItem(PROFILE_PICTURE_SESSION_KEY);
    }
  }
}
