import type { Page } from '@playwright/test';

export class CustomersPage {
  constructor(private page: Page) {}

  customerItem = (name: string) => this.page.locator('button, div').filter({ hasText: name }).first();
  addCustomerButton = () => this.page.locator('button').filter({ hasText: /add|create|new/i }).first();
  recordPaymentButton = () => this.page.locator('button').filter({ hasText: /record payment|payment/i }).first();
  recordCreditButton = () => this.page.locator('button').filter({ hasText: /record credit|credit sale/i }).first();
  amountInput = () => this.page.locator('input[type="number"]').first();
  nameInput = () => this.page.locator('input').filter({ hasText: /name/i }).first().or(this.page.locator('input[placeholder*="name" i]').first());
  phoneInput = () => this.page.locator('input').filter({ hasText: /phone/i }).first().or(this.page.locator('input[placeholder*="phone" i]').first());
  saveButton = () => this.page.locator('button').filter({ hasText: /save|record|submit|create|add/i }).first();
  balanceText = () => this.page.locator('text=/balance|outstanding/i').first();
  ledgerRow = () => this.page.locator('[class*="grid"]').filter({ hasText: /credit|payment/ });
  emptyState = () => this.page.locator('text=/no customers|empty|select/i').first();

  async clickCustomer(name: string) {
    await this.customerItem(name).click();
    await this.page.waitForTimeout(500);
  }

  async addCustomer(name: string, phone?: string) {
    await this.addCustomerButton().click();
    await this.page.waitForTimeout(300);
    await this.nameInput().fill(name);
    if (phone) await this.phoneInput().fill(phone);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }

  async recordCreditSale(amount: string) {
    await this.recordCreditButton().click();
    await this.page.waitForTimeout(300);
    await this.amountInput().fill(amount);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }

  async recordPayment(amount: string) {
    await this.recordPaymentButton().click();
    await this.page.waitForTimeout(300);
    await this.amountInput().fill(amount);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }
}
