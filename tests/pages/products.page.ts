import type { Page } from '@playwright/test';

export class ProductsPage {
  constructor(private page: Page) {}

  productItem = (name: string) => this.page.locator('div').filter({ hasText: new RegExp(`^${name}$`) }).first();
  addProductButton = () => this.page.locator('button').filter({ hasText: /add|create|new/i }).first();
  nameInput = () => this.page.locator('input').filter({ hasText: /name/i }).first().or(this.page.locator('input[placeholder*="name" i]').first());
  priceInput = () => this.page.locator('input[type="number"]').first();
  categoryInput = () => this.page.locator('input').filter({ hasText: /category/i }).first().or(this.page.locator('select').first());
  saveButton = () => this.page.locator('button').filter({ hasText: /save|create|add|submit/i }).first();
  deleteButton = (name: string) => this.page.locator('div').filter({ hasText: name }).locator('button:has-text("delete"), button:has-text("Delete"), [class*="delete"]').first();
  editButton = (name: string) => this.page.locator('div').filter({ hasText: name }).locator('button:has-text("edit"), button:has-text("Edit"), [class*="edit"]').first();
  categoryTag = (cat: string) => this.page.locator('button, span').filter({ hasText: new RegExp(cat, 'i') }).first();
  searchInput = () => this.page.locator('input[placeholder*="search" i]').first();
  emptyState = () => this.page.locator('text=/no products|empty|no items/i').first();

  async addProduct(name: string, category: string, price: string) {
    await this.addProductButton().click();
    await this.page.waitForTimeout(300);
    await this.nameInput().fill(name);
    await this.priceInput().fill(price);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }

  async searchProduct(query: string) {
    const search = this.searchInput();
    if (await search.isVisible()) {
      await search.fill(query);
      await this.page.waitForTimeout(300);
    }
  }
}