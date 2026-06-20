import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/** @deprecated Use OrgService instead. Kept as a stub to avoid broken imports. */
@Injectable({ providedIn: 'root' })
export class BranchService {
  private subject = new BehaviorSubject<null>(null);
  readonly activeBranch$ = this.subject.asObservable();

  getActiveBranchId(): number | null { return null; }
  reset(): void {}
}
