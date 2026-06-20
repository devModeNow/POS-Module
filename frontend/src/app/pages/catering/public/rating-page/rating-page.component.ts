import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiClient } from '../../../../shared/services/api-client';

type PageState = 'loading' | 'form' | 'success' | 'error';

interface ValidateResponse {
  success: boolean;
  data?: { scheduleId: number };
  message?: string;
}

interface SubmitResponse {
  success: boolean;
  message?: string;
}

@Component({
  selector: 'app-rating-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rating-page.component.html',
})
export class RatingPageComponent implements OnInit {
  state: PageState = 'loading';
  errorMessage = '';
  token = '';

  // Form fields
  rating = 0;
  hoverRating = 0;
  review = '';
  isSubmitting = false;
  submitError = '';

  readonly maxReviewLength = 1000;
  readonly stars = [1, 2, 3, 4, 5];

  constructor(private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.state = 'error';
      this.errorMessage = 'Invalid rating link. No token provided.';
      return;
    }
    this.validateToken();
  }

  private async validateToken(): Promise<void> {
    try {
      const response = await apiClient.get<ValidateResponse>(
        `/api/catering/feedback/rating/${this.token}`,
      );
      if (response.data.success) {
        this.state = 'form';
      } else {
        this.state = 'error';
        this.errorMessage = response.data.message || 'This rating link is invalid or has expired.';
      }
    } catch (err: unknown) {
      this.state = 'error';
      const axiosErr = err as { response?: { data?: { message?: string }; status?: number } };
      if (axiosErr.response?.data?.message) {
        this.errorMessage = axiosErr.response.data.message;
      } else if (axiosErr.response?.status === 404) {
        this.errorMessage = 'This rating link is invalid or has expired.';
      } else {
        this.errorMessage = 'Unable to validate the rating link. Please try again later.';
      }
    }
  }

  setRating(value: number): void {
    this.rating = value;
    this.submitError = '';
  }

  setHover(value: number): void {
    this.hoverRating = value;
  }

  clearHover(): void {
    this.hoverRating = 0;
  }

  get displayRating(): number {
    return this.hoverRating || this.rating;
  }

  get isFormValid(): boolean {
    return this.rating >= 1 && this.rating <= 5 && this.review.length <= this.maxReviewLength;
  }

  get reviewCharCount(): number {
    return this.review.length;
  }

  async submitRating(): Promise<void> {
    if (!this.isFormValid || this.isSubmitting) return;

    this.isSubmitting = true;
    this.submitError = '';

    try {
      const payload: { rating: number; comment?: string } = { rating: this.rating };
      if (this.review.trim()) {
        payload.comment = this.review.trim();
      }

      const response = await apiClient.post<SubmitResponse>(
        `/api/catering/feedback/rating/${this.token}`,
        payload,
      );

      if (response.data.success) {
        this.state = 'success';
      } else {
        this.submitError = response.data.message || 'Failed to submit your rating. Please try again.';
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      if (axiosErr.response?.data?.message) {
        this.submitError = axiosErr.response.data.message;
      } else {
        this.submitError = 'Unable to submit your rating. Please try again later.';
      }
    } finally {
      this.isSubmitting = false;
    }
  }
}
