import { Component, OnInit } from '@angular/core';
import { DropdownComponent } from '../../ui/dropdown/dropdown.component';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { DropdownItemTwoComponent } from '../../ui/dropdown/dropdown-item/dropdown-item.component-two';
import { AuthService } from '../../../services/auth.service';
import { RbacService } from '../../../services/rbac.service';
import { UserManagementService } from '../../../services/user-management.service';
import { PROFILE_PICTURE_SESSION_KEY } from '../../../services/profile.constants';

@Component({
  selector: 'app-user-dropdown',
  templateUrl: './user-dropdown.component.html',
  imports:[CommonModule,RouterModule,DropdownComponent,DropdownItemTwoComponent]
})
export class UserDropdownComponent implements OnInit {
  readonly defaultAvatar = '/images/user/faceless-avatar.svg';
  avatarSrc = this.defaultAvatar;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly rbacService: RbacService,
    private readonly users: UserManagementService,
  ) {}

  ngOnInit(): void {
    const cached = sessionStorage.getItem(PROFILE_PICTURE_SESSION_KEY);
    if (cached) {
      this.avatarSrc = cached;
      return;
    }
    void this.users.getMe().then((r) => {
      const picture = String(r.data?.profilePicture ?? '').trim();
      if (picture) {
        this.avatarSrc = picture;
        sessionStorage.setItem(PROFILE_PICTURE_SESSION_KEY, picture);
      }
    });
  }

  isOpen = false;

  toggleDropdown() {
    this.isOpen = !this.isOpen;
  }

  closeDropdown() {
    this.isOpen = false;
  }

  get displayName(): string {
    return this.rbacService.getDisplayName();
  }

  get email(): string {
    return this.rbacService.getEmail();
  }

  async onSignOut() {
    this.authService.logout();
    this.closeDropdown();
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
