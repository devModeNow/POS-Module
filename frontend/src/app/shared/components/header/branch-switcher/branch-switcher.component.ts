import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropdownComponent } from '../../ui/dropdown/dropdown.component';
import { RbacService } from '../../../services/rbac.service';
import { OrgListItem, OrgService } from '../../../services/org.service';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-branch-switcher',
  templateUrl: './branch-switcher.component.html',
  imports: [CommonModule, DropdownComponent],
})
export class BranchSwitcherComponent implements OnInit {
  isOpen = false;
  isLoading = false;
  orgs: OrgListItem[] = [];

  constructor(
    private readonly rbacService: RbacService,
    private readonly orgService: OrgService,
    private readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    if (this.isPlatformUser) {
      void this.loadOrgs();
    }
  }

  /** True when the logged-in user is a platform-level user (no org assigned). */
  get isPlatformUser(): boolean {
    return this.rbacService.isPlatformUser();
  }

  /** The active org name shown in the badge. */
  get activeOrgName(): string {
    return this.orgService.getContext().name ?? 'Platform';
  }

  get activeOrgId(): number | null {
    return this.orgService.getOrgId();
  }

  toggleDropdown(): void {
    if (!this.isPlatformUser) return;
    this.isOpen = !this.isOpen;
  }

  closeDropdown(): void {
    this.isOpen = false;
  }

  async selectOrg(org: OrgListItem): Promise<void> {
    if (this.activeOrgId === org.id) { this.closeDropdown(); return; }
    // Push org context and reload so all API calls pick up the new org
    this.orgService.setContext({ id: org.id, code: org.code, name: org.name });
    this.closeDropdown();
    try { await this.authService.refreshSession(); } catch { /* ignore */ }
    window.location.reload();
  }

  async selectPlatform(): Promise<void> {
    if (this.activeOrgId === null) { this.closeDropdown(); return; }
    this.orgService.setContext({ id: null, code: null, name: null });
    this.closeDropdown();
    try { await this.authService.refreshSession(); } catch { /* ignore */ }
    window.location.reload();
  }

  private async loadOrgs(): Promise<void> {
    this.isLoading = true;
    try {
      const res = await this.orgService.getAll();
      this.orgs = (res.data ?? []).filter((o) => o.isActive);
    } catch {
      this.orgs = [];
    } finally {
      this.isLoading = false;
    }
  }
}
