import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { UserManagementService } from '../../shared/services/user-management.service';
import { RbacService } from '../../shared/services/rbac.service';
import { NotificationService } from '../../shared/services/notification.service';
import { AuthService } from '../../shared/services/auth.service';
import { ActionBusyService } from '../../shared/services/action-busy.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  template: `
    <app-page-breadcrumb pageTitle="My Profile" />
    <div class="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      @if (loading) { <p class="text-sm text-gray-500">Loading profile...</p> }
      @else {
        <form class="space-y-4" (ngSubmit)="save()">
          <label class="block"><span class="mb-1 block text-sm font-medium">Full name</span>
            <input [(ngModel)]="form.fullname" name="fullname" class="w-full rounded-md border px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800" /></label>
          <label class="block"><span class="mb-1 block text-sm font-medium">Email</span>
            <input type="email" [(ngModel)]="form.email" name="email" class="w-full rounded-md border px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800" /></label>
          <label class="block"><span class="mb-1 block text-sm font-medium">Username</span>
            <input [(ngModel)]="form.username" name="username" readonly class="w-full rounded-md border bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/50" /></label>
          <label class="block"><span class="mb-1 block text-sm font-medium">New password (leave blank to keep)</span>
            <input type="password" [(ngModel)]="form.password" name="password" class="w-full rounded-md border px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800" /></label>
          <button type="submit" [disabled]="saving" class="w-full rounded-md bg-emerald-600 py-3 font-semibold text-white disabled:opacity-50">
            {{ saving ? 'Saving...' : 'Save profile' }}
          </button>
        </form>
      }
    </div>
  `,
})
export class ProfileComponent implements OnInit {
  loading = true;
  saving = false;
  form = { fullname: '', email: '', username: '', password: '' };

  constructor(
    private readonly users: UserManagementService,
    private readonly rbac: RbacService,
    private readonly notify: NotificationService,
    private readonly auth: AuthService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await this.users.getMe();
      if (!r.success || !r.data) return;
      const d = r.data;
      this.form = {
        fullname: String(d.fullname ?? d.fullName ?? '').trim(),
        email: String(d.email ?? '').trim(),
        username: String(d.username ?? '').trim(),
        password: '',
      };
    } finally {
      this.loading = false;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    try {
      await this.actionBusy.run('profile-save', async () => {
        const payload: Record<string, string> = {
          fullname: this.form.fullname,
          email: this.form.email,
        };
        if (this.form.password.trim()) payload['password'] = this.form.password.trim();
        const r = await this.users.updateMe(payload);
        if (!r.success) {
          this.notify.error('Save failed', r.message ?? 'Could not update profile.');
          return;
        }
        this.form.password = '';
        this.notify.success('Saved', 'Profile updated. Re-login if your name changed in the header.');
      });
    } finally {
      this.saving = false;
    }
  }
}
