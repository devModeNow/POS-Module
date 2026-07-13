import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, AfterViewChecked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ConfirmDialogComponent } from '../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import {
  BusinessProfileSettings,
  BusinessSettingsService,
} from '../../shared/services/business-settings.service';
import { RbacService } from '../../shared/services/rbac.service';
import {
  CreatePermissionKeyPayload,
  PermissionKeyApiItem,
  RoleApiItem,
  UserManagementService,
} from '../../shared/services/user-management.service';
import { BackupService } from '../../shared/services/backup.service';
import { InventoryService, OrgUnitType } from '../../shared/services/inventory.service';
import { OrgService } from '../../shared/services/org.service';
import { PosService } from '../../shared/services/pos.service';
import { UserManagementComponent } from '../user-management/user-management.component';
import { PosAuditTrailComponent } from '../pos/audit-trail/pos-audit-trail.component';
import { PosPrinterSettingsPanelComponent } from '../../shared/components/pos/pos-printer-settings-panel/pos-printer-settings-panel.component';
import type { BackupMetadata, BackupType, BackupFormat } from '../../shared/interfaces/backup.interfaces';
import axios from 'axios';
import { shouldPoll, extractFilename, formatBackupDate, formatFileSize, getStatusBadgeClasses, getStatusAriaLabel } from '../../shared/utils/backup-utils';

type SettingsTab = 'system' | 'print-settings' | 'void-codes' | 'user-management' | 'audit-trail' | 'rbac-configs' | 'unit-types' | 'database-backup';

interface SettingsPermissionOption {
  key: string;
  label: string;
  module: string;
  scope: 'feature' | 'menu' | 'tab' | 'action' | string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ConfirmDialogComponent, UserManagementComponent, PosAuditTrailComponent, PosPrinterSettingsPanelComponent],
  templateUrl: './settings.component.html',
  styles: ``,
})
export class SettingsComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('cancelBtn') cancelBtn!: ElementRef<HTMLButtonElement>;
  @ViewChild('lightLogoInput') lightLogoInput?: ElementRef<HTMLInputElement>;
  @ViewChild('darkLogoInput') darkLogoInput?: ElementRef<HTMLInputElement>;

  private deleteTriggerElement: HTMLElement | null = null;
  private shouldFocusDialog = false;
  private readonly defaultBusinessLogoLight = '/images/fwdslogo.png';
  private readonly defaultBusinessLogoDark = '/images/fwdslogo-dark.png';
  private readonly defaultDrTemplatePdf = '/docs/DefaultDR.pdf';

  isLoading = false;
  isSaving = false;
  isUploadingLightLogo = false;
  isUploadingDarkLogo = false;
  isRemovingLightLogo = false;
  isRemovingDarkLogo = false;
  isUploadingDrTemplate = false;
  isSavingPrint = false;
  isUploadingPreparedBySignature = false;
  isUploadingCheckedBySignature = false;
  isUploadingApprovedBySignature = false;

  uiMessage = '';
  uiError = '';
  activeTab: SettingsTab = 'system';

  isLoadingRoles = false;
  isLoadingPermissionKeys = false;
  isLoadingRolePermissions = false;
  isCreatingPermissionKey = false;
  isSavingRolePermissions = false;
  rbacError = '';
  rbacSearch = '';
  roles: Array<{ id: number; name: string }> = [];
  selectedRoleId: number | '' = '';
  permissionOptions: SettingsPermissionOption[] = [];
  rolePermissionKeys: string[] = [];

  newPermissionForm: CreatePermissionKeyPayload = {
    key: '',
    label: '',
    module: '',
    scope: 'action',
  };

  // Database Backup state
  backups: BackupMetadata[] = [];
  isLoadingBackups = false;
  isCreatingBackup = false;
  downloadingIds: Set<string> = new Set();
  deletingIds: Set<string> = new Set();
  backupError = '';
  backupMessage = '';
  backupMessageTimeout: ReturnType<typeof setTimeout> | null = null;
  pollingInterval: ReturnType<typeof setInterval> | null = null;
  backupForm: { type: BackupType; format: BackupFormat } = { type: 'full', format: 'plain' };
  showDeleteConfirm = false;
  deleteTargetId: string | null = null;

  unitTypes: OrgUnitType[] = [];
  isLoadingUnitTypes = false;
  isSavingUnitType = false;
  unitTypeForm = { code: '', label: '', isManualEntry: false };

  voidCodes: Array<{ id: number; label: string; isActive: boolean }> = [];
  voidCodeForm = { label: '', code: '' };
  showInactiveVoidCodes = false;
  voidCodeEditOpen = false;
  voidCodeEdit = { id: 0, label: '', code: '', isActive: true };
  showVoidCodeEditPassword = false;
  isSavingVoidCodeEdit = false;
  showVoidCode = false;
  isLoadingVoidCodes = false;
  isSavingVoidCode = false;

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmVariant: 'primary' | 'danger' = 'primary';
  private confirmAction: (() => void) | null = null;

  form: {
    websiteTabName: string;
    routingTabName: string;
    businessName: string;
    businessAddress: string;
    businessContact: string;
    businessEmail: string;
    businessOwner: string;
    businessDescription: string;
  } = {
    websiteTabName: '',
    routingTabName: '{route}',
    businessName: '',
    businessAddress: '',
    businessContact: '',
    businessEmail: '',
    businessOwner: '',
    businessDescription: '',
  };

  preview: {
    businessLogoLight: string | null;
    businessLogoDark: string | null;
    drTemplatePdf: string | null;
    printSignaturePreparedBy: string | null;
    printSignatureCheckedBy: string | null;
    printSignatureApprovedBy: string | null;
  } = {
    businessLogoLight: null,
    businessLogoDark: null,
    drTemplatePdf: null,
    printSignaturePreparedBy: null,
    printSignatureCheckedBy: null,
    printSignatureApprovedBy: null,
  };

  printForm: {
    paperSize: string;
    showLogo: boolean;
    logoVariant: string;
    footerText: string;
    quoteHeaderColor: string;
    quoteShowTerms: boolean;
    quoteShowMisc: boolean;
    quoteShowValidity: boolean;
    soShowDiscount: boolean;
    soShowPaymentTerms: boolean;
    soShowSerials: boolean;
    drShowSerials: boolean;
    drShowSignature: boolean;
    addressDetails: string;
    addressShowSoInvoice: boolean;
    addressShowQuotation: boolean;
    addressShowDr: boolean;
    cvNumberPrefix: string;
    cvNumberSuffix: string;
    gjNumberPrefix: string;
    gjNumberSuffix: string;
    posReceiptPaperWidth: string;
    posReceiptShowLogo: boolean;
    posReceiptFooterText: string;
  } = {
    paperSize: 'A4',
    showLogo: true,
    logoVariant: 'light',
    footerText: '',
    quoteHeaderColor: '#0f9cdf',
    quoteShowTerms: true,
    quoteShowMisc: false,
    quoteShowValidity: true,
    soShowDiscount: false,
    soShowPaymentTerms: true,
    soShowSerials: true,
    drShowSerials: true,
    drShowSignature: true,
    addressDetails: '',
    addressShowSoInvoice: true,
    addressShowQuotation: true,
    addressShowDr: true,
    cvNumberPrefix: 'CV',
    cvNumberSuffix: '',
    gjNumberPrefix: 'GJ',
    gjNumberSuffix: '',
    posReceiptPaperWidth: '80mm',
    posReceiptShowLogo: true,
    posReceiptFooterText: '',
  };

  constructor(
    private readonly businessSettingsService: BusinessSettingsService,
    private readonly rbacService: RbacService,
    private readonly userManagementService: UserManagementService,
    private readonly backupService: BackupService,
    private readonly inventoryService: InventoryService,
    private readonly orgService: OrgService,
    private readonly posService: PosService,
  ) {}

  ngOnInit(): void {
    void this.loadBusinessProfile();
    void this.loadRbacConfig();
  }

  ngAfterViewChecked(): void {
    if (this.shouldFocusDialog && this.cancelBtn) {
      this.cancelBtn.nativeElement.focus();
      this.shouldFocusDialog = false;
    }
  }

  readonly tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: 'system', label: 'System' },
    { key: 'print-settings', label: 'Print Settings' },
    { key: 'void-codes', label: 'Void Codes' },
    { key: 'user-management', label: 'User Management' },
    { key: 'audit-trail', label: 'Audit Trail' },
    { key: 'rbac-configs', label: 'RBAC Configs' },
    { key: 'unit-types', label: 'Unit Types' },
    { key: 'database-backup', label: 'Database Backup' },
  ];

  get isPosOrg(): boolean {
    return this.orgService.isPosOrg() || this.rbacService.isPosOrg();
  }

  get canAccessBackup(): boolean {
    return this.rbacService.isAdminOrSuperAdmin();
  }

  get visibleTabs(): Array<{ key: SettingsTab; label: string }> {
    return this.tabs.filter((tab) => {
      if (tab.key === 'database-backup') return this.canAccessBackup;
      if (tab.key === 'unit-types') return this.isPosOrg;
      if (tab.key === 'void-codes') return this.isPosOrg;
      if (tab.key === 'user-management') return this.rbacService.canAccess('user_management', 'canRead');
      if (tab.key === 'audit-trail') return this.isPosOrg && this.rbacService.hasMenu('pos-audit-trail');
      return true;
    });
  }

  get receiptPreviewLogo(): string | null {
    if (!this.printForm.posReceiptShowLogo && !this.printForm.showLogo) return null;
    return this.printForm.logoVariant === 'dark'
      ? (this.preview.businessLogoDark ?? null)
      : (this.preview.businessLogoLight ?? null);
  }

  get receiptPreviewWidthClass(): string {
    return this.printForm.posReceiptPaperWidth === '58mm' ? 'max-w-[220px]' : 'max-w-[300px]';
  }

  toggleVoidCodeVisibility(): void {
    this.showVoidCode = !this.showVoidCode;
  }

  openLogoPicker(mode: 'light' | 'dark'): void {
    if (!this.canUpdateSettings) return;
    const input = mode === 'light' ? this.lightLogoInput : this.darkLogoInput;
    input?.nativeElement.click();
  }

  get canReadSettings(): boolean {
    return this.rbacService.canAccess('settings', 'canRead');
  }

  get canUpdateSettings(): boolean {
    return this.rbacService.canAccess('settings', 'canUpdate');
  }

  get allowedMenus(): string[] {
    return Array.from(this.rbacService.getAllowedMenus()).sort((a, b) => a.localeCompare(b));
  }

  get effectivePermissionKeys(): string[] {
    return Array.from(this.rbacService.getEffectivePermissionKeys()).sort((a, b) => a.localeCompare(b));
  }

  get deniedPermissionKeys(): string[] {
    return Array.from(this.rbacService.getDeniedPermissionKeys()).sort((a, b) => a.localeCompare(b));
  }

  get filteredRbacPermissionOptions(): SettingsPermissionOption[] {
    const keyword = this.rbacSearch.trim().toLowerCase();
    if (!keyword) return this.permissionOptions;
    return this.permissionOptions.filter((item) =>
      `${item.key} ${item.label} ${item.module} ${item.scope}`.toLowerCase().includes(keyword),
    );
  }

  get selectedRoleName(): string {
    return this.roles.find((item) => item.id === this.selectedRoleId)?.name ?? 'No role selected';
  }

  get permissionUsageExample(): string {
    const key = String(this.newPermissionForm.key ?? '').trim() || 'module.button.action';
    return `*appCan="{ permissionKey: '${key}' }"`;
  }

  setActiveTab(tab: SettingsTab): void {
    const previousTab = this.activeTab;
    this.activeTab = tab;

    // Stop polling when switching away from database-backup tab
    if (previousTab === 'database-backup' && tab !== 'database-backup') {
      this.stopPolling();
    }

    // Load backups when switching to database-backup tab
    if (tab === 'database-backup') {
      void this.loadBackups();
    }
    if (tab === 'unit-types') {
      void this.loadUnitTypes();
    }
    if (tab === 'void-codes') {
      void this.loadVoidCodes();
    }
  }

  async loadVoidCodes(): Promise<void> {
    if (!this.isPosOrg) return;
    this.isLoadingVoidCodes = true;
    this.uiError = '';
    try {
      const r = await this.posService.getVoidCodes();
      if (!r.success) {
        this.uiError = 'Failed to load void codes.';
        this.voidCodes = [];
        return;
      }
      this.voidCodes = (r.data ?? []).filter((row) => this.showInactiveVoidCodes || row.isActive);
    } catch (error: unknown) {
      this.voidCodes = [];
      this.uiError = this.resolveErrorMessage(error, 'Failed to load void codes.');
    } finally {
      this.isLoadingVoidCodes = false;
    }
  }

  async saveVoidCode(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to manage void codes.';
      return;
    }
    const label = this.voidCodeForm.label.trim();
    const code = this.voidCodeForm.code.trim();
    if (!label || !code) {
      this.uiError = 'Label and code are required.';
      return;
    }
    this.isSavingVoidCode = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const r = await this.posService.saveVoidCode({ label, code });
      if (!r.success) {
        this.uiError = r.message ?? 'Failed to save void code.';
        return;
      }
      this.voidCodeForm = { label: '', code: '' };
      this.uiMessage = 'Void code saved.';
      await this.loadVoidCodes();
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to save void code.');
    } finally {
      this.isSavingVoidCode = false;
    }
  }

  onShowInactiveVoidCodesChange(): void {
    void this.loadVoidCodes();
  }

  openVoidCodeDetails(row: { id: number; label: string; isActive: boolean }): void {
    this.voidCodeEdit = { id: row.id, label: row.label, code: '', isActive: row.isActive };
    this.showVoidCodeEditPassword = false;
    this.voidCodeEditOpen = true;
    this.uiError = '';
  }

  closeVoidCodeEdit(): void {
    this.voidCodeEditOpen = false;
    this.voidCodeEdit = { id: 0, label: '', code: '', isActive: true };
    this.showVoidCodeEditPassword = false;
  }

  toggleVoidCodeEditPassword(): void {
    this.showVoidCodeEditPassword = !this.showVoidCodeEditPassword;
  }

  async saveVoidCodeEdit(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to manage void codes.';
      return;
    }
    const label = this.voidCodeEdit.label.trim();
    if (!label) {
      this.uiError = 'Label is required.';
      return;
    }
    const code = this.voidCodeEdit.code.trim();
    this.isSavingVoidCodeEdit = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const payload: { id: number; label: string; code?: string } = { id: this.voidCodeEdit.id, label };
      if (code) payload.code = code;
      const r = await this.posService.saveVoidCode(payload);
      if (!r.success) {
        this.uiError = r.message ?? 'Failed to update void code.';
        return;
      }
      this.uiMessage = code ? 'Void code updated.' : 'Void code label updated.';
      this.closeVoidCodeEdit();
      await this.loadVoidCodes();
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to update void code.');
    } finally {
      this.isSavingVoidCodeEdit = false;
    }
  }

  async toggleVoidCodeActive(row: { id: number; isActive: boolean }): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to manage void codes.';
      return;
    }
    this.uiError = '';
    this.uiMessage = '';
    try {
      const r = await this.posService.setVoidCodeActive(row.id, !row.isActive);
      if (!r.success) {
        this.uiError = r.message ?? 'Failed to update void code status.';
        return;
      }
      this.uiMessage = row.isActive ? 'Void code disabled.' : 'Void code enabled.';
      await this.loadVoidCodes();
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to update void code status.');
    }
  }

  async loadUnitTypes(): Promise<void> {
    if (!this.isPosOrg) return;
    this.isLoadingUnitTypes = true;
    this.uiError = '';
    try {
      const r = await this.inventoryService.getUnitTypes(true);
      if (!r.success) {
        this.uiError = r.message ?? 'Failed to load unit types.';
        this.unitTypes = [];
        return;
      }
      this.unitTypes = r.data ?? [];
    } catch (error: unknown) {
      this.unitTypes = [];
      this.uiError = this.resolveErrorMessage(error, 'Failed to load unit types.');
    } finally {
      this.isLoadingUnitTypes = false;
    }
  }

  async createUnitType(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to add unit types.';
      return;
    }
    const code = this.unitTypeForm.code.trim();
    const label = this.unitTypeForm.label.trim();
    if (!code || !label) {
      this.uiError = 'Code and label are required.';
      return;
    }

    const normalizedCode = this.normalizeUnitTypeCode(code);
    const duplicateError = this.findDuplicateUnitTypeError(normalizedCode, label);
    if (duplicateError) {
      this.uiError = duplicateError;
      return;
    }

    this.isSavingUnitType = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const r = await this.inventoryService.createUnitType({
        code,
        label,
        isManualEntry: this.unitTypeForm.isManualEntry,
        sortOrder: this.unitTypes.filter((u) => u.isActive).length + 1,
      });
      if (!r.success) {
        this.uiError = r.message ?? 'Failed to add unit type.';
        return;
      }
      this.unitTypeForm = { code: '', label: '', isManualEntry: false };
      this.uiMessage = r.message ?? (r.reactivated ? 'Unit type reactivated.' : 'Unit type added.');
      await this.loadUnitTypes();
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to add unit type.');
    } finally {
      this.isSavingUnitType = false;
    }
  }

  requestReactivateUnitType(row: OrgUnitType): void {
    if (!this.canUpdateSettings) return;
    this.openConfirm(
      'Reactivate unit type?',
      `Make "${row.label}" available again when adding product variants?`,
      () => void this.reactivateUnitType(row),
      'primary',
    );
  }

  async reactivateUnitType(row: OrgUnitType): Promise<void> {
    if (!this.canUpdateSettings) return;
    this.isSavingUnitType = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const r = await this.inventoryService.activateUnitType(row.id);
      if (!r.success) {
        this.uiError = r.message ?? 'Failed to reactivate unit type.';
        return;
      }
      this.uiMessage = r.message ?? `"${row.label}" reactivated.`;
      await this.loadUnitTypes();
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to reactivate unit type.');
    } finally {
      this.isSavingUnitType = false;
    }
  }

  requestDeactivateUnitType(row: OrgUnitType): void {
    if (!this.canUpdateSettings) return;
    this.openConfirm(
      'Remove unit type?',
      `Remove "${row.label}" from the active list? It will no longer appear when adding product variants.`,
      () => void this.deactivateUnitType(row),
      'danger',
    );
  }

  async deactivateUnitType(row: OrgUnitType): Promise<void> {
    if (!this.canUpdateSettings) return;
    this.isSavingUnitType = true;
    try {
      const r = await this.inventoryService.deactivateUnitType(row.id);
      if (!r.success) {
        this.uiError = r.message ?? 'Failed to remove unit type.';
        return;
      }
      this.uiMessage = `"${row.label}" removed from active list.`;
      await this.loadUnitTypes();
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to remove unit type.');
    } finally {
      this.isSavingUnitType = false;
    }
  }

  async loadBackups(): Promise<void> {
    this.isLoadingBackups = true;
    this.backupError = '';
    try {
      const backups = await this.backupService.listBackups();
      this.backups = backups;
      if (shouldPoll(backups)) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    } catch (error: unknown) {
      this.backupError = this.resolveErrorMessage(error, 'Failed to load backups.');
    } finally {
      this.isLoadingBackups = false;
    }
  }

  startPolling(): void {
    if (this.pollingInterval) return;
    this.pollingInterval = setInterval(async () => {
      try {
        const backups = await this.backupService.listBackups();
        this.backups = backups;
        if (!shouldPoll(backups)) {
          this.stopPolling();
        }
      } catch {
        // Polling errors are silently ignored (no UI disruption)
      }
    }, 5000);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
    if (this.backupMessageTimeout) {
      clearTimeout(this.backupMessageTimeout);
      this.backupMessageTimeout = null;
    }
  }

  // --- Backup CRUD Action Methods ---

  async createBackup(): Promise<void> {
    this.isCreatingBackup = true;
    try {
      const result = await this.backupService.createBackup(this.backupForm);
      const newEntry: BackupMetadata = {
        id: result.id,
        status: result.status as BackupMetadata['status'],
        type: this.backupForm.type,
        format: this.backupForm.format,
        databaseName: '',
        createdAt: new Date().toISOString(),
      };
      this.backups = [newEntry, ...this.backups];
      this.showFeedback('success', 'Backup initiated successfully');
      this.startPolling();
    } catch (error: unknown) {
      const message = this.resolveErrorMessage(error, 'Failed to create backup.');
      this.showFeedback('error', message);
    } finally {
      this.isCreatingBackup = false;
    }
  }

  async downloadBackup(id: string): Promise<void> {
    this.downloadingIds.add(id);
    try {
      const response = await this.backupService.downloadBackup(id);
      const contentDisposition = response.headers?.['content-disposition'] ?? null;
      const filename = extractFilename(contentDisposition) ?? `backup-${id}.sql`;
      const blob = new Blob([response.data]);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.showFeedback('error', 'Backup not found. It may have been deleted.');
        void this.loadBackups();
      } else if (axios.isAxiosError(error) && error.response?.status === 409) {
        this.showFeedback('error', 'Backup is not ready for download.');
      } else {
        const message = this.resolveErrorMessage(error, 'Failed to download backup.');
        this.showFeedback('error', message);
      }
    } finally {
      this.downloadingIds.delete(id);
    }
  }

  confirmDelete(id: string): void {
    this.deleteTriggerElement = document.activeElement as HTMLElement;
    this.showDeleteConfirm = true;
    this.deleteTargetId = id;
    this.shouldFocusDialog = true;
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.deleteTargetId = null;
    this.returnFocusToTrigger();
  }

  private returnFocusToTrigger(): void {
    if (this.deleteTriggerElement) {
      setTimeout(() => {
        this.deleteTriggerElement?.focus();
        this.deleteTriggerElement = null;
      });
    }
  }

  async executeDelete(): Promise<void> {
    const id = this.deleteTargetId;
    if (!id) return;
    this.deletingIds.add(id);
    try {
      await this.backupService.deleteBackup(id);
      this.backups = this.backups.filter((b) => b.id !== id);
      this.showFeedback('success', 'Backup deleted successfully.');
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.showFeedback('error', 'Backup not found. It may have been deleted.');
        void this.loadBackups();
      } else if (axios.isAxiosError(error) && error.response?.status === 409) {
        this.showFeedback('error', 'Cannot delete backup while it is in progress.');
      } else {
        const message = this.resolveErrorMessage(error, 'Failed to delete backup.');
        this.showFeedback('error', message);
      }
    } finally {
      this.deletingIds.delete(id);
      this.showDeleteConfirm = false;
      this.deleteTargetId = null;
      this.returnFocusToTrigger();
    }
  }

  showFeedback(type: 'success' | 'error', message: string): void {
    if (this.backupMessageTimeout) {
      clearTimeout(this.backupMessageTimeout);
      this.backupMessageTimeout = null;
    }
    if (type === 'success') {
      this.backupMessage = message;
      this.backupError = '';
      this.backupMessageTimeout = setTimeout(() => {
        this.backupMessage = '';
        this.backupMessageTimeout = null;
      }, 5000);
    } else {
      this.backupError = message;
      this.backupMessage = '';
    }
  }

  // --- Backup Utility Wrappers (for template access) ---

  formatBackupDate(isoString: string): string {
    return formatBackupDate(isoString);
  }

  formatFileSize(bytes: number | undefined): string {
    if (bytes === undefined || bytes === null) return '-';
    return formatFileSize(bytes);
  }

  getStatusBadgeClasses(status: string): string {
    return getStatusBadgeClasses(status as any);
  }

  getStatusAriaLabel(status: string): string {
    return getStatusAriaLabel(status as any);
  }

  isDownloading(id: string): boolean {
    return this.downloadingIds.has(id);
  }

  isDeleting(id: string): boolean {
    return this.deletingIds.has(id);
  }

  async loadRbacConfig(): Promise<void> {
    this.rbacError = '';
    await Promise.all([this.loadRoles(), this.loadPermissionKeys()]);
  }

  async loadRoles(): Promise<void> {
    this.isLoadingRoles = true;
    try {
      const response = await this.userManagementService.getRoles();
      if (!response.success) {
        this.roles = [];
        this.rbacError = response.message ?? 'Failed to load roles.';
        return;
      }
      this.roles = (response.data ?? [])
        .map((item) => this.mapRole(item))
        .filter((item) => item.id > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (this.roles.length > 0 && !this.selectedRoleId) {
        this.selectedRoleId = this.roles[0].id;
        await this.loadRolePermissions(this.roles[0].id);
      }
    } catch (error: unknown) {
      this.roles = [];
      this.rbacError = this.resolveErrorMessage(error, 'Failed to load roles.');
    } finally {
      this.isLoadingRoles = false;
    }
  }

  async loadPermissionKeys(): Promise<void> {
    this.isLoadingPermissionKeys = true;
    try {
      const response = await this.userManagementService.getPermissionKeys();
      if (!response.success) {
        this.permissionOptions = [];
        this.rbacError = response.message ?? 'Failed to load permission keys.';
        return;
      }
      this.permissionOptions = (response.data ?? []).map((item) => this.mapPermissionItem(item));
    } catch (error: unknown) {
      this.permissionOptions = [];
      this.rbacError = this.resolveErrorMessage(error, 'Failed to load permission keys.');
    } finally {
      this.isLoadingPermissionKeys = false;
    }
  }

  async onRoleChange(value: number | string): Promise<void> {
    const roleId = Number(value);
    this.selectedRoleId = Number.isFinite(roleId) && roleId > 0 ? roleId : '';
    this.rolePermissionKeys = [];
    if (typeof this.selectedRoleId === 'number') {
      await this.loadRolePermissions(this.selectedRoleId);
    }
  }

  async loadRolePermissions(roleId: number): Promise<void> {
    this.isLoadingRolePermissions = true;
    try {
      const response = await this.userManagementService.getRolePermissions(roleId);
      if (!response.success) {
        this.rolePermissionKeys = [];
        this.rbacError = response.message ?? 'Failed to load role permissions.';
        return;
      }
      this.rolePermissionKeys = (response.data ?? [])
        .map((item) => String(item.permissionKey ?? '').trim())
        .filter((item) => item.length > 0)
        .sort((a, b) => a.localeCompare(b));
    } catch (error: unknown) {
      this.rolePermissionKeys = [];
      this.rbacError = this.resolveErrorMessage(error, 'Failed to load role permissions.');
    } finally {
      this.isLoadingRolePermissions = false;
    }
  }

  async createPermissionKey(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to create permission keys.';
      return;
    }
    this.isCreatingPermissionKey = true;
    this.uiError = '';
    this.uiMessage = '';
    this.rbacError = '';
    try {
      const response = await this.userManagementService.createPermissionKey({
        key: String(this.newPermissionForm.key ?? '').trim().toLowerCase(),
        label: String(this.newPermissionForm.label ?? '').trim(),
        module: String(this.newPermissionForm.module ?? '').trim().toLowerCase(),
        scope: this.newPermissionForm.scope,
      });
      if (!response.success) {
        this.rbacError = response.message ?? 'Failed to create permission key.';
        return;
      }
      this.permissionOptions = (response.data ?? []).map((item) => this.mapPermissionItem(item));
      this.uiMessage = 'Permission key created successfully.';
      this.newPermissionForm = { key: '', label: '', module: '', scope: 'action' };
    } catch (error: unknown) {
      this.rbacError = this.resolveErrorMessage(error, 'Failed to create permission key.');
    } finally {
      this.isCreatingPermissionKey = false;
    }
  }

  toggleRolePermission(permissionKey: string, enabled: boolean): void {
    if (!permissionKey) return;
    const selected = new Set(this.rolePermissionKeys);
    if (enabled) selected.add(permissionKey);
    else selected.delete(permissionKey);
    this.rolePermissionKeys = [...selected].sort((a, b) => a.localeCompare(b));
  }

  isRolePermissionSelected(permissionKey: string): boolean {
    return this.rolePermissionKeys.includes(permissionKey);
  }

  async saveRolePermissions(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to update role permissions.';
      return;
    }
    if (typeof this.selectedRoleId !== 'number' || this.selectedRoleId <= 0) {
      this.rbacError = 'Select a role before saving permissions.';
      return;
    }
    this.isSavingRolePermissions = true;
    this.uiError = '';
    this.uiMessage = '';
    this.rbacError = '';
    try {
      const response = await this.userManagementService.saveRolePermissions(
        this.selectedRoleId,
        this.rolePermissionKeys,
      );
      if (!response.success) {
        this.rbacError = response.message ?? 'Failed to save role permissions.';
        return;
      }
      this.rolePermissionKeys = (response.data ?? [])
        .map((item) => String(item.permissionKey ?? '').trim())
        .filter((item) => item.length > 0)
        .sort((a, b) => a.localeCompare(b));

      const currentRoleId = Number(this.rbacService.getPayload()?.roleId ?? 0);
      if (currentRoleId > 0 && currentRoleId === this.selectedRoleId) {
        await this.rbacService.syncEffectivePermissions();
      }
      this.uiMessage = `Role permissions saved for ${this.selectedRoleName}.`;
    } catch (error: unknown) {
      this.rbacError = this.resolveErrorMessage(error, 'Failed to save role permissions.');
    } finally {
      this.isSavingRolePermissions = false;
    }
  }

  async loadBusinessProfile(): Promise<void> {
    if (!this.canReadSettings) {
      this.uiError = 'You do not have permission to view settings.';
      return;
    }
    this.isLoading = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const item = await this.businessSettingsService.getBusinessProfile();
      this.applyBusinessProfile(item);
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to load business settings.');
    } finally {
      this.isLoading = false;
    }
  }

  async saveBusinessProfile(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to update settings.';
      return;
    }
    this.isSaving = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const response = await this.businessSettingsService.updateBusinessProfile({
        websiteTabName: this.toNullable(this.form.websiteTabName),
        routingTabName: this.toNullable(this.form.routingTabName),
        businessName: this.toNullable(this.form.businessName),
        businessAddress: this.toNullable(this.form.businessAddress),
        businessContact: this.toNullable(this.form.businessContact),
        businessEmail: this.toNullable(this.form.businessEmail),
        businessOwner: this.toNullable(this.form.businessOwner),
        businessDescription: this.toNullable(this.form.businessDescription),
      });
      if (!response.success) {
        this.uiError = response.message ?? 'Failed to save business settings.';
        return;
      }
      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = 'Business settings saved successfully.';
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to save business settings.');
    } finally {
      this.isSaving = false;
    }
  }

  async onUploadLogo(mode: 'light' | 'dark', event: Event): Promise<void> {
    if (!this.canUpdateSettings) { this.uiError = 'You do not have permission to upload logos.'; return; }
    const file = this.readSelectedFile(event);
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.uiError = 'Please upload an image file for business logo.'; return; }
    if (mode === 'light') this.isUploadingLightLogo = true;
    else this.isUploadingDarkLogo = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const response = await this.businessSettingsService.uploadBusinessLogo(mode, file);
      if (!response.success) { this.uiError = response.message ?? 'Failed to upload logo.'; return; }
      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = `${mode === 'light' ? 'Light' : 'Dark'} logo uploaded successfully.`;
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to upload logo.');
    } finally {
      if (mode === 'light') this.isUploadingLightLogo = false;
      else this.isUploadingDarkLogo = false;
      this.resetFileInput(event);
    }
  }

  async onRemoveLogo(mode: 'light' | 'dark'): Promise<void> {
    if (!this.canUpdateSettings) { this.uiError = 'You do not have permission to remove logos.'; return; }
    if (mode === 'light') this.isRemovingLightLogo = true;
    else this.isRemovingDarkLogo = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const response = await this.businessSettingsService.updateBusinessProfile({
        [mode === 'light' ? 'businessLogoLight' : 'businessLogoDark']: null,
      });
      if (!response.success) { this.uiError = response.message ?? 'Failed to remove logo.'; return; }
      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = `${mode === 'light' ? 'Light' : 'Dark'} logo removed successfully.`;
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to remove logo.');
    } finally {
      if (mode === 'light') this.isRemovingLightLogo = false;
      else this.isRemovingDarkLogo = false;
    }
  }

  async onUploadDrTemplate(event: Event): Promise<void> {
    if (!this.canUpdateSettings) { this.uiError = 'You do not have permission to upload DR template.'; return; }
    const file = this.readSelectedFile(event);
    if (!file) return;
    if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      this.uiError = 'Please upload a PDF file for DR template.'; return;
    }
    this.isUploadingDrTemplate = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const response = await this.businessSettingsService.uploadDrTemplate(file);
      if (!response.success) { this.uiError = response.message ?? 'Failed to upload DR template.'; return; }
      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = 'DR template uploaded successfully.';
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to upload DR template.');
    } finally {
      this.isUploadingDrTemplate = false;
      this.resetFileInput(event);
    }
  }

  async onUploadSignatorySignature(role: 'prepared-by' | 'checked-by' | 'approved-by', event: Event): Promise<void> {
    if (!this.canUpdateSettings) { this.uiError = 'You do not have permission to upload signatures.'; return; }
    const file = this.readSelectedFile(event);
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.uiError = 'Please upload an image file for signatory signature.'; return; }
    if (role === 'prepared-by') this.isUploadingPreparedBySignature = true;
    else if (role === 'checked-by') this.isUploadingCheckedBySignature = true;
    else this.isUploadingApprovedBySignature = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const response = await this.businessSettingsService.uploadSignatorySignature(role, file);
      if (!response.success) { this.uiError = response.message ?? 'Failed to upload signatory signature.'; return; }
      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = 'Signatory signature uploaded successfully.';
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to upload signatory signature.');
    } finally {
      if (role === 'prepared-by') this.isUploadingPreparedBySignature = false;
      else if (role === 'checked-by') this.isUploadingCheckedBySignature = false;
      else this.isUploadingApprovedBySignature = false;
      this.resetFileInput(event);
    }
  }

  async savePrintSettings(): Promise<void> {
    if (!this.canUpdateSettings) { this.uiError = 'You do not have permission to update settings.'; return; }
    this.isSavingPrint = true;
    this.uiError = '';
    this.uiMessage = '';
    try {
      const response = await this.businessSettingsService.updateBusinessProfile({
        printPaperSize: this.printForm.paperSize || 'A4',
        printShowLogo: String(this.printForm.showLogo),
        printLogoVariant: this.printForm.logoVariant || 'light',
        printFooterText: this.toNullable(this.printForm.footerText),
        printQuoteHeaderColor: this.printForm.quoteHeaderColor || '#0f9cdf',
        printQuoteShowTerms: String(this.printForm.quoteShowTerms),
        printQuoteShowMisc: String(this.printForm.quoteShowMisc),
        printQuoteShowValidity: String(this.printForm.quoteShowValidity),
        printSoShowDiscount: String(this.printForm.soShowDiscount),
        printSoShowPaymentTerms: String(this.printForm.soShowPaymentTerms),
        printSoShowSerials: String(this.printForm.soShowSerials),
        printDrShowSerials: String(this.printForm.drShowSerials),
        printDrShowSignature: String(this.printForm.drShowSignature),
        printAddressDetails: this.toNullable(this.printForm.addressDetails),
        printAddressShowSoInvoice: String(this.printForm.addressShowSoInvoice),
        printAddressShowQuotation: String(this.printForm.addressShowQuotation),
        printAddressShowDr: String(this.printForm.addressShowDr),
        cvNumberPrefix: this.printForm.cvNumberPrefix.trim() || 'CV',
        cvNumberSuffix: this.printForm.cvNumberSuffix.trim(),
        gjNumberPrefix: this.printForm.gjNumberPrefix.trim() || 'GJ',
        gjNumberSuffix: this.printForm.gjNumberSuffix.trim(),
        posReceiptPaperWidth: this.printForm.posReceiptPaperWidth.trim() || '80mm',
        posReceiptShowLogo: String(this.printForm.posReceiptShowLogo),
        posReceiptFooterText: this.toNullable(this.printForm.posReceiptFooterText),
      });
      if (!response.success) { this.uiError = response.message ?? 'Failed to save print settings.'; return; }
      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = 'Print settings saved successfully.';
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to save print settings.');
    } finally {
      this.isSavingPrint = false;
    }
  }

  private applyBusinessProfile(item: BusinessProfileSettings | null): void {
    this.form = {
      websiteTabName: item?.websiteTabName ?? item?.businessName ?? '',
      routingTabName: item?.routingTabName ?? '{route}',
      businessName: item?.businessName ?? '',
      businessAddress: item?.businessAddress ?? '',
      businessContact: item?.businessContact ?? '',
      businessEmail: item?.businessEmail ?? '',
      businessOwner: item?.businessOwner ?? '',
      businessDescription: item?.businessDescription ?? '',
    };
    this.preview = {
      businessLogoLight: item?.businessLogoLight ?? item?.businessLogo ?? this.defaultBusinessLogoLight,
      businessLogoDark: item?.businessLogoDark ?? item?.businessLogo ?? this.defaultBusinessLogoDark,
      drTemplatePdf: item?.drTemplatePdf ?? this.defaultDrTemplatePdf,
      printSignaturePreparedBy: item?.printSignaturePreparedBy ?? null,
      printSignatureCheckedBy: item?.printSignatureCheckedBy ?? null,
      printSignatureApprovedBy: item?.printSignatureApprovedBy ?? null,
    };
    this.printForm = {
      paperSize: item?.printPaperSize ?? 'A4',
      showLogo: this.parsePrintBool(item?.printShowLogo, true),
      logoVariant: item?.printLogoVariant ?? 'light',
      footerText: item?.printFooterText ?? '',
      quoteHeaderColor: item?.printQuoteHeaderColor ?? '#0f9cdf',
      quoteShowTerms: this.parsePrintBool(item?.printQuoteShowTerms, true),
      quoteShowMisc: this.parsePrintBool(item?.printQuoteShowMisc, false),
      quoteShowValidity: this.parsePrintBool(item?.printQuoteShowValidity, true),
      soShowDiscount: this.parsePrintBool(item?.printSoShowDiscount, false),
      soShowPaymentTerms: this.parsePrintBool(item?.printSoShowPaymentTerms, true),
      soShowSerials: this.parsePrintBool(item?.printSoShowSerials, true),
      drShowSerials: this.parsePrintBool(item?.printDrShowSerials, true),
      drShowSignature: this.parsePrintBool(item?.printDrShowSignature, true),
      addressDetails: item?.printAddressDetails ?? '',
      addressShowSoInvoice: this.parsePrintBool(item?.printAddressShowSoInvoice, true),
      addressShowQuotation: this.parsePrintBool(item?.printAddressShowQuotation, true),
      addressShowDr: this.parsePrintBool(item?.printAddressShowDr, true),
      cvNumberPrefix: item?.cvNumberPrefix ?? 'CV',
      cvNumberSuffix: item?.cvNumberSuffix ?? '',
      gjNumberPrefix: item?.gjNumberPrefix ?? 'GJ',
      gjNumberSuffix: item?.gjNumberSuffix ?? '',
      posReceiptPaperWidth: item?.posReceiptPaperWidth ?? '80mm',
      posReceiptShowLogo: this.parsePrintBool(item?.posReceiptShowLogo, true),
      posReceiptFooterText: item?.posReceiptFooterText ?? '',
    };
  }

  formatPermissionModule(value: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) return 'Misc';
    return normalized.split('-').map((e) => e.charAt(0).toUpperCase() + e.slice(1)).join(' ');
  }

  formatPermissionScope(value: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) return 'General';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private parsePrintBool(value: string | null | undefined, defaultValue: boolean): boolean {
    if (value === null || value === undefined) return defaultValue;
    return String(value).trim().toLowerCase() === 'true';
  }

  private mapRole(item: RoleApiItem): { id: number; name: string } {
    return {
      id: Number(item.id ?? 0),
      name: String(item.roleName ?? item.rolename ?? '').trim() || `Role #${item.id}`,
    };
  }

  private mapPermissionItem(item: PermissionKeyApiItem): SettingsPermissionOption {
    return {
      key: String(item.key ?? '').trim(),
      label: String(item.label ?? '').trim() || String(item.key ?? '').trim(),
      module: String(item.module ?? '').trim(),
      scope: String(item.scope ?? '').trim() || 'action',
    };
  }

  private readSelectedFile(event: Event): File | null {
    return (event.target as HTMLInputElement | null)?.files?.[0] ?? null;
  }

  private resetFileInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input) input.value = '';
  }

  private toNullable(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeUnitTypeCode(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, '_');
  }

  private findDuplicateUnitTypeError(normalizedCode: string, label: string): string | null {
    const byCode = this.unitTypes.find((u) => u.code.toLowerCase() === normalizedCode);
    if (byCode?.isActive) {
      return `Unit type "${byCode.label}" already exists. Use a different code or reactivate it from the list below.`;
    }
    const byLabel = this.unitTypes.find(
      (u) => u.isActive && u.label.trim().toLowerCase() === label.trim().toLowerCase(),
    );
    if (byLabel) {
      return `A unit type with label "${byLabel.label}" already exists (code: ${byLabel.code}).`;
    }
    return null;
  }

  openConfirm(title: string, message: string, action: () => void, dialogVariant: 'primary' | 'danger' = 'primary'): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.confirmVariant = dialogVariant;
    this.confirmAction = action;
    this.confirmOpen = true;
  }

  onConfirmDialog(): void {
    this.confirmOpen = false;
    this.confirmAction?.();
    this.confirmAction = null;
  }

  onCancelDialog(): void {
    this.confirmOpen = false;
    this.confirmAction = null;
  }

  private resolveErrorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
      // Network error — no response received from server
      if (!error.response) {
        return 'Network error. Please check your connection and try again.';
      }

      const status = error.response.status;

      // 401 — already handled by apiClient token refresh interceptor.
      // If it reaches here, refresh failed and token was cleared.
      // Return empty string so no misleading error is shown (user will be redirected to login).
      if (status === 401) {
        return '';
      }

      // 403 — forbidden
      if (status === 403) {
        return 'You do not have permission to perform this action.';
      }

      // 500 — server error
      if (status === 500) {
        return 'An unexpected error occurred. Please try again later.';
      }

      // For other statuses (404, 409, etc.), use server-provided message or fallback
      return (error.response.data as { message?: string } | undefined)?.message ?? fallback;
    }
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }
}
