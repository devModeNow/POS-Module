import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { DatePickerComponent } from '../../../../shared/components/form/date-picker/date-picker.component';
import { apiClient } from '../../../../shared/services/api-client';

interface PackageItem {
  menuItemId: number;
  menuItemName: string;
  category: string;
  selectionLimit: number;
  imageUrl: string | null;
  isTopPick: boolean;
}

interface CateringPackage {
  id: number;
  name: string;
  pricePerHead: number;
  minPax: number;
  imageUrl: string | null;
  isBestSeller: boolean;
  promoText: string | null;
  avgRating: number | null;
  ratingCount: number;
  items: PackageItem[];
}

interface CategoryGroup {
  category: string;
  items: PackageItem[];
  selectionLimit: number;
}

type ComponentState = 'form' | 'menu-selection' | 'feedback' | 'done';

@Component({
  selector: 'app-scheduling-form',
  imports: [CommonModule, ReactiveFormsModule, FormsModule, DatePickerComponent],
  templateUrl: './scheduling-form.component.html',
})
export class SchedulingFormComponent implements OnInit {
  // State management
  state: ComponentState = 'form';

  // Form
  schedulingForm!: FormGroup;
  feedbackForm!: FormGroup;

  // Data
  packages: CateringPackage[] = [];
  createdScheduleId: number | null = null;

  // Package selection
  selectedPackage: CateringPackage | null = null;
  categoryGroups: CategoryGroup[] = [];
  menuSelections: Record<string, Set<number>> = {};

  // UI state
  isLoadingPackages = true;
  isSubmitting = false;
  isSubmittingFeedback = false;
  packageLoadError = '';
  submitError = '';
  feedbackError = '';
  menuSelectionError = '';

  // STS Catering org ID
  private readonly orgId = 2;

  // Default logo for items without images
  orgLogoUrl: string | null = null;

  constructor(private fb: FormBuilder) {}

  ngOnInit(): void {
    this.initSchedulingForm();
    this.initFeedbackForm();
    this.loadPackages();
    this.loadOrgLogo();
  }

  private async loadOrgLogo(): Promise<void> {
    try {
      const r = await apiClient.get<{ success: boolean; data?: { logoLight?: string; logoDark?: string } }>(
        `/api/organizations/public/${this.orgId}/branding`
      );
      if (r.data.success && r.data.data) {
        this.orgLogoUrl = (r.data.data as any).logoLight || (r.data.data as any).logoDark || null;
      }
    } catch {
      // Silently fail
    }
  }

  private initSchedulingForm(): void {
    this.schedulingForm = this.fb.group({
      customerName: ['', [Validators.required, Validators.maxLength(100)]],
      contactNumber: ['', [Validators.required, Validators.maxLength(15), Validators.pattern(/^\d+$/)]],
      venue: ['', [Validators.required, Validators.maxLength(200)]],
      eventDate: ['', [Validators.required]],
      pax: [null, [Validators.required, Validators.min(1)]],
    });
  }

  private initFeedbackForm(): void {
    this.feedbackForm = this.fb.group({
      rating: [null, [Validators.required, Validators.min(1), Validators.max(5)]],
      comment: ['', [Validators.maxLength(500)]],
    });
  }

  private futureDateValidator(control: AbstractControl): ValidationErrors | null {
    if (!control.value) return null;
    const selected = new Date(control.value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selected.setHours(0, 0, 0, 0);
    return selected > today ? null : { futureDate: true };
  }

  async loadPackages(): Promise<void> {
    this.isLoadingPackages = true;
    this.packageLoadError = '';
    try {
      const response = await apiClient.get<{ success: boolean; data?: CateringPackage[]; message?: string }>(
        `/api/catering/menus/packages/public/${this.orgId}`
      );
      if (response.data.success && response.data.data) {
        this.packages = response.data.data;
      } else {
        this.packageLoadError = response.data.message || 'Failed to load packages';
      }
    } catch {
      this.packageLoadError = 'Could not load packages. Please try again later.';
    } finally {
      this.isLoadingPackages = false;
    }
  }

  // ── Package Selection ─────────────────────────────────────────────────────

  selectPackage(pkg: CateringPackage): void {
    this.selectedPackage = pkg;
    this.buildCategoryGroups(pkg);
    // Update pax min validator
    this.schedulingForm.get('pax')?.setValidators([Validators.required, Validators.min(pkg.minPax)]);
    this.schedulingForm.get('pax')?.updateValueAndValidity();
  }

  deselectPackage(): void {
    this.selectedPackage = null;
    this.categoryGroups = [];
    this.menuSelections = {};
    this.menuSelectionError = '';
    this.schedulingForm.get('pax')?.setValidators([Validators.required, Validators.min(1)]);
    this.schedulingForm.get('pax')?.updateValueAndValidity();
  }

  private buildCategoryGroups(pkg: CateringPackage): void {
    const groupMap = new Map<string, { items: PackageItem[]; selectionLimit: number }>();

    for (const item of pkg.items) {
      if (!groupMap.has(item.category)) {
        groupMap.set(item.category, { items: [], selectionLimit: item.selectionLimit });
      }
      groupMap.get(item.category)!.items.push(item);
    }

    this.categoryGroups = [...groupMap.entries()].map(([category, data]) => ({
      category,
      items: data.items,
      selectionLimit: data.selectionLimit,
    }));

    // Initialize selections
    this.menuSelections = {};
    for (const group of this.categoryGroups) {
      this.menuSelections[group.category] = new Set<number>();
    }
  }

  toggleMenuItem(category: string, itemId: number): void {
    const selections = this.menuSelections[category];
    if (!selections) return;

    const group = this.categoryGroups.find(g => g.category === category);
    if (!group) return;

    if (selections.has(itemId)) {
      selections.delete(itemId);
    } else {
      if (selections.size >= group.selectionLimit) {
        // Remove the first selected item to make room
        const first = [...selections][0];
        selections.delete(first);
      }
      selections.add(itemId);
    }
    this.menuSelectionError = '';
  }

  isMenuItemSelected(category: string, itemId: number): boolean {
    return this.menuSelections[category]?.has(itemId) ?? false;
  }

  getSelectionCount(category: string): number {
    return this.menuSelections[category]?.size ?? 0;
  }

  get totalSelectionsValid(): boolean {
    // Each category must have at least 1 selection
    return this.categoryGroups.every(g => (this.menuSelections[g.category]?.size ?? 0) > 0);
  }

  formatCategory(category: string): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  hasFreebies(pkg: CateringPackage): boolean {
    return pkg.items.some(item => item.category === 'freebie');
  }

  getFreebieCount(pkg: CateringPackage): number {
    return pkg.items.filter(item => item.category === 'freebie').length;
  }

  // ── Form Helpers ──────────────────────────────────────────────────────────

  get todayDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  onDateChange(event: { dateStr: string }): void {
    this.schedulingForm.get('eventDate')?.setValue(event.dateStr);
    this.schedulingForm.get('eventDate')?.markAsTouched();
  }

  getFieldError(fieldName: string): string {
    const control = this.schedulingForm.get(fieldName);
    if (!control || !control.errors || !control.touched) return '';

    const errors = control.errors;

    switch (fieldName) {
      case 'customerName':
        if (errors['required']) return 'Customer name is required';
        if (errors['maxlength']) return 'Customer name must not exceed 100 characters';
        break;
      case 'contactNumber':
        if (errors['required']) return 'Contact number is required';
        if (errors['maxlength']) return 'Contact number must not exceed 15 digits';
        if (errors['pattern']) return 'Contact number must contain only digits';
        break;
      case 'venue':
        if (errors['required']) return 'Venue is required';
        if (errors['maxlength']) return 'Venue must not exceed 200 characters';
        break;
      case 'eventDate':
        if (errors['required']) return 'Event date is required';
        if (errors['futureDate']) return 'Event date must be a future date';
        break;
      case 'pax':
        if (errors['required']) return 'Number of pax is required';
        if (errors['min']) return `Number of pax must be at least ${this.selectedPackage?.minPax ?? 1}`;
        break;
    }
    return '';
  }

  // ── Star Rating ───────────────────────────────────────────────────────────

  hoveredStar = 0;

  setRating(value: number): void {
    this.feedbackForm.get('rating')?.setValue(value);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  proceedToMenuSelection(): void {
    this.schedulingForm.markAllAsTouched();
    if (this.schedulingForm.invalid || !this.selectedPackage) return;
    this.state = 'menu-selection';
  }

  backToForm(): void {
    this.state = 'form';
  }

  async submitSchedule(): Promise<void> {
    if (!this.selectedPackage) return;

    // Validate menu selections
    if (!this.totalSelectionsValid) {
      this.menuSelectionError = 'Please select at least one item from each category.';
      return;
    }

    this.isSubmitting = true;
    this.submitError = '';
    this.menuSelectionError = '';

    try {
      const formValue = this.schedulingForm.value;

      // Build menu selections array
      const menuSelections: { menuItemId: number; category: string }[] = [];
      for (const [category, ids] of Object.entries(this.menuSelections)) {
        for (const id of ids) {
          menuSelections.push({ menuItemId: id, category });
        }
      }

      const payload = {
        customerName: formValue.customerName,
        contactNumber: formValue.contactNumber,
        venue: formValue.venue,
        eventDate: formValue.eventDate,
        pax: Number(formValue.pax),
        packageId: Number(this.selectedPackage.id),
        menuSelections,
      };

      const response = await apiClient.post<{ success: boolean; data?: { id: number }; message?: string }>(
        '/api/catering/schedules/public',
        payload
      );

      if (response.data.success && response.data.data) {
        this.createdScheduleId = response.data.data.id;
        this.state = 'feedback';
      } else {
        this.submitError = response.data.message || 'Failed to submit schedule';
      }
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { message?: string | string[] } } };
      if (axiosError?.response?.data?.message) {
        const msg = axiosError.response.data.message;
        this.submitError = Array.isArray(msg) ? msg[0] : msg;
      } else {
        this.submitError = 'Could not complete the submission. Please try again later.';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  async submitFeedback(): Promise<void> {
    this.feedbackForm.markAllAsTouched();
    if (this.feedbackForm.invalid || !this.createdScheduleId) return;

    this.isSubmittingFeedback = true;
    this.feedbackError = '';

    try {
      const payload = {
        rating: this.feedbackForm.value.rating,
        comment: this.feedbackForm.value.comment || undefined,
      };

      const response = await apiClient.post<{ success: boolean; message?: string }>(
        `/api/catering/feedback/scheduling/${this.createdScheduleId}`,
        payload
      );

      if (response.data.success) {
        this.state = 'done';
      } else {
        this.feedbackError = response.data.message || 'Failed to submit feedback';
      }
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { message?: string } } };
      if (axiosError?.response?.data?.message) {
        this.feedbackError = axiosError.response.data.message;
      } else {
        this.feedbackError = 'Could not submit feedback. Please try again later.';
      }
    } finally {
      this.isSubmittingFeedback = false;
    }
  }

  skipFeedback(): void {
    this.state = 'done';
  }
}
