import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { RbacService } from '../../shared/services/rbac.service';
import { OrgService } from '../../shared/services/org.service';

type AccountingTab = 'sales' | 'expenses' | 'vouchers';

interface OrgOption {
  id: number;
  name: string;
  code: string;
}

@Component({
  selector: 'app-accounting',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './accounting.component.html',
})
export class AccountingComponent implements OnInit {
  activeTab: AccountingTab = 'sales';
  selectedOrgId: number | null = null;
  organizations: OrgOption[] = [];
  isPlatformUser = false;
  isLoading = false;

  readonly tabs: Array<{ key: AccountingTab; label: string; icon: string }> = [
    { key: 'sales', label: 'Sales', icon: '₱' },
    { key: 'expenses', label: 'Expenses', icon: '📊' },
    { key: 'vouchers', label: 'Vouchers', icon: '📄' },
  ];

  constructor(
    private readonly rbacService: RbacService,
    private readonly orgService: OrgService,
  ) {}

  ngOnInit(): void {
    this.isPlatformUser = this.rbacService.isPlatformUser();
    if (this.isPlatformUser) {
      void this.loadOrganizations();
    }
  }

  async loadOrganizations(): Promise<void> {
    try {
      const response = await this.orgService.getAll();
      const orgs = response?.data ?? [];
      this.organizations = orgs.map((o: any) => ({
        id: o.id,
        name: o.name ?? o.org_name ?? '',
        code: o.code ?? o.org_code ?? '',
      }));
    } catch {
      this.organizations = [];
    }
  }

  setTab(tab: AccountingTab): void {
    this.activeTab = tab;
  }

  onOrgChange(): void {
    // Placeholder: reload data for the selected organization
    this.isLoading = true;
    setTimeout(() => {
      this.isLoading = false;
    }, 500);
  }

  getTabClass(tab: AccountingTab): string {
    return this.activeTab === tab
      ? 'border-brand-500 text-brand-700 bg-brand-50 dark:border-brand-400 dark:text-brand-300 dark:bg-brand-500/10'
      : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200';
  }
}
