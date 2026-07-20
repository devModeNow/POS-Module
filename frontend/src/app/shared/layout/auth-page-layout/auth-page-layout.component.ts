import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GridShapeComponent } from '../../components/common/grid-shape/grid-shape.component';
import { RouterModule } from '@angular/router';
import { ThemeToggleTwoComponent } from '../../components/common/theme-toggle-two/theme-toggle-two.component';
import { BusinessSettingsService } from '../../services/business-settings.service';
import { OrgService } from '../../services/org.service';

interface PublicOrg {
  id: number;
  code: string;
  name: string;
  logoUrl: string | null;
}

@Component({
  selector: 'app-auth-page-layout',
  imports: [CommonModule, GridShapeComponent, RouterModule, ThemeToggleTwoComponent],
  templateUrl: './auth-page-layout.component.html',
  styles: ``
})
export class AuthPageLayoutComponent implements OnInit {
  /** Neutral placeholder when no company logo is uploaded yet (not a different brand). */
  private readonly emptyLogo = 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">
      <rect width="320" height="80" fill="transparent"/>
      <text x="160" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#64748b">Company Logo</text>
    </svg>`,
  );

  logoLightSrc = this.emptyLogo;
  logoDarkSrc = this.emptyLogo;
  hasCompanyLogo = false;

  orgs: PublicOrg[] = [];

  constructor(
    private readonly businessSettingsService: BusinessSettingsService,
    private readonly orgService: OrgService,
  ) {}

  ngOnInit(): void {
    void this.loadBranding();
    void this.loadOrgs();
  }

  private async loadBranding(): Promise<void> {
    try {
      const settings = await this.businessSettingsService.getPublicBusinessProfile();
      const light = String(settings?.businessLogoLight || settings?.businessLogo || '').trim();
      const dark = String(settings?.businessLogoDark || settings?.businessLogo || '').trim();
      if (light || dark) {
        this.hasCompanyLogo = true;
        this.logoLightSrc = light || dark;
        this.logoDarkSrc = dark || light;
      } else {
        this.hasCompanyLogo = false;
        this.logoLightSrc = this.emptyLogo;
        this.logoDarkSrc = this.emptyLogo;
      }
    } catch {
      this.hasCompanyLogo = false;
      this.logoLightSrc = this.emptyLogo;
      this.logoDarkSrc = this.emptyLogo;
    }
  }

  private async loadOrgs(): Promise<void> {
    try {
      this.orgs = await this.orgService.getPublicOrgs();
    } catch {
      this.orgs = [];
    }
  }

  /** Fallback: first letter of org name as avatar when no logo is set */
  orgInitial(name: string): string {
    return (name ?? '?').charAt(0).toUpperCase();
  }
}
