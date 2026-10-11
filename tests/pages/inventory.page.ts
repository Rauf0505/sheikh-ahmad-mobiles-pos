import type { Page } from '@playwright/test';

export class InventoryPage {
  constructor(private page: Page) {}

  datePresetButton = (label: string) => this.page.locator('button').filter({ hasText: new RegExp(label, 'i') }).first();
  customDateInput = () => this.page.locator('input[type="date"]');
  searchInput = () => this.page.locator('input[placeholder*="search" i]').first();
  addEntryButton = () => this.page.locator('button').filter({ hasText: /add|create|new/i }).first();
  stockRow = () => this.page.locator('[class*="grid"]').filter({ hasText: /kg|pcs|liters/ });
  itemNameInput = () => this.page.locator('input').filter({ hasText: /item name/i }).first().or(this.page.locator('input[placeholder*="item" i]').first());
  quantityInput = () => this.page.locator('input[type="number"]').first();
  saveButton = () => this.page.locator('button').filter({ hasText: /save|add|submit|create/i }).first();
  emptyState = () => this.page.locator('text=/no stock|empty/i').first();
  entryCount = () => this.page.locator('text=/entries/i').first();

  async filterByPreset(label: string) {
    await this.datePresetButton(label).click();
    await this.page.waitForTimeout(500);
  }

  async addEntry(itemName: string, quantity: string) {
    await this.addEntryButton().click();
    await this.page.waitForTimeout(300);
    await this.itemNameInput().fill(itemName);
    await this.quantityInput().fill(quantity);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }
}
