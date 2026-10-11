import type { Page } from '@playwright/test';

export class SuppliersPage {
  constructor(private page: Page) {}

  supplierItem = (name: string) => this.page.locator('button, div').filter({ hasText: name }).first();
  addSupplierButton = () => this.page.locator('button').filter({ hasText: /add|create|new/i }).first();
  searchInput = () => this.page.locator('input[placeholder*="search" i]').first();
  recordPaymentButton = () => this.page.locator('button').filter({ hasText: /record payment|payment/i }).first();
  recordPurchaseButton = () => this.page.locator('button').filter({ hasText: /record purchase|purchase/i }).first();
  amountInput = () => this.page.locator('input[type="number"]').first();
  invoiceInput = () => this.page.locator('input').filter({ hasText: /invoice/i }).first().or(this.page.locator('input[placeholder*="invoice" i]').first());
  saveButton = () => this.page.locator('button').filter({ hasText: /save|record|submit|create/i }).first();
  outstandingText = () => this.page.locator('text=/outstanding|balance/i').first();
  purchaseRow = () => this.page.locator('[class*="grid"]').filter({ hasText: /paid|unpaid|partial/ });
  emptyState = () => this.page.locator('text=/no suppliers|empty|select/i').first();

  async clickSupplier(name: string) {
    await this.supplierItem(name).click();
    await this.page.waitForTimeout(500);
  }

  async recordPayment(amount: string) {
    await this.recordPaymentButton().click();
    await this.page.waitForTimeout(300);
    await this.amountInput().fill(amount);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }

  async recordPurchase(amount: string) {
    await this.recordPurchaseButton().click();
    await this.page.waitForTimeout(300);
    await this.amountInput().fill(amount);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }
}
