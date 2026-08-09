import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, OnInit, QueryList, ViewChildren } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';
import { SafeHtmlPipe } from '../../pipe/safe-html.pipe';
import { MenuKey, RbacService } from '../../services/rbac.service';
import { SidebarService } from '../../services/sidebar.service';
import { BusinessSettingsService } from '../../services/business-settings.service';
import { OrgService } from '../../services/org.service';

type NavItem = {
  name: string;
  icon: string;
  menuKey?: MenuKey;
  path?: string;
  new?: boolean;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

@Component({
  selector: 'app-sidebar',
  imports: [CommonModule, RouterModule, SafeHtmlPipe],
  templateUrl: './app-sidebar.component.html',
})
export class AppSidebarComponent {
  private readonly defaultBusinessLogoLight = '/images/fwdslogo.png';
  private readonly defaultBusinessLogoDark = '/images/fwdslogo-dark.png';
  logoLightSrc = this.defaultBusinessLogoLight;
  logoDarkSrc = this.defaultBusinessLogoDark;
  userDisplayName = '';
  userRoleName = '';
  companyName = '';

  private readonly allNavItems: NavItem[] = [
    {
      name: 'Dashboard',
      menuKey: 'dashboard',
      path: '/users/dashboard',
      icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V8.99998C3.25 10.2426 4.25736 11.25 5.5 11.25H9C10.2426 11.25 11.25 10.2426 11.25 8.99998V5.5C11.25 4.25736 10.2426 3.25 9 3.25H5.5ZM4.75 5.5C4.75 5.08579 5.08579 4.75 5.5 4.75H9C9.41421 4.75 9.75 5.08579 9.75 5.5V8.99998C9.75 9.41419 9.41421 9.74998 9 9.74998H5.5C5.08579 9.74998 4.75 9.41419 4.75 8.99998V5.5ZM5.5 12.75C4.25736 12.75 3.25 13.7574 3.25 15V18.5C3.25 19.7426 4.25736 20.75 5.5 20.75H9C10.2426 20.75 11.25 19.7427 11.25 18.5V15C11.25 13.7574 10.2426 12.75 9 12.75H5.5ZM4.75 15C4.75 14.5858 5.08579 14.25 5.5 14.25H9C9.41421 14.25 9.75 14.5858 9.75 15V18.5C9.75 18.9142 9.41421 19.25 9 19.25H5.5C5.08579 19.25 4.75 18.9142 4.75 18.5V15ZM12.75 5.5C12.75 4.25736 13.7574 3.25 15 3.25H18.5C19.7426 3.25 20.75 4.25736 20.75 5.5V8.99998C20.75 10.2426 19.7426 11.25 18.5 11.25H15C13.7574 11.25 12.75 10.2426 12.75 8.99998V5.5ZM15 4.75C14.5858 4.75 14.25 5.08579 14.25 5.5V8.99998C14.25 9.41419 14.5858 9.74998 15 9.74998H18.5C18.9142 9.74998 19.25 9.41419 19.25 8.99998V5.5C19.25 5.08579 18.9142 4.75 18.5 4.75H15ZM15 12.75C13.7574 12.75 12.75 13.7574 12.75 15V18.5C12.75 19.7426 13.7574 20.75 15 20.75H18.5C19.7426 20.75 20.75 19.7427 20.75 18.5V15C20.75 13.7574 19.7426 12.75 18.5 12.75H15ZM14.25 15C14.25 14.5858 14.5858 14.25 15 14.25H18.5C18.9142 14.25 19.25 14.5858 19.25 15V18.5C19.25 18.9142 18.9142 19.25 18.5 19.25H15C14.5858 19.25 14.25 18.9142 14.25 18.5V15Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Organizations',
      menuKey: 'organizations',
      path: '/users/organizations',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 5C3 3.89543 3.89543 3 5 3H19C20.1046 3 21 3.89543 21 5V7C21 8.10457 20.1046 9 19 9H5C3.89543 9 3 8.10457 3 7V5ZM5 5H19V7H5V5ZM3 11C3 10.4477 3.44772 10 4 10H10C10.5523 10 11 10.4477 11 11V19C11 19.5523 10.5523 20 10 20H4C3.44772 20 3 19.5523 3 19V11ZM5 12V18H9V12H5ZM13 11C13 10.4477 13.4477 10 14 10H20C20.5523 10 21 10.4477 21 11V19C21 19.5523 20.5523 20 20 20H14C13.4477 20 13 19.5523 13 19V11ZM15 12V18H19V12H15Z" fill="currentColor"/></svg>`,
    },
    {
      name: 'User Management',
      menuKey: 'user_management',
      path: '/users/user-management',
      icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C9.92893 2 8.25 3.67893 8.25 5.75C8.25 7.82107 9.92893 9.5 12 9.5C14.0711 9.5 15.75 7.82107 15.75 5.75C15.75 3.67893 14.0711 2 12 2ZM9.75 5.75C9.75 4.50736 10.7574 3.5 12 3.5C13.2426 3.5 14.25 4.50736 14.25 5.75C14.25 6.99264 13.2426 8 12 8C10.7574 8 9.75 6.99264 9.75 5.75ZM4 18.25C4 14.7982 6.79822 12 10.25 12H13.75C17.2018 12 20 14.7982 20 18.25V21.25C20 21.6642 19.6642 22 19.25 22C18.8358 22 18.5 21.6642 18.5 21.25V18.25C18.5 15.6266 16.3734 13.5 13.75 13.5H10.25C7.62665 13.5 5.5 15.6266 5.5 18.25V21.25C5.5 21.6642 5.16421 22 4.75 22C4.33579 22 4 21.6642 4 21.25V18.25Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Settings',
      menuKey: 'settings',
      path: '/users/settings',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.2588 2.75C10.2588 2.33579 10.5946 2 11.0088 2H12.9912C13.4054 2 13.7412 2.33579 13.7412 2.75V4.04918C14.3052 4.19587 14.8474 4.42032 15.3518 4.71557L16.2713 3.79604C16.5642 3.50314 17.0391 3.50314 17.332 3.79604L18.7339 5.19796C19.0268 5.49085 19.0268 5.96572 18.7339 6.25862L17.8144 7.17815C18.1097 7.6826 18.3341 8.2248 18.4808 8.78879H19.78C20.1942 8.78879 20.53 9.12458 20.53 9.53879V11.5212C20.53 11.9354 20.1942 12.2712 19.78 12.2712H18.4808C18.3341 12.8352 18.1097 13.3774 17.8144 13.8818L18.7339 14.8014C19.0268 15.0943 19.0268 15.5691 18.7339 15.862L17.332 17.264C17.0391 17.5569 16.5642 17.5569 16.2713 17.264L15.3518 16.3444C14.8474 16.6397 14.3052 16.8641 13.7412 17.0108V18.31C13.7412 18.7242 13.4054 19.06 12.9912 19.06H11.0088C10.5946 19.06 10.2588 18.7242 10.2588 18.31V17.0108C9.69483 16.8641 9.15263 16.6397 8.64819 16.3444L7.72866 17.264C7.43577 17.5569 6.96089 17.5569 6.668 17.264L5.26608 15.862C4.97319 15.5691 4.97319 15.0943 5.26608 14.8014L6.18562 13.8818C5.89036 13.3774 5.66591 12.8352 5.51922 12.2712H4.22C3.80579 12.2712 3.47 11.9354 3.47 11.5212V9.53879C3.47 9.12458 3.80579 8.78879 4.22 8.78879H5.51922C5.66591 8.2248 5.89036 7.6826 6.18562 7.17815L5.26608 6.25862C4.97319 5.96572 4.97319 5.49085 5.26608 5.19796L6.668 3.79604C6.96089 3.50314 7.43577 3.50314 7.72866 3.79604L8.64819 4.71557C9.15263 4.42032 9.69483 4.19587 10.2588 4.04918V2.75ZM12 8.02998C10.6193 8.02998 9.5 9.14926 9.5 10.53C9.5 11.9107 10.6193 13.03 12 13.03C13.3807 13.03 14.5 11.9107 14.5 10.53C14.5 9.14926 13.3807 8.02998 12 8.02998Z" fill="currentColor"/></svg>`,
    },
    {
      name: 'Accounting',
      menuKey: 'accounting',
      path: '/users/accounting',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4zm2 0h12v16H6V4zm2 3h3v2H8V7zm5 0h3v2h-3V7zm-5 4h3v2H8v-2zm5 0h3v2h-3v-2zm-5 4h3v2H8v-2zm5 0h3v2h-3v-2z" fill="currentColor"/></svg>`,
    },
  ];

  navItems: NavItem[] = [];
  othersItems: NavItem[] = [];
  readonly isPosOrg: boolean;

  openSubmenu: string | null | number = null;
  subMenuHeights: { [key: string]: number } = {};
  @ViewChildren('subMenu') subMenuRefs!: QueryList<ElementRef>;

  readonly isExpanded$;
  readonly isMobileOpen$;
  readonly isHovered$;

  private subscription: Subscription = new Subscription();

  constructor(
    public sidebarService: SidebarService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private rbacService: RbacService,
    private readonly businessSettingsService: BusinessSettingsService,
    private readonly orgService: OrgService,
  ) {
    this.isExpanded$ = this.sidebarService.isExpanded$;
    this.isMobileOpen$ = this.sidebarService.isMobileOpen$;
    this.isHovered$ = this.sidebarService.isHovered$;
    this.isPosOrg = rbacService.isPosOrg();
  }

  ngOnInit() {
    this.userDisplayName = this.rbacService.getDisplayName();
    this.userRoleName = this.formatRoleLabel(this.rbacService.getRoleName());
    this.companyName = this.orgService.getContext().name ?? '';
    void this.loadBusinessBranding();
    this.applyMenuAccess();

    this.subscription.add(
      this.router.events.subscribe((event) => {
        if (event instanceof NavigationEnd) {
          this.setActiveMenuFromRoute(this.router.url);
        }
      }),
    );

    this.subscription.add(
      combineLatest([this.isExpanded$, this.isMobileOpen$, this.isHovered$]).subscribe(
        ([isExpanded, isMobileOpen, isHovered]) => {
          if (!isExpanded && !isMobileOpen && !isHovered) {
            this.cdr.detectChanges();
          }
        },
      ),
    );

    this.setActiveMenuFromRoute(this.router.url);
  }

  private async loadBusinessBranding(): Promise<void> {
    try {
      const settings = await this.businessSettingsService.getBusinessProfile();
      this.logoLightSrc = settings?.businessLogoLight || settings?.businessLogo || this.defaultBusinessLogoLight;
      this.logoDarkSrc = settings?.businessLogoDark || settings?.businessLogo || this.defaultBusinessLogoDark;
      this.companyName = String(settings?.businessName ?? this.companyName).trim() || this.companyName;
    } catch {
      this.logoLightSrc = this.defaultBusinessLogoLight;
      this.logoDarkSrc = this.defaultBusinessLogoDark;
    }
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  isActive(path: string): boolean {
    return this.router.url === path;
  }

  toggleSubmenu(section: string, index: number) {
    const key = `${section}-${index}`;
    if (this.openSubmenu === key) {
      this.openSubmenu = null;
      this.subMenuHeights[key] = 0;
    } else {
      this.openSubmenu = key;
      setTimeout(() => {
        const el = document.getElementById(key);
        if (el) {
          this.subMenuHeights[key] = el.scrollHeight;
          this.cdr.detectChanges();
        }
      });
    }
  }

  onSidebarMouseEnter() {
    const canHover =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!canHover) return;
    if (!this.sidebarService.isExpandedValue) {
      this.sidebarService.setHovered(true);
    }
  }

  onSubmenuClick() {
    if (this.sidebarService.isMobileOpenValue) {
      this.sidebarService.setMobileOpen(false);
    }
  }

  private applyMenuAccess(): void {
    const isPlatform = this.rbacService.isPlatformUser();

    if (isPlatform) {
      // Platform user — show only the 4 platform menus they have access to
      this.navItems = this.allNavItems.filter(
        (item) => !item.menuKey || this.rbacService.canAccess(item.menuKey, 'canRead'),
      );
    } else {
      // Org user — build nav from their allowed menus (from roleMenus CSV)
      const allowedMenus = this.rbacService.getAllowedMenus();
      this.navItems = this.sortOrgMenus([...allowedMenus])
        .filter((key) => key.length > 0)
        .map((key) => this.buildOrgNavItem(key))
        .filter((item): item is NavItem => item !== null);
    }
  }

  private sortOrgMenus(menus: string[]): string[] {
    const priority = [
      'dashboard',
      'pos-dashboard',
      'pos-terminal',
      'pos-my-sales',
      'pos-stock-count',
      'pos-company-costs',
      'pos-staff',
      'pos-company-profile',
      'catering-dashboard',
      'inventory',
      'job-orders',
      'customers',
      'reports',
      'settings',
    ];

    return menus.sort((a, b) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.localeCompare(b);
    });
  }

  private buildOrgNavItem(menuKey: string): NavItem | null {
    const hiddenMenus = ['sales', 'vehicles', 'pos-audit-trail', 'user-management'];
    if (hiddenMenus.includes(menuKey)) return null;

    const labelMap: Record<string, string> = {
      'dashboard':       'Dashboard',
      'job-orders':      'Job Orders',
      'customers':       'Customers',
      'vehicles':        'Vehicles',
      'inventory':       'Inventory',
      'technicians':     'Technicians',
      'invoices':        'Invoices',
      'service-history': 'Service History',
      'sales':           'Sales',
      'finance':         'Finance',
      'accounting':      'Accounting',
      'reports':         'Reports',
      'user-management': 'User Management',
      'settings':        'Settings',
      'catering-dashboard': 'Catering Dashboard',
      'catering-schedules': 'Catering Schedules',
      'catering-menus':     'Catering Menus',
      'pos-dashboard':      'POS Sales',
      'pos-terminal':       'POS Sales',
      'pos-my-sales':       'My Sales',
      'pos-stock-count':    'End-of-Day Stock',
      'pos-company-costs':  'Company Costs',
      'pos-staff':          'On-Duty Staff',
      'pos-audit-trail':    'Audit Trail',
      'pos-company-profile': 'Company Profile',
    };
    const iconMap: Record<string, string> = {
      'dashboard':       `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V8.99998C3.25 10.2426 4.25736 11.25 5.5 11.25H9C10.2426 11.25 11.25 10.2426 11.25 8.99998V5.5C11.25 4.25736 10.2426 3.25 9 3.25H5.5ZM15 3.25C13.7574 3.25 12.75 4.25736 12.75 5.5V8.99998C12.75 10.2426 13.7574 11.25 15 11.25H18.5C19.7426 11.25 20.75 10.2426 20.75 8.99998V5.5C20.75 4.25736 19.7426 3.25 18.5 3.25H15ZM3.25 15C3.25 13.7574 4.25736 12.75 5.5 12.75H9C10.2426 12.75 11.25 13.7574 11.25 15V18.5C11.25 19.7426 10.2426 20.75 9 20.75H5.5C4.25736 20.75 3.25 19.7426 3.25 18.5V15ZM15 12.75C13.7574 12.75 12.75 13.7574 12.75 15V18.5C12.75 19.7426 13.7574 20.75 15 20.75H18.5C19.7426 20.75 20.75 19.7426 20.75 18.5V15C20.75 13.7574 19.7426 12.75 18.5 12.75H15Z" fill="currentColor"/></svg>`,
      'job-orders':      `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 2C8.41421 2 8.75 2.33579 8.75 2.75V3.75H15.25V2.75C15.25 2.33579 15.5858 2 16 2C16.4142 2 16.75 2.33579 16.75 2.75V3.75H18.5C19.7426 3.75 20.75 4.75736 20.75 6V19C20.75 20.2426 19.7426 21.25 18.5 21.25H5.5C4.25736 21.25 3.25 20.2426 3.25 19V6C3.25 4.75736 4.25736 3.75 5.5 3.75H7.25V2.75C7.25 2.33579 7.58579 2 8 2ZM4.75 9.75V19C4.75 19.4142 5.08579 19.75 5.5 19.75H18.5C18.9142 19.75 19.25 19.4142 19.25 19V9.75H4.75Z" fill="currentColor"/></svg>`,
      'customers':       `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7614 0 5-2.2386 5-5s-2.2386-5-5-5-5 2.2386-5 5 2.2386 5 5 5z" fill="currentColor"/><path d="M4 20c0-3.3137 2.6863-6 6-6h4c3.3137 0 6 2.6863 6 6v1H4v-1z" fill="currentColor"/></svg>`,
      'vehicles':        `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.316 6.88A2 2 0 0 1 7.22 5.5h9.56a2 2 0 0 1 1.904 1.38l1.04 3.12H20a1 1 0 1 1 0 2h-.5v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7.5v1a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V12H4a1 1 0 1 1 0-2h.276l1.04-3.12ZM7.5 14a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="currentColor"/></svg>`,
      'inventory':       `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V18.5C3.25 19.7426 4.25736 20.75 5.5 20.75H18.5001C19.7427 20.75 20.7501 19.7426 20.7501 18.5V5.5C20.7501 4.25736 19.7427 3.25 18.5001 3.25H5.5ZM6.25005 9.7143C6.25005 9.30008 6.58583 8.9643 7.00005 8.9643L17 8.96429C17.4143 8.96429 17.75 9.30008 17.75 9.71429C17.75 10.1285 17.4143 10.4643 17 10.4643L7.00005 10.4643C6.58583 10.4643 6.25005 10.1285 6.25005 9.7143ZM6.25005 14.2857C6.25005 13.8715 6.58583 13.5357 7.00005 13.5357H17C17.4143 13.5357 17.75 13.8715 17.75 14.2857C17.75 14.6999 17.4143 15.0357 17 15.0357H7.00005C6.58583 15.0357 6.25005 14.6999 6.25005 14.2857Z" fill="currentColor"></path></svg>`,
      'technicians':     `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C9.92893 2 8.25 3.67893 8.25 5.75C8.25 7.82107 9.92893 9.5 12 9.5C14.0711 9.5 15.75 7.82107 15.75 5.75C15.75 3.67893 14.0711 2 12 2ZM4 18.25C4 14.7982 6.79822 12 10.25 12H13.75C17.2018 12 20 14.7982 20 18.25V21.25H4V18.25Z" fill="currentColor"/></svg>`,
      'invoices':        `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M6 3.25C4.48122 3.25 3.25 4.48122 3.25 6V18C3.25 19.5188 4.48122 20.75 6 20.75H18C19.5188 20.75 20.75 19.5188 20.75 18V9.81066L16.1893 5.25H6ZM7.25 12.5C7.25 12.0858 7.58579 11.75 8 11.75H16C16.4142 11.75 16.75 12.0858 16.75 12.5C16.75 12.9142 16.4142 13.25 16 13.25H8C7.58579 13.25 7.25 12.9142 7.25 12.5ZM8 15.25C7.58579 15.25 7.25 15.5858 7.25 16C7.25 16.4142 7.58579 16.75 8 16.75H13.5C13.9142 16.75 14.25 16.4142 14.25 16C14.25 15.5858 13.9142 15.25 13.5 15.25H8Z" fill="currentColor"/></svg>`,
      'service-history': `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM12.75 7C12.75 6.58579 12.4142 6.25 12 6.25C11.5858 6.25 11.25 6.58579 11.25 7V12C11.25 12.2652 11.3554 12.5196 11.5429 12.7071L14.5429 15.7071C14.8358 16 15.3107 16 15.6036 15.7071C15.8964 15.4142 15.8964 14.9393 15.6036 14.6464L12.75 11.7929V7Z" fill="currentColor"/></svg>`,
      'reports':         `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 3h18v18H3V3zm2 2v14h14V5H5zm2 10h2v2H7v-2zm4-4h2v6h-2V11zm4-4h2v10h-2V7z" fill="currentColor"/></svg>`,
      'sales':           `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 5a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5zm2 1v12h16V6H4zm2 3h12v2H6V9zm0 4h8v2H6v-2z" fill="currentColor"/></svg>`,
      'finance':         `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 5v1.07A4.002 4.002 0 0 1 12 16a4.002 4.002 0 0 1-1-7.93V7h2zm-1 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" fill="currentColor"/></svg>`,
      'accounting':      `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4zm2 0h12v16H6V4zm2 3h3v2H8V7zm5 0h3v2h-3V7zm-5 4h3v2H8v-2zm5 0h3v2h-3v-2zm-5 4h3v2H8v-2zm5 0h3v2h-3v-2z" fill="currentColor"/></svg>`,
      'user-management': `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C9.92893 2 8.25 3.67893 8.25 5.75C8.25 7.82107 9.92893 9.5 12 9.5C14.0711 9.5 15.75 7.82107 15.75 5.75C15.75 3.67893 14.0711 2 12 2ZM4 18.25C4 14.7982 6.79822 12 10.25 12H13.75C17.2018 12 20 14.7982 20 18.25V21.25H4V18.25Z" fill="currentColor"></path></svg>`,
      'settings':        `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.2588 2.75C10.2588 2.33579 10.5946 2 11.0088 2H12.9912C13.4054 2 13.7412 2.33579 13.7412 2.75V4.04918C14.3052 4.19587 14.8474 4.42032 15.3518 4.71557L16.2713 3.79604C16.5642 3.50314 17.0391 3.50314 17.332 3.79604L18.7339 5.19796C19.0268 5.49085 19.0268 5.96572 18.7339 6.25862L17.8144 7.17815C18.1097 7.6826 18.3341 8.2248 18.4808 8.78879H19.78C20.1942 8.78879 20.53 9.12458 20.53 9.53879V11.5212C20.53 11.9354 20.1942 12.2712 19.78 12.2712H18.4808C18.3341 12.8352 18.1097 13.3774 17.8144 13.8818L18.7339 14.8014C19.0268 15.0943 19.0268 15.5691 18.7339 15.862L17.332 17.264C17.0391 17.5569 16.5642 17.5569 16.2713 17.264L15.3518 16.3444C14.8474 16.6397 14.3052 16.8641 13.7412 17.0108V18.31C13.7412 18.7242 13.4054 19.06 12.9912 19.06H11.0088C10.5946 19.06 10.2588 18.7242 10.2588 18.31V17.0108C9.69483 16.8641 9.15263 16.6397 8.64819 16.3444L7.72866 17.264C7.43577 17.5569 6.96089 17.5569 6.668 17.264L5.26608 15.862C4.97319 15.5691 4.97319 15.0943 5.26608 14.8014L6.18562 13.8818C5.89036 13.3774 5.66591 12.8352 5.51922 12.2712H4.22C3.80579 12.2712 3.47 11.9354 3.47 11.5212V9.53879C3.47 9.12458 3.80579 8.78879 4.22 8.78879H5.51922C5.66591 8.2248 5.89036 7.6826 6.18562 7.17815L5.26608 6.25862C4.97319 5.96572 4.97319 5.49085 5.26608 5.19796L6.668 3.79604C6.96089 3.50314 7.43577 3.50314 7.72866 3.79604L8.64819 4.71557C9.15263 4.42032 9.69483 4.19587 10.2588 4.04918V2.75ZM12 8.02998C10.6193 8.02998 9.5 9.14926 9.5 10.53C9.5 11.9107 10.6193 13.03 12 13.03C13.3807 13.03 14.5 11.9107 14.5 10.53C14.5 9.14926 13.3807 8.02998 12 8.02998Z" fill="currentColor"/></svg>`,
      'catering-dashboard': `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm4 3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8zm6 2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-6z" fill="currentColor"/></svg>`,
      'catering-schedules': `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 2a.75.75 0 0 1 .75.75V4h6.5V2.75a.75.75 0 0 1 1.5 0V4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1.25V2.75A.75.75 0 0 1 8 2zM6 9v9h12V9H6zm2 2h3v3H8v-3z" fill="currentColor"/></svg>`,
      'catering-menus':     `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 6a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm0 6a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm1 5a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4z" fill="currentColor"/></svg>`,
      'pos-dashboard':      `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 3a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4zm0 10a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H4zm3 2h2v2H7v-2zm4 0h6v2h-6v-2z" fill="currentColor"/></svg>`,
      'pos-terminal':       `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm4 3a1 1 0 0 0 0 2h10a1 1 0 1 0 0-2H7zm0 4a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7zM6 19h12v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1z" fill="currentColor"/></svg>`,
      'pos-my-sales':       `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" fill="currentColor"/></svg>`,
      'pos-stock-count':    `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" stroke="currentColor" stroke-width="2" fill="none"/></svg>`,
      'pos-company-costs':  `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" stroke="currentColor" stroke-width="2" fill="none"/></svg>`,
      'pos-staff':          `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C9.92893 2 8.25 3.67893 8.25 5.75C8.25 7.82107 9.92893 9.5 12 9.5C14.0711 9.5 15.75 7.82107 15.75 5.75C15.75 3.67893 14.0711 2 12 2ZM4 18.25C4 14.7982 6.79822 12 10.25 12H13.75C17.2018 12 20 14.7982 20 18.25V21.25H4V18.25Z" fill="currentColor"/></svg>`,
      'pos-audit-trail':    `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 5v1.07A4.002 4.002 0 0112 16a4.002 4.002 0 01-1-7.93V7h2z" fill="currentColor"/></svg>`,
      'pos-company-profile': `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12H4V4zm2 0v10h8V4H6zm10 2h2a2 2 0 012 2v10a2 2 0 01-2 2h-8v-2h8V8h-2V6z" fill="currentColor"/></svg>`,
    };

    const label = labelMap[menuKey] ?? menuKey.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const icon = iconMap[menuKey] ?? `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/></svg>`;
    const routeMap: Record<string, string> = {
      'dashboard':       '/users/dashboard',
      'job-orders':      '/users/job-orders',
      'customers':       '/users/customers',
      'vehicles':        '/users/vehicles',
      'inventory':       '/users/inventory',
      'technicians':     '/users/technicians',
      'invoices':        '/users/invoices',
      'service-history': '/users/service-history',
      'reports':         '/users/reports',
      'accounting':      '/users/accounting',
      'sales':           '/users/sales',
      'finance':         '/users/finance',
      'user-management': '/users/user-management',
      'settings':        '/users/settings',
      'catering-dashboard': '/users/catering-dashboard',
      'catering-schedules': '/users/catering-schedules',
      'catering-menus':     '/users/catering-menus',
      'pos-dashboard':      '/users/pos-dashboard',
      'pos-terminal':       '/users/pos-terminal',
      'pos-my-sales':       '/users/pos-my-sales',
      'pos-stock-count':    '/users/pos-stock-count',
      'pos-company-costs':  '/users/pos-company-costs',
      'pos-staff':          '/users/pos-staff',
      'pos-audit-trail':    '/users/pos-audit-trail',
      'pos-company-profile': '/users/pos-company-profile',
    };
    const path = routeMap[menuKey] ?? `/users/${menuKey}`;
    if (menuKey === 'inventory' && this.isPosOrg) {
      return {
        name: label,
        menuKey: menuKey as MenuKey,
        path,
        icon,
        subItems: [
          { name: 'Inventory', path: '/users/inventory' },
          { name: 'Purchase Orders', path: '/users/purchase-orders' },
        ],
      };
    }
    return { name: label, menuKey: menuKey as MenuKey, path, icon };
  }

  private formatRoleLabel(role: string): string {
    const normalized = String(role ?? '').trim();
    if (!normalized) return 'User';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private setActiveMenuFromRoute(currentUrl: string) {
    const menuGroups = [
      { items: this.navItems, prefix: 'main' },
      { items: this.othersItems, prefix: 'others' },
    ];

    menuGroups.forEach((group) => {
      group.items.forEach((nav, i) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (currentUrl === subItem.path) {
              const key = `${group.prefix}-${i}`;
              this.openSubmenu = key;
              setTimeout(() => {
                const el = document.getElementById(key);
                if (el) {
                  this.subMenuHeights[key] = el.scrollHeight;
                  this.cdr.detectChanges();
                }
              });
            }
          });
        }
      });
    });
  }
}
