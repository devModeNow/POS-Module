import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IdleSessionService } from './shared/services/idle-session.service';
import { NotificationToastComponent } from './shared/components/common/notification-toast/notification-toast.component';
import { RbacService } from './shared/services/rbac.service';
import { AuthService } from './shared/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterModule, NotificationToastComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  title = 'Centralized Business Information System';

  constructor(
    private readonly idleSessionService: IdleSessionService,
    private readonly rbacService: RbacService,
    private readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.idleSessionService.start();
    void this.rbacService.syncEffectivePermissions().then(() => {
      this.authService.syncOrgContext();
    });
  }

  get isIdlePromptVisible(): boolean {
    return this.idleSessionService.idlePromptVisible;
  }

  continueIdleSession(): void {
    this.idleSessionService.respondToIdlePrompt(true);
  }

  endIdleSession(): void {
    this.idleSessionService.respondToIdlePrompt(false);
  }
}
