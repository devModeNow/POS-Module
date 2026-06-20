import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { NotificationService } from '../../../shared/services/notification.service';
import { apiClient } from '../../../shared/services/api-client';

type MenuCategory =
  | 'chicken'
  | 'pork'
  | 'vegetable'
  | 'seafood'
  | 'beef'
  | 'soup'
  | 'pasta'
  | 'salad'
  | 'drinks'
  | 'dessert'
  | 'appetizer'
  | 'freebie';

interface MenuItem {
  id: number;
  name: string;
  category: MenuCategory;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface PackageItem {
  menuItemId: number;
  menuItemName: string;
  category: MenuCategory;
  selectionLimit: number;
}

interface CateringPackage {
  id: number;
  name: string;
  pricePerHead: number;
  minPax: number;
  items: PackageItem[];
  createdAt: string;
  updatedAt: string | null;
}

type ActiveSection = 'items' | 'packages';

const MENU_CATEGORIES: MenuCategory[] = [
  'chicken',
  'pork',
  'vegetable',
  'seafood',
  'beef',
  'soup',
  'pasta',
  'salad',
  'drinks',
  'dessert',
  'appetizer',
  'freebie',
];

@Component({
  selector: 'app-catering-menus',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent],
  templateUrl: './catering-menus.component.html',
})
export class CateringMenusComponent implements OnInit {
  activeSection: ActiveSection = 'items';
  readonly categories = MENU_CATEGORIES;

  // Menu Items state
  menuItems: MenuItem[] = [];
  groupedItems: Record<string, MenuItem[]> = {};
  isLoadingItems = false;

  // Menu Items search
  menuSearch = '';
  menuCategoryFilter: MenuCategory | '' = '';

  // Menu Item modal
  showItemModal = false;
  isEditingItem = false;
  editingItemId: number | null = null;
  itemForm = { name: '', category: 'chicken' as MenuCategory };
  isSavingItem = false;
  itemError = '';

  // Packages state
  packages: CateringPackage[] = [];
  isLoadingPackages = false;

  // Package modal
  showPackageModal = false;
  isEditingPackage = false;
  editingPackageId: number | null = null;
  packageForm = {
    name: '',
    pricePerHead: 0,
    minPax: 1,
    promoText: '',
  };
  // For each category, track selected item IDs and selection limit
  packageCategorySelections: Record<string, { selectedIds: Set<number>; selectionLimit: number }> = {};
  isSavingPackage = false;
  packageError = '';

  // Package modal - category-based selection
  packageSelectedCategory: MenuCategory | '' = '';
  packageCategorySearch = '';

  constructor(private readonly notify: NotificationService) {}

  ngOnInit(): void {
    void this.loadMenuItems();
    void this.loadPackages();
  }

  switchSection(section: ActiveSection): void {
    this.activeSection = section;
  }

  // ── Menu Items Search ─────────────────────────────────────────────────────

  get filteredGroupedItems(): Record<string, MenuItem[]> {
    const search = this.menuSearch.toLowerCase().trim();
    const catFilter = this.menuCategoryFilter;
    if (!search && !catFilter) return this.groupedItems;
    const filtered: Record<string, MenuItem[]> = {};
    for (const [cat, items] of Object.entries(this.groupedItems)) {
      if (catFilter && cat !== catFilter) continue;
      const matching = search ? items.filter(i => i.name.toLowerCase().includes(search)) : items;
      if (matching.length > 0) filtered[cat] = matching;
    }
    return filtered;
  }

  get filteredCategoriesWithItems(): string[] {
    return this.categories.filter(cat => this.filteredGroupedItems[cat]?.length > 0);
  }

  // ── Package Modal - Category-based Selection ──────────────────────────────

  get packageFilteredCategories(): MenuCategory[] {
    if (!this.packageCategorySearch.trim()) return this.packageCategoriesWithItems as MenuCategory[];
    const search = this.packageCategorySearch.toLowerCase();
    return (this.packageCategoriesWithItems as MenuCategory[]).filter(cat => cat.includes(search));
  }

  selectPackageCategory(cat: MenuCategory): void {
    this.packageSelectedCategory = cat;
  }

  get packageSelectedCategoryItems(): MenuItem[] {
    if (!this.packageSelectedCategory) return [];
    return this.groupedItems[this.packageSelectedCategory] || [];
  }

  get packageSelectionSummary(): { category: string; count: number; limit: number }[] {
    const summary: { category: string; count: number; limit: number }[] = [];
    for (const cat of this.categories) {
      const sel = this.packageCategorySelections[cat];
      if (sel && sel.selectedIds.size > 0) {
        summary.push({ category: cat, count: sel.selectedIds.size, limit: sel.selectionLimit });
      }
    }
    return summary;
  }

  // ── Menu Items ────────────────────────────────────────────────────────────

  async loadMenuItems(): Promise<void> {
    this.isLoadingItems = true;
    try {
      const r = await apiClient.get<{ success: boolean; data?: Record<string, MenuItem[]> }>(
        '/api/catering/menus/items',
      );
      if (r.data.success && r.data.data) {
        this.groupedItems = r.data.data;
        // Flatten for package selection use
        this.menuItems = [];
        for (const category of Object.keys(this.groupedItems)) {
          this.menuItems.push(...this.groupedItems[category]);
        }
      }
    } catch {
      this.notify.error('Error', 'Failed to load menu items.');
    } finally {
      this.isLoadingItems = false;
    }
  }

  get categoriesWithItems(): string[] {
    return this.categories.filter((cat) => this.groupedItems[cat]?.length > 0);
  }

  get allCategoriesEmpty(): boolean {
    return this.menuItems.length === 0;
  }

  openAddItemModal(): void {
    this.isEditingItem = false;
    this.editingItemId = null;
    this.itemForm = { name: '', category: 'chicken' };
    this.itemError = '';
    this.showItemModal = true;
  }

  openEditItemModal(item: MenuItem): void {
    this.isEditingItem = true;
    this.editingItemId = item.id;
    this.itemForm = { name: item.name, category: item.category };
    this.itemError = '';
    this.showItemModal = true;
  }

  closeItemModal(): void {
    if (!this.isSavingItem) {
      this.showItemModal = false;
      this.editingItemId = null;
      this.itemError = '';
    }
  }

  async saveMenuItem(): Promise<void> {
    if (!this.itemForm.name.trim()) {
      this.itemError = 'Item name is required.';
      return;
    }

    this.isSavingItem = true;
    this.itemError = '';

    try {
      if (this.isEditingItem && this.editingItemId) {
        const r = await apiClient.patch<{ success: boolean; message?: string }>(
          `/api/catering/menus/items/${this.editingItemId}`,
          { name: this.itemForm.name.trim(), category: this.itemForm.category },
        );
        if (r.data.success) {
          this.notify.success('Updated', 'Menu item updated.');
          this.showItemModal = false;
          await this.loadMenuItems();
        } else {
          this.itemError = r.data.message ?? 'Failed to update menu item.';
        }
      } else {
        const r = await apiClient.post<{ success: boolean; message?: string }>(
          '/api/catering/menus/items',
          { name: this.itemForm.name.trim(), category: this.itemForm.category },
        );
        if (r.data.success) {
          this.notify.success('Created', 'Menu item added.');
          this.showItemModal = false;
          await this.loadMenuItems();
        } else {
          this.itemError = r.data.message ?? 'Failed to create menu item.';
        }
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.itemError = Array.isArray(msg) ? msg[0] : (msg ?? 'An unexpected error occurred.');
    } finally {
      this.isSavingItem = false;
    }
  }

  async deleteMenuItem(item: MenuItem): Promise<void> {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;

    try {
      const r = await apiClient.delete<{ success: boolean; message?: string }>(
        `/api/catering/menus/items/${item.id}`,
      );
      if (r.data.success) {
        this.notify.success('Deleted', 'Menu item removed.');
        await this.loadMenuItems();
      } else {
        this.notify.error('Cannot Delete', r.data.message ?? 'Failed to delete menu item.');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error(
        'Cannot Delete',
        msg ?? 'This item cannot be deleted because it is referenced by a package.',
      );
    }
  }

  // ── Packages ──────────────────────────────────────────────────────────────

  async loadPackages(): Promise<void> {
    this.isLoadingPackages = true;
    try {
      const r = await apiClient.get<{ success: boolean; data?: CateringPackage[] }>(
        '/api/catering/menus/packages',
      );
      if (r.data.success && r.data.data) {
        this.packages = r.data.data;
      }
    } catch {
      this.notify.error('Error', 'Failed to load packages.');
    } finally {
      this.isLoadingPackages = false;
    }
  }

  getPackageItemSummary(pkg: CateringPackage): string {
    if (!pkg.items || pkg.items.length === 0) return 'No items';
    const categoryCount = new Set(pkg.items.map((i) => i.category)).size;
    return `${pkg.items.length} item${pkg.items.length > 1 ? 's' : ''} across ${categoryCount} categor${categoryCount > 1 ? 'ies' : 'y'}`;
  }

  openCreatePackageModal(): void {
    this.isEditingPackage = false;
    this.editingPackageId = null;
    this.packageForm = { name: '', pricePerHead: 0, minPax: 1, promoText: '' };
    this.initPackageCategorySelections();
    this.packageSelectedCategory = '';
    this.packageCategorySearch = '';
    this.packageError = '';
    this.showPackageModal = true;
  }

  openEditPackageModal(pkg: CateringPackage): void {
    this.isEditingPackage = true;
    this.editingPackageId = pkg.id;
    this.packageForm = {
      name: pkg.name,
      pricePerHead: pkg.pricePerHead,
      minPax: pkg.minPax,
      promoText: (pkg as any).promoText || '',
    };
    this.initPackageCategorySelections();
    // Pre-select items from the package
    if (pkg.items) {
      for (const item of pkg.items) {
        const catKey = item.category;
        if (this.packageCategorySelections[catKey]) {
          this.packageCategorySelections[catKey].selectedIds.add(item.menuItemId);
          this.packageCategorySelections[catKey].selectionLimit = item.selectionLimit;
        }
      }
    }
    this.packageSelectedCategory = '';
    this.packageCategorySearch = '';
    this.packageError = '';
    this.showPackageModal = true;
  }

  closePackageModal(): void {
    if (!this.isSavingPackage) {
      this.showPackageModal = false;
      this.editingPackageId = null;
      this.packageError = '';
    }
  }

  private initPackageCategorySelections(): void {
    this.packageCategorySelections = {};
    for (const cat of this.categories) {
      if (this.groupedItems[cat]?.length > 0) {
        this.packageCategorySelections[cat] = {
          selectedIds: new Set<number>(),
          selectionLimit: 1,
        };
      }
    }
  }

  get packageCategoriesWithItems(): string[] {
    return this.categories.filter((cat) => this.groupedItems[cat]?.length > 0);
  }

  isItemSelectedInPackage(category: string, itemId: number): boolean {
    return this.packageCategorySelections[category]?.selectedIds.has(itemId) ?? false;
  }

  togglePackageItem(category: string, itemId: number): void {
    const sel = this.packageCategorySelections[category];
    if (!sel) return;
    if (sel.selectedIds.has(itemId)) {
      sel.selectedIds.delete(itemId);
    } else {
      sel.selectedIds.add(itemId);
    }
  }

  getSelectionLimit(category: string): number {
    return this.packageCategorySelections[category]?.selectionLimit ?? 1;
  }

  setSelectionLimit(category: string, value: number): void {
    if (this.packageCategorySelections[category]) {
      this.packageCategorySelections[category].selectionLimit = Math.max(1, value);
    }
  }

  getSelectedCount(category: string): number {
    return this.packageCategorySelections[category]?.selectedIds.size ?? 0;
  }

  async savePackage(): Promise<void> {
    if (!this.packageForm.name.trim()) {
      this.packageError = 'Package name is required.';
      return;
    }
    if (this.packageForm.name.length > 100) {
      this.packageError = 'Package name must not exceed 100 characters.';
      return;
    }
    if (!this.packageForm.pricePerHead || this.packageForm.pricePerHead <= 0) {
      this.packageError = 'Price per head must be greater than 0.';
      return;
    }
    if (!this.packageForm.minPax || this.packageForm.minPax < 1) {
      this.packageError = 'Minimum pax must be at least 1.';
      return;
    }

    // Build items array from selections
    const items: { menuItemId: number; selectionLimit: number }[] = [];
    for (const cat of this.categories) {
      const sel = this.packageCategorySelections[cat];
      if (sel && sel.selectedIds.size > 0) {
        for (const id of sel.selectedIds) {
          items.push({ menuItemId: id, selectionLimit: sel.selectionLimit });
        }
      }
    }

    if (items.length === 0) {
      this.packageError = 'At least one menu item must be selected.';
      return;
    }

    this.isSavingPackage = true;
    this.packageError = '';

    const payload = {
      name: this.packageForm.name.trim(),
      pricePerHead: Number(this.packageForm.pricePerHead),
      minPax: Number(this.packageForm.minPax),
      promoText: this.packageForm.promoText?.trim() || null,
      items,
    };

    try {
      if (this.isEditingPackage && this.editingPackageId) {
        const r = await apiClient.patch<{ success: boolean; message?: string }>(
          `/api/catering/menus/packages/${this.editingPackageId}`,
          payload,
        );
        if (r.data.success) {
          this.notify.success('Updated', 'Package updated.');
          this.showPackageModal = false;
          await this.loadPackages();
        } else {
          this.packageError = r.data.message ?? 'Failed to update package.';
        }
      } else {
        const r = await apiClient.post<{ success: boolean; message?: string }>(
          '/api/catering/menus/packages',
          payload,
        );
        if (r.data.success) {
          this.notify.success('Created', 'Package created.');
          this.showPackageModal = false;
          await this.loadPackages();
        } else {
          this.packageError = r.data.message ?? 'Failed to create package.';
        }
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.packageError = Array.isArray(msg) ? msg[0] : (msg ?? 'An unexpected error occurred.');
    } finally {
      this.isSavingPackage = false;
    }
  }

  async deletePackage(pkg: CateringPackage): Promise<void> {
    if (!confirm(`Delete package "${pkg.name}"? This cannot be undone.`)) return;

    try {
      const r = await apiClient.delete<{ success: boolean; message?: string }>(
        `/api/catering/menus/packages/${pkg.id}`,
      );
      if (r.data.success) {
        this.notify.success('Deleted', 'Package removed.');
        await this.loadPackages();
      } else {
        this.notify.error(
          'Cannot Delete',
          r.data.message ?? 'Failed to delete package.',
        );
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      this.notify.error(
        'Cannot Delete',
        msg ?? 'This package cannot be deleted because it is referenced by an active schedule.',
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async uploadMenuItemImage(item: MenuItem, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.notify.error('Invalid File', 'Only image files are allowed.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.notify.error('Too Large', 'Image must be under 2MB.');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      const r = await apiClient.post<{ success: boolean; data?: { imageUrl: string }; message?: string }>(
        `/api/catering/menus/items/${item.id}/image`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      if (r.data.success && r.data.data) {
        item.imageUrl = r.data.data.imageUrl;
        this.notify.success('Uploaded', 'Image uploaded successfully.');
      } else {
        this.notify.error('Failed', r.data.message ?? 'Failed to upload image.');
      }
    } catch (e: any) {
      this.notify.error('Error', e?.response?.data?.message ?? 'Failed to upload image.');
    }
    // Reset input so same file can be re-selected
    input.value = '';
  }

  async removeMenuItemImage(item: MenuItem): Promise<void> {
    try {
      const r = await apiClient.delete<{ success: boolean; message?: string }>(
        `/api/catering/menus/items/${item.id}/image`,
      );
      if (r.data.success) {
        item.imageUrl = null;
        this.notify.success('Removed', 'Image removed.');
      } else {
        this.notify.error('Failed', r.data.message ?? 'Failed to remove image.');
      }
    } catch (e: any) {
      this.notify.error('Error', e?.response?.data?.message ?? 'Failed to remove image.');
    }
  }

  formatCategory(category: string): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }
}
