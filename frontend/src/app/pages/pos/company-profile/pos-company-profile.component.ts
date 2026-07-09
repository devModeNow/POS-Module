import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PosPageHeaderComponent } from '../shared/pos-page-header.component';
import {
  BusinessProfileSettings,
  BusinessSettingsService,
} from '../../../shared/services/business-settings.service';
import { ActionBusyService } from '../../../shared/services/action-busy.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { OrgService } from '../../../shared/services/org.service';
import { RbacService } from '../../../shared/services/rbac.service';

type Tab = 'profile' | 'printer';

@Component({
  selector: 'app-pos-company-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, PosPageHeaderComponent],
  templateUrl: './pos-company-profile.component.html',
  styles: `:host { display: block; height: 100%; min-height: 0; }`,
})
export class PosCompanyProfileComponent implements OnInit {
  activeTab: Tab = 'profile';
  loading = true;
  savingProfile = false;
  savingPrint = false;
  uploadingLight = false;
  uploadingDark = false;
  companyName = '';

  form = {
    businessName: '',
    businessOwner: '',
    businessContact: '',
    businessEmail: '',
    businessAddress: '',
    businessDescription: '',
  };

  preview = {
    businessLogoLight: null as string | null,
    businessLogoDark: null as string | null,
  };

  printForm = {
    posReceiptPaperWidth: '80mm',
    posReceiptShowLogo: true,
    posReceiptFooterText: '',
    paperSize: 'A4',
    showLogo: true,
    logoVariant: 'light',
    footerText: '',
  };

  constructor(
    private readonly business: BusinessSettingsService,
    private readonly notify: NotificationService,
    private readonly rbac: RbacService,
    private readonly org: OrgService,
    private readonly actionBusy: ActionBusyService,
  ) {}

  get canUpdate(): boolean {
    return this.rbac.canAccess('settings', 'canUpdate');
  }

  ngOnInit(): void {
    this.companyName = this.org.getContext().name ?? 'Company';
    void this.load();
  }

  setTab(tab: Tab): void {
    this.activeTab = tab;
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const item = await this.business.getBusinessProfile();
      this.applyProfile(item);
    } catch {
      this.notify.error('Load failed', 'Could not load company profile.');
    } finally {
      this.loading = false;
    }
  }

  async saveProfile(): Promise<void> {
    if (!this.canUpdate) {
      this.notify.warning('Permission', 'You cannot update company profile.');
      return;
    }
    this.savingProfile = true;
    try {
      await this.actionBusy.run('save-company-profile', async () => {
        const r = await this.business.updateBusinessProfile({
          businessName: this.form.businessName.trim() || null,
          businessOwner: this.form.businessOwner.trim() || null,
          businessContact: this.form.businessContact.trim() || null,
          businessEmail: this.form.businessEmail.trim() || null,
          businessAddress: this.form.businessAddress.trim() || null,
          businessDescription: this.form.businessDescription.trim() || null,
        });
        if (!r.success) {
          this.notify.error('Save failed', r.message ?? 'Could not save profile.');
          return;
        }
        this.applyProfile(r.item ?? null);
        this.notify.success('Saved', 'Company profile updated.');
      });
    } finally {
      this.savingProfile = false;
    }
  }

  async savePrintSettings(): Promise<void> {
    if (!this.canUpdate) {
      this.notify.warning('Permission', 'You cannot update printer settings.');
      return;
    }
    this.savingPrint = true;
    try {
      await this.actionBusy.run('save-print-settings', async () => {
        const r = await this.business.updateBusinessProfile({
          printPaperSize: this.printForm.paperSize || 'A4',
          printShowLogo: String(this.printForm.showLogo),
          printLogoVariant: this.printForm.logoVariant || 'light',
          printFooterText: this.printForm.footerText.trim() || null,
          posReceiptPaperWidth: this.printForm.posReceiptPaperWidth.trim() || '80mm',
          posReceiptShowLogo: String(this.printForm.posReceiptShowLogo),
          posReceiptFooterText: this.printForm.posReceiptFooterText.trim() || null,
        });
        if (!r.success) {
          this.notify.error('Save failed', r.message ?? 'Could not save print settings.');
          return;
        }
        this.applyProfile(r.item ?? null);
        this.notify.success('Saved', 'Printer settings updated.');
      });
    } finally {
      this.savingPrint = false;
    }
  }

  async onUploadLogo(mode: 'light' | 'dark', event: Event): Promise<void> {
    if (!this.canUpdate) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.notify.warning('Invalid file', 'Please choose an image file.');
      return;
    }
    if (mode === 'light') this.uploadingLight = true;
    else this.uploadingDark = true;
    try {
      await this.actionBusy.run(`upload-logo-${mode}`, async () => {
        const r = await this.business.uploadBusinessLogo(mode, file);
        if (!r.success) {
          this.notify.error('Upload failed', r.message ?? 'Could not upload logo.');
          return;
        }
        this.applyProfile(r.item ?? null);
        this.notify.success('Uploaded', `${mode === 'light' ? 'Light' : 'Dark'} logo updated.`);
      });
    } finally {
      if (mode === 'light') this.uploadingLight = false;
      else this.uploadingDark = false;
      input.value = '';
    }
  }

  private applyProfile(item: BusinessProfileSettings | null): void {
    if (!item) return;
    this.form = {
      businessName: item.businessName ?? '',
      businessOwner: item.businessOwner ?? '',
      businessContact: item.businessContact ?? '',
      businessEmail: item.businessEmail ?? '',
      businessAddress: item.businessAddress ?? '',
      businessDescription: item.businessDescription ?? '',
    };
    this.preview = {
      businessLogoLight: item.businessLogoLight ?? item.businessLogo ?? '/images/fwdslogo.png',
      businessLogoDark: item.businessLogoDark ?? item.businessLogo ?? '/images/fwdslogo-dark.png',
    };
    this.printForm = {
      posReceiptPaperWidth: item.posReceiptPaperWidth ?? '80mm',
      posReceiptShowLogo: String(item.posReceiptShowLogo ?? 'true') === 'true',
      posReceiptFooterText: item.posReceiptFooterText ?? '',
      paperSize: item.printPaperSize ?? 'A4',
      showLogo: String(item.printShowLogo ?? 'true') === 'true',
      logoVariant: item.printLogoVariant ?? 'light',
      footerText: item.printFooterText ?? '',
    };
    if (item.businessName?.trim()) {
      this.companyName = item.businessName.trim();
    }
  }
}
