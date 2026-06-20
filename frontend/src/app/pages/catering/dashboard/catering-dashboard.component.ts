import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { apiClient } from '../../../shared/services/api-client';

interface DashboardMetrics {
  pendingCount: number;
  inProgressCount: number;
  totalSales: number;
  totalExpenses: number;
}

interface FeedbackRecord {
  id: number;
  customerName: string;
  rating: number;
  review: string | null;
  feedbackType: string;
  submittedAt: string;
  eventDate: string;
}

interface FeedbackListResponse {
  items: FeedbackRecord[];
  averageRating: number;
  total: number;
  page: number;
  pageSize: number;
}

@Component({
  selector: 'app-catering-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './catering-dashboard.component.html',
})
export class CateringDashboardComponent implements OnInit {
  state: 'loading' | 'loaded' | 'error' = 'loading';
  errorMessage = '';

  // Metrics
  metrics: DashboardMetrics = {
    pendingCount: 0,
    inProgressCount: 0,
    totalSales: 0,
    totalExpenses: 0,
  };

  // Feedback
  feedbackItems: FeedbackRecord[] = [];
  averageRating = 0;

  ngOnInit(): void {
    void this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    this.state = 'loading';
    this.errorMessage = '';

    try {
      const [metricsRes, feedbackRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DashboardMetrics }>('/api/catering/dashboard/metrics'),
        apiClient.get<{ success: boolean; data: FeedbackListResponse }>('/api/catering/dashboard/feedback'),
      ]);

      if (metricsRes.data.success && metricsRes.data.data) {
        this.metrics = metricsRes.data.data;
      }

      if (feedbackRes.data.success && feedbackRes.data.data) {
        this.feedbackItems = feedbackRes.data.data.items ?? [];
        this.averageRating = feedbackRes.data.data.averageRating ?? 0;
      }

      this.state = 'loaded';
    } catch {
      this.state = 'error';
      this.errorMessage = 'Failed to load dashboard data. Please try again.';
    }
  }

  retry(): void {
    void this.loadDashboard();
  }

  formatCurrency(value: number): string {
    return value.toFixed(2);
  }

  getStarArray(rating: number): boolean[] {
    return Array.from({ length: 5 }, (_, i) => i < rating);
  }
}
