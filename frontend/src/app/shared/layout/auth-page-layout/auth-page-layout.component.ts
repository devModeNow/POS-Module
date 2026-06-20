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
  private readonly defaultLogoLight = '/images/fwdslogo.png';
  private readonly defaultLogoDark  = '/images/fwdslogo-dark.png';

  logoLightSrc = this.defaultLogoLight;
  logoDarkSrc  = this.defaultLogoDark;

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
      this.logoLightSrc = settings?.businessLogoLight || settings?.businessLogo || this.defaultLogoLight;
      this.logoDarkSrc  = settings?.businessLogoDark  || settings?.businessLogo || this.defaultLogoDark;
    } catch {
      this.logoLightSrc = this.defaultLogoLight;
      this.logoDarkSrc  = this.defaultLogoDark;
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
