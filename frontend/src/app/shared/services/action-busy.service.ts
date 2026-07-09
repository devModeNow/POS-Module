import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ActionBusyService {
  private readonly activeKeys = signal(new Set<string>());

  readonly isBusy = computed(() => this.activeKeys().size > 0);

  busy(key: string): boolean {
    return this.activeKeys().has(key);
  }

  start(key: string): void {
    const next = new Set(this.activeKeys());
    next.add(key);
    this.activeKeys.set(next);
  }

  end(key: string): void {
    const next = new Set(this.activeKeys());
    next.delete(key);
    this.activeKeys.set(next);
  }

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.start(key);
    try {
      return await fn();
    } finally {
      this.end(key);
    }
  }
}
