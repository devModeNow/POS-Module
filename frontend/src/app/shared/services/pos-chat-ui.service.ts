import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type PosChatOpenRequest = {
  mode: 'team' | 'private';
  userId?: number;
  userName?: string;
};

/** Opens the floating chat widget from notifications or other UI. */
@Injectable({ providedIn: 'root' })
export class PosChatUiService {
  private readonly openSubject = new Subject<PosChatOpenRequest>();
  readonly openRequests$ = this.openSubject.asObservable();

  openTeamChat(): void {
    this.openSubject.next({ mode: 'team' });
  }

  openPrivateChat(userId: number, userName?: string): void {
    this.openSubject.next({ mode: 'private', userId, userName });
  }
}
