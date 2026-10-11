import type { Page } from '@playwright/test';
export class PurchasesPage {
  constructor(private page: Page) {}
  recordPurchaseButton = () => this.page.locator('button').filter({ hasText: /record purchase/i }).first();
  addItemButton = () => this.page.locator('button').filter({ hasText: /add item/i }).first();
  quantityInput = () => this.page.locator('input[placeholder*="qty" i], input[type="number"]').nth(1);
  rateInput = () => this.page.locator('input[placeholder*="rate" i], input[type="number"]').nth(2);
  savePurchaseButton = () => this.page.locator('button').filter({ hasText: /record purchase|save/i }).first();
  async gotoSuppliers() {
    await this.page.locator('text=/suppliers/i').first().click();
    await this.page.waitForTimeout(500);
  }
}
