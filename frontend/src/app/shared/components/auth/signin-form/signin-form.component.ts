import { Component } from '@angular/core';
import { LabelComponent } from '../../form/label/label.component';
import { CheckboxComponent } from '../../form/input/checkbox.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { InputFieldComponent } from '../../form/input/input-field.component';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { RbacService } from '../../../services/rbac.service';
import { PosPrintHubService } from '../../../services/pos-printhub.service';
import { PosReceiptPrintService } from '../../../services/pos-receipt-print.service';
import axios from 'axios';

@Component({
  selector: 'app-signin-form',
  imports: [
    LabelComponent,
    CheckboxComponent,
    ButtonComponent,
    InputFieldComponent,
    RouterModule,
    FormsModule
],
  templateUrl: './signin-form.component.html',
  styles: ``
})
export class SigninFormComponent {
  constructor(
    private readonly authService: AuthService,
    private readonly rbacService: RbacService,
    private readonly router: Router,
    private readonly printHub: PosPrintHubService,
    private readonly receiptPrint: PosReceiptPrintService,
  ) {}

  showPassword = false;
  isChecked = false;

  username = '';
  password = '';
  isSubmitting = false;
  errorMessage = '';

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  async onSignIn() {
    if (this.isSubmitting) {
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      const result = await this.authService.login(this.username, this.password, this.isChecked);

      if (!result.success) {
        this.errorMessage = result.message ?? 'Invalid username or password';
        return;
      }

      // Use the login click gesture to queue the printer prompt for cashier users only.
      await this.connectPrintHubOnLogin();

      await this.router.navigateByUrl(this.getPostLoginRoute());
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;
        if (apiMessage) {
          this.errorMessage = apiMessage;
        } else if (error.code === 'ERR_NETWORK' || !error.response) {
          this.errorMessage =
            'Unable to reach backend API. Check that the backend is running and reachable.';
        } else {
          this.errorMessage = 'Unable to reach backend API';
        }
      } else {
        this.errorMessage = 'Unexpected error during sign in';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  /**
   * After login: try silent reconnect. On tablets the Sign In click gesture is
   * already consumed by the login API await, so we cannot open the Bluetooth
   * picker here — queue a post-login Connect prompt instead.
   */
  private async connectPrintHubOnLogin(): Promise<void> {
    try {
      if (!this.rbacService.isCashier()) return;

      await this.receiptPrint.restoreSavedPrinterConnection();
      if (this.printHub.isConnected()) return;

      this.printHub.requestConnectPrompt();
    } catch {
      try {
        this.printHub.requestConnectPrompt();
      } catch {
        /* ignore */
      }
    }
  }

  private getPostLoginRoute(): string {
    if (this.rbacService.isCashier()) {
      return '/users/pos-dashboard';
    }

    const menus = this.rbacService.getAllowedMenus();

    if (this.rbacService.isPosOrg() && menus.has('dashboard')) {
      return '/users/dashboard';
    }

    if (menus.has('pos-dashboard') || menus.has('pos-terminal')) {
      return '/users/pos-dashboard';
    }

    if (menus.has('catering-dashboard')) {
      return '/users/catering-dashboard';
    }

    if (menus.has('dashboard')) {
      return '/users/dashboard';
    }

    // Otherwise, navigate to the first available menu
    const firstMenu = [...menus].find(m => m.length > 0);
    if (firstMenu) {
      return `/users/${firstMenu}`;
    }

    // Fallback
    return '/users/dashboard';
  }
}
