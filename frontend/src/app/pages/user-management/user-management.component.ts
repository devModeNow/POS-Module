import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { CanDirective } from '../../shared/directives/can.directive';
import {
  PermissionKeyApiItem,
  RoleApiItem,
  UserEffectivePermissionApiItem,
  UserApiItem,
  UserPermissionOverrideApiItem,
  UserManagementService,
} from '../../shared/services/user-management.service';
import { OrgListItem, OrgService } from '../../shared/services/org.service';
import { NotificationService } from '../../shared/services/notification.service';
import { RbacService } from '../../shared/services/rbac.service';
import axios from 'axios';

interface UserRow {
  id: number;
  username: string;
  fullName: string;
  role: string;
  roleMenus: string[];
  rolePermissions: string[];
  status: 'Active' | 'Inactive' | 'Deleted';
  isDeleted: boolean;
  orgId: number | null;
  orgName: string | null;
}

interface RoleOption {
  id: number;
  name: string;
  orgId: number | null;
}

interface PermissionOption {
  key: string;
  label: string;
  module: string;
  scope: string;
}

interface PermissionModuleGroup {
  module: string;
  items: PermissionOption[];
}

type OverrideEffect = 'inherit' | 'allow' | 'deny';

@Component({
  selector: 'app-user-management',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, CanDirective],
  templateUrl: './user-management.component.html',
  styles: ``,
})
export class UserManagementComponent implements OnInit {
  users: UserRow[] = [];
  orgOptions: OrgListItem[] = [];
  roleOptions: RoleOption[] = [];
  permissionOptions: PermissionOption[] = [];
  userSearch = '';
  permissionSearch = '';
  showDeletedUsers = false;
  page = 1;
  readonly pageSize = 10;

  isLoadingUsers = false;
  isLoadingOrgs = false;
  isLoadingRoles = false;
  isLoadingPermissionKeys = false;
  isLoadingRolePermissions = false;
  isLoadingPermissionContext = false;
  isCreateDrawerOpen = false;
  isCreatingUser = false;
  drawerMode: 'create' | 'edit' = 'create';
  editingUserId: number | null = null;
  loadingEditUserId: number | null = null;
  deletingUserIds = new Set<number>();
  restoringUserIds = new Set<number>();
  errorMessage = '';
  rolePermissionKeys: string[] = [];
  savedEffectivePermissions: UserEffectivePermissionApiItem[] = [];
  overrideSelectionByKey: Record<string, OverrideEffect> = {};

  createForm = this.createInitialForm();

  constructor(
    private readonly userManagementService: UserManagementService,
    private readonly orgService: OrgService,
    private readonly notificationService: NotificationService,
    private readonly rbacService: RbacService,
  ) {}

  ngOnInit(): void {
    void this.loadUsers();
    void this.loadOrgs();
    void this.loadPermissionKeys();
  }

  // ─── Computed ────────────────────────────────────────────────────────────

  get isPlatformUser(): boolean { return this.rbacService.isPlatformUser(); }

  get filteredUsers(): UserRow[] {
    const kw = this.userSearch.trim().toLowerCase();
    if (!kw) return this.users;
    return this.users.filter((u) =>
      `${u.username} ${u.fullName} ${u.role} ${u.status} ${u.orgName ?? ''}`.toLowerCase().includes(kw),
    );
  }

  get pagedUsers(): UserRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredUsers.slice(start, start + this.pageSize);
  }

  get totalFilteredPages(): number { return Math.max(1, Math.ceil(this.filteredUsers.length / this.pageSize)); }
  get activeUserCount(): number { return this.users.filter((u) => !u.isDeleted && u.status === 'Active').length; }
  get inactiveUserCount(): number { return this.users.filter((u) => !u.isDeleted && u.status === 'Inactive').length; }
  get deletedUserCount(): number { return this.users.filter((u) => u.isDeleted).length; }

  get filteredPermissionOptions(): PermissionOption[] {
    const kw = this.permissionSearch.trim().toLowerCase();
    if (!kw) return this.permissionOptions;
    return this.permissionOptions.filter((p) =>
      `${p.key} ${p.label} ${p.module} ${p.scope}`.toLowerCase().includes(kw),
    );
  }

  get groupedFilteredPermissionOptions(): PermissionModuleGroup[] {
    const grouped = this.filteredPermissionOptions.reduce<Record<string, PermissionOption[]>>((acc, item) => {
      const key = item.module || 'misc';
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, items]) => ({ module, items: items.sort((a, b) => a.key.localeCompare(b.key)) }));
  }

  get selectedOverrides(): UserPermissionOverrideApiItem[] {
    return Object.entries(this.overrideSelectionByKey)
      .filter(([, e]) => e === 'allow' || e === 'deny')
      .map(([permissionKey, effect]) => ({ permissionKey, effect: effect as 'allow' | 'deny' }));
  }

  get selectedOverrideCount(): number { return this.selectedOverrides.length; }

  get effectivePreviewKeys(): string[] {
    const allowed = new Set(this.rolePermissionKeys);
    for (const [key, effect] of Object.entries(this.overrideSelectionByKey)) {
      if (effect === 'allow') allowed.add(key);
      if (effect === 'deny') allowed.delete(key);
    }
    return [...allowed].sort((a, b) => a.localeCompare(b));
  }

  get savedEffectivePermissionKeys(): string[] {
    return this.savedEffectivePermissions
      .map((i) => String(i.permissionKey ?? '').trim())
      .filter((i) => i.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }

  get previewChangedCount(): number {
    if (this.drawerMode !== 'edit') return 0;
    const saved = new Set(this.savedEffectivePermissionKeys);
    const preview = new Set(this.effectivePreviewKeys);
    let changed = 0;
    for (const key of new Set([...saved, ...preview])) {
      if (saved.has(key) !== preview.has(key)) changed++;
    }
    return changed;
  }

  // ─── Loaders ─────────────────────────────────────────────────────────────

  async loadUsers(): Promise<void> {
    this.isLoadingUsers = true;
    this.errorMessage = '';
    try {
      const orgId = this.isPlatformUser ? undefined : this.rbacService.getOrgId();
      const response = await this.userManagementService.getUsers(this.showDeletedUsers, orgId ?? undefined);
      if (!response.success) { this.errorMessage = response.message ?? 'Failed to load users'; this.users = []; return; }
      this.users = (response.data ?? []).map((i) => this.mapUserItem(i));
      this.page = 1;
    } catch (e: unknown) {
      this.errorMessage = this.extractApiError(e, 'Failed to load users');
      this.users = [];
    } finally {
      this.isLoadingUsers = false;
    }
  }

  async loadOrgs(): Promise<void> {
    this.isLoadingOrgs = true;
    try {
      const res = await this.orgService.getAll();
      this.orgOptions = res.data ?? [];
    } catch { this.orgOptions = []; }
    finally { this.isLoadingOrgs = false; }
  }

  /** Called when org selection changes in the drawer — reloads roles for that org */
  async onOrgChange(value: unknown): Promise<void> {
    // Native select (change) event gives a string value: '' for platform, '1' for org id
    const str = String(value ?? '').trim();
    const resolvedOrgId = str === '' || str === 'null' ? null : Number(str);
    const validOrgId = resolvedOrgId !== null && Number.isFinite(resolvedOrgId) && resolvedOrgId > 0
      ? resolvedOrgId
      : null;

    this.createForm.orgId = validOrgId;
    this.createForm.roleId = '';
    this.rolePermissionKeys = [];
    this.overrideSelectionByKey = {};
    // null  → platform roles only (org_id IS NULL in DB)
    // number → that org's roles only
    await this.loadRolesForOrg(validOrgId);
  }

  async loadRolesForOrg(orgId: number | null): Promise<void> {
    this.isLoadingRoles = true;
    try {
      const response = await this.userManagementService.getRoles(orgId);
      if (!response.success) {
        this.roleOptions = [];
        this.notificationService.warning('Roles Unavailable', response.message ?? 'Failed to load roles.');
        return;
      }
      this.roleOptions = (response.data ?? [])
        .map((i) => this.mapRoleItem(i))
        .filter((i) => i.name.length > 0);
    } catch (e: unknown) {
      this.roleOptions = [];
      this.notificationService.error('Roles Unavailable', this.extractApiError(e, 'Failed to load roles.'));
    } finally {
      this.isLoadingRoles = false;
    }
  }

  async onRoleChange(nextRoleId: unknown): Promise<void> {
    const roleId = Number(nextRoleId);
    this.createForm.roleId = Number.isFinite(roleId) && roleId > 0 ? roleId : '';
    this.rolePermissionKeys = [];
    if (!Number.isFinite(roleId) || roleId <= 0) return;
    await this.loadRolePermissions(roleId);
  }

  onUserSearchChange(value: string): void { this.userSearch = value; this.page = 1; }
  onUserPageChange(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalFilteredPages || nextPage === this.page) return;
    this.page = nextPage;
  }

  async onToggleShowDeletedUsers(value: unknown): Promise<void> {
    this.showDeletedUsers = value === true;
    this.page = 1;
    await this.loadUsers();
  }

  // ─── Drawer ───────────────────────────────────────────────────────────────

  async openCreateDrawer(): Promise<void> {
    this.createForm = this.createInitialForm();
    this.drawerMode = 'create';
    this.editingUserId = null;
    this.rolePermissionKeys = [];
    this.savedEffectivePermissions = [];
    this.overrideSelectionByKey = {};
    this.permissionSearch = '';
    this.roleOptions = [];
    // Pre-select current user's org if they are an org user
    const currentOrgId = this.rbacService.getOrgId();
    if (currentOrgId) {
      this.createForm.orgId = currentOrgId;
      await this.loadRolesForOrg(currentOrgId);
    }
    this.isCreateDrawerOpen = true;
  }

  async openEditDrawer(user: UserRow): Promise<void> {
    if (this.loadingEditUserId === user.id || this.isCreatingUser) return;
    this.loadingEditUserId = user.id;
    try {
      const response = await this.userManagementService.getUserById(user.id);
      if (!response.success || !response.data) {
        this.notificationService.error('Load User Failed', response.message ?? 'Failed to load user details.');
        return;
      }
      const detail = response.data;
      const roleId = Number(detail.roleId ?? detail.roleid ?? detail.role_id ?? 0);
      const orgId = Number(detail.orgId ?? 0);

      this.createForm = {
        username: String(detail.username ?? '').trim(),
        password: '',
        fullname: String(detail.fullname ?? detail.fullName ?? detail.full_name ?? '').trim(),
        email: String(detail.email ?? '').trim(),
        address: String(detail.address ?? '').trim(),
        contact: String(detail.contact ?? '').trim(),
        birthdate: this.toDateInputValue(detail.birthdate),
        roleId: roleId > 0 ? roleId : '',
        orgId: orgId > 0 ? orgId : null,
        status: this.normalizeStatus(detail.status),
      };

      // Load roles for this user's org
      await this.loadRolesForOrg(orgId > 0 ? orgId : null);

      this.drawerMode = 'edit';
      this.editingUserId = user.id;
      await this.loadPermissionContext(user.id, roleId > 0 ? roleId : null);
      this.isCreateDrawerOpen = true;
    } catch (e: unknown) {
      this.notificationService.error('Load User Failed', this.extractApiError(e, 'Failed to load user details.'));
    } finally {
      this.loadingEditUserId = null;
    }
  }

  closeCreateDrawer(): void {
    if (this.isCreatingUser) return;
    this.isCreateDrawerOpen = false;
    this.drawerMode = 'create';
    this.editingUserId = null;
    this.rolePermissionKeys = [];
    this.savedEffectivePermissions = [];
    this.overrideSelectionByKey = {};
    this.permissionSearch = '';
    this.roleOptions = [];
  }

  async submitCreateUser(): Promise<void> {
    if (this.isCreatingUser) return;
    const username = this.createForm.username.trim();
    const fullname = this.createForm.fullname.trim();
    const password = this.createForm.password;
    const roleId = Number(this.createForm.roleId);

    if (!username || !fullname || (this.drawerMode === 'create' && !password)) {
      this.notificationService.warning('Incomplete Form',
        this.drawerMode === 'create' ? 'Username, full name, and password are required.' : 'Username and full name are required.');
      return;
    }
    if (!Number.isFinite(roleId) || roleId <= 0) {
      this.notificationService.warning('Role Required', 'Please select a role.');
      return;
    }

    this.isCreatingUser = true;
    try {
      const payload = {
        username, fullname, roleId,
        orgId: this.createForm.orgId ?? undefined,
        status: this.createForm.status,
        email: this.createForm.email.trim() || undefined,
        address: this.createForm.address.trim() || undefined,
        contact: this.createForm.contact.trim() || undefined,
        birthdate: this.createForm.birthdate || undefined,
      };

      const response = this.drawerMode === 'create'
        ? await this.userManagementService.createUser({ ...payload, password })
        : Number.isFinite(Number(this.editingUserId)) && Number(this.editingUserId) > 0
          ? await this.userManagementService.updateUser(Number(this.editingUserId), {
              ...payload, ...(password ? { password } : {}),
            })
          : { success: false, message: 'Invalid user id for edit' };

      if (!response.success) {
        this.notificationService.error(
          this.drawerMode === 'create' ? 'Create User Failed' : 'Update User Failed',
          response.message ?? 'Operation failed.',
        );
        return;
      }

      const targetUserId = this.drawerMode === 'create'
        ? Number(response.id ?? 0)
        : Number(this.editingUserId ?? 0);

      const overridePayload = this.selectedOverrides;
      if ((this.drawerMode === 'edit' || overridePayload.length > 0) && targetUserId > 0) {
        const overrideResponse = await this.userManagementService.saveUserPermissionOverrides(targetUserId, overridePayload);
        if (!overrideResponse.success) {
          this.notificationService.warning('Permission Overrides Not Saved',
            overrideResponse.message ?? 'User saved but permission overrides failed.');
        }
      }

      this.notificationService.success(
        this.drawerMode === 'create' ? 'User Created' : 'User Updated',
        this.drawerMode === 'create' ? 'New user has been created successfully.' : 'User updated successfully.',
      );
      this.isCreateDrawerOpen = false;
      this.editingUserId = null;
      await this.loadUsers();
    } catch (e: unknown) {
      this.notificationService.error(
        this.drawerMode === 'create' ? 'Create User Failed' : 'Update User Failed',
        this.extractApiError(e, 'Operation failed.'),
      );
    } finally {
      this.isCreatingUser = false;
    }
  }

  async deleteUser(user: UserRow): Promise<void> {
    if (user.isDeleted || this.deletingUserIds.has(user.id)) return;
    if (!window.confirm(`Delete user ${user.username}?`)) return;
    this.deletingUserIds.add(user.id);
    try {
      const response = await this.userManagementService.deleteUser(user.id);
      if (!response.success) { this.notificationService.error('Delete Failed', response.message ?? 'Failed to delete user.'); return; }
      this.notificationService.success('User Deleted', 'User removed successfully.');
      await this.loadUsers();
    } catch (e: unknown) {
      this.notificationService.error('Delete Failed', this.extractApiError(e, 'Failed to delete user.'));
    } finally { this.deletingUserIds.delete(user.id); }
  }

  async restoreUser(user: UserRow): Promise<void> {
    if (!user.isDeleted || this.restoringUserIds.has(user.id)) return;
    if (!window.confirm(`Restore user ${user.username}?`)) return;
    this.restoringUserIds.add(user.id);
    try {
      const response = await this.userManagementService.restoreUser(user.id);
      if (!response.success) { this.notificationService.error('Restore Failed', response.message ?? 'Failed to restore user.'); return; }
      this.notificationService.success('User Restored', 'User restored successfully.');
      await this.loadUsers();
    } catch (e: unknown) {
      this.notificationService.error('Restore Failed', this.extractApiError(e, 'Failed to restore user.'));
    } finally { this.restoringUserIds.delete(user.id); }
  }

  trackByUserId(_: number, user: UserRow): number { return user.id; }

  // ─── Permission helpers ───────────────────────────────────────────────────

  getOverrideEffect(permissionKey: string): OverrideEffect {
    return this.overrideSelectionByKey[permissionKey] ?? 'inherit';
  }

  setOverrideEffect(permissionKey: string, nextEffect: unknown): void {
    const effect = nextEffect === 'allow' || nextEffect === 'deny' ? nextEffect : 'inherit';
    if (effect === 'inherit') {
      delete this.overrideSelectionByKey[permissionKey];
      this.overrideSelectionByKey = { ...this.overrideSelectionByKey };
      return;
    }
    this.overrideSelectionByKey = { ...this.overrideSelectionByKey, [permissionKey]: effect };
  }

  clearOverrideSelections(): void { this.overrideSelectionByKey = {}; }
  isRoleGranted(permissionKey: string): boolean { return this.rolePermissionKeys.includes(permissionKey); }

  formatPermissionModule(value: string): string {
    const n = String(value ?? '').trim();
    if (!n) return 'Misc';
    return n.split('-').map((e) => e.charAt(0).toUpperCase() + e.slice(1)).join(' ');
  }

  formatPermissionScope(value: string): string {
    const n = String(value ?? '').trim();
    if (!n) return 'General';
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  getPermissionLabel(permissionKey: string): string {
    return this.permissionOptions.find((p) => p.key === permissionKey)?.label ?? permissionKey;
  }

  getAccessSummary(user: UserRow): string {
    return `${user.roleMenus.length} menu${user.roleMenus.length === 1 ? '' : 's'}, ${user.rolePermissions.length} permission${user.rolePermissions.length === 1 ? '' : 's'}`;
  }

  getAccessTokenPreview(user: UserRow, maxItems = 2): string[] {
    return [...new Set([...user.roleMenus, ...user.rolePermissions])]
      .filter((i) => i.length > 0)
      .slice(0, maxItems)
      .map((i) => i.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').trim()
        .split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '));
  }

  getAccessTokenExtraCount(user: UserRow, maxItems = 2): number {
    return Math.max(0, [...new Set([...user.roleMenus, ...user.rolePermissions])].length - maxItems);
  }

  hasFullAccess(user: UserRow): boolean {
    return user.rolePermissions.some((p) => String(p).trim().toLowerCase() === 'candoall');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async loadPermissionKeys(): Promise<void> {
    this.isLoadingPermissionKeys = true;
    try {
      const response = await this.userManagementService.getPermissionKeys();
      if (!response.success) { this.permissionOptions = []; return; }
      this.permissionOptions = (response.data ?? []).map((i) => this.mapPermissionItem(i));
    } catch { this.permissionOptions = []; }
    finally { this.isLoadingPermissionKeys = false; }
  }

  private async loadRolePermissions(roleId: number): Promise<void> {
    this.isLoadingRolePermissions = true;
    try {
      const response = await this.userManagementService.getRolePermissions(roleId);
      if (!response.success) { this.rolePermissionKeys = []; return; }
      this.rolePermissionKeys = (response.data ?? []).map((i) => i.permissionKey).filter(Boolean);
    } catch { this.rolePermissionKeys = []; }
    finally { this.isLoadingRolePermissions = false; }
  }

  private async loadPermissionContext(userId: number, roleId: number | null): Promise<void> {
    this.isLoadingPermissionContext = true;
    try {
      const tasks: Promise<unknown>[] = [];
      if (roleId && roleId > 0) tasks.push(this.loadRolePermissions(roleId));
      else this.rolePermissionKeys = [];
      tasks.push(this.loadUserOverrides(userId));
      tasks.push(this.loadUserEffectivePermissions(userId));
      await Promise.all(tasks);
    } finally { this.isLoadingPermissionContext = false; }
  }

  private async loadUserOverrides(userId: number): Promise<void> {
    try {
      const response = await this.userManagementService.getUserPermissionOverrides(userId);
      if (!response.success) { this.overrideSelectionByKey = {}; return; }
      const overrides: Record<string, OverrideEffect> = {};
      for (const item of response.data ?? []) {
        if (item.permissionKey && (item.effect === 'allow' || item.effect === 'deny')) {
          overrides[item.permissionKey] = item.effect;
        }
      }
      this.overrideSelectionByKey = overrides;
    } catch { this.overrideSelectionByKey = {}; }
  }

  private async loadUserEffectivePermissions(userId: number): Promise<void> {
    try {
      const response = await this.userManagementService.getUserEffectivePermissions(userId);
      this.savedEffectivePermissions = response.success ? (response.data ?? []).filter((i) => i.isAllowed) : [];
    } catch { this.savedEffectivePermissions = []; }
  }

  private createInitialForm(): {
    username: string; password: string; fullname: string; email: string;
    address: string; contact: string; birthdate: string;
    roleId: number | ''; orgId: number | null; status: number;
  } {
    return { username: '', password: '', fullname: '', email: '', address: '', contact: '', birthdate: '', roleId: '', orgId: null, status: 1 };
  }

  private mapUserItem(item: UserApiItem): UserRow {
    const fullname = String(item.fullname ?? item.fullName ?? item.full_name ?? '').trim() || String(item.username ?? '').trim();
    const role = String(item.roleName ?? item.rolename ?? '').trim() || '-';
    const roleMenus = this.toChipList(item.roleMenus ?? item.rolemenus ?? '');
    const rolePermissions = this.toChipList(item.rolePermission ?? item.rolepermission ?? '');
    const isDeletedRaw = item.isDeleted ?? item.is_deleted;
    const isDeleted = isDeletedRaw === true || isDeletedRaw === 1
      || String(isDeletedRaw ?? '').trim().toLowerCase() === 'true'
      || String(isDeletedRaw ?? '').trim() === '1'
      || String(item.deletedAt ?? item.deleted_at ?? '').trim().length > 0;
    const sv = item.status;
    const normalizedStatus = isDeleted ? 'Deleted'
      : sv === 1 || sv === '1' || String(sv ?? '').trim().toLowerCase() === 'active' ? 'Active' : 'Inactive';
    return {
      id: Number(item.id) || 0,
      username: String(item.username ?? '').trim(),
      fullName: fullname, role, roleMenus, rolePermissions,
      status: normalizedStatus, isDeleted,
      orgId: item.orgId ?? null,
      orgName: item.orgName ?? null,
    };
  }

  private mapRoleItem(item: RoleApiItem): RoleOption {
    return {
      id: Number(item.id) || 0,
      name: String(item.roleName ?? item.rolename ?? '').trim(),
      orgId: item.orgId ?? null,
    };
  }

  private mapPermissionItem(item: PermissionKeyApiItem): PermissionOption {
    return { key: String(item.key ?? '').trim(), label: String(item.label ?? '').trim(), module: String(item.module ?? '').trim(), scope: String(item.scope ?? '').trim() };
  }

  private toChipList(value: unknown): string[] {
    return String(value ?? '').split(',').map((e) => e.trim()).filter((e) => e.length > 0);
  }

  private normalizeStatus(value: unknown): number {
    return value === 1 || value === '1' || String(value ?? '').trim().toLowerCase() === 'active' ? 1 : 0;
  }

  private toDateInputValue(value: unknown): string {
    if (!value) return '';
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return '';
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }

  private extractApiError(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
      return (error.response?.data as { message?: string } | undefined)?.message ?? fallback;
    }
    return fallback;
  }
}
