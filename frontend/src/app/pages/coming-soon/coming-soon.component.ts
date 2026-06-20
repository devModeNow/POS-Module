import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-coming-soon',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-white/[0.03] p-10 max-w-md w-full">
        <!-- Icon -->
        <div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-500/10">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" />
          </svg>
        </div>

        <!-- Module name -->
        <h2 class="text-xl font-semibold text-gray-800 dark:text-white/90">{{ moduleName }}</h2>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
          This module is part of <span class="font-medium text-brand-600 dark:text-brand-400">{{ orgName }}</span> and is currently under development.
        </p>

        <!-- Phase badge -->
        <div class="mt-5 inline-flex items-center gap-2 rounded-full bg-warning-50 dark:bg-warning-500/10 px-4 py-2 text-xs font-medium text-warning-700 dark:text-warning-400">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          </svg>
          Phase 2 — Coming Soon
        </div>

        <p class="mt-4 text-xs text-gray-400 dark:text-gray-500">
          Route: <code class="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-mono">/users/{{ routeKey }}</code>
        </p>
      </div>
    </div>
  `,
})
export class ComingSoonComponent {
  routeKey = '';
  moduleName = '';
  orgName = '';

  private readonly labelMap: Record<string, string> = {
    'job-orders':      'Job Orders',
    'customers':       'Customers',
    'vehicles':        'Vehicles',
    'inventory':       'Inventory',
    'technicians':     'Technicians',
    'invoices':        'Invoices',
    'service-history': 'Service History',
    'reports':         'Reports',
    'sales':           'Sales',
    'finance':         'Finance',
  };

  constructor(private readonly route: ActivatedRoute) {
    this.routeKey = this.route.snapshot.data['routeKey'] ?? this.route.snapshot.url[0]?.path ?? '';
    this.moduleName = this.labelMap[this.routeKey]
      ?? this.routeKey.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    this.orgName = this.route.snapshot.data['orgName'] ?? 'your organization';
  }
}
