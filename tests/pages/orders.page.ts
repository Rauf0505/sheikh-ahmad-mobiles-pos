import type { Page } from '@playwright/test';

export class OrdersPage {
  constructor(private page: Page) {}

  orderRow = () => this.page.locator('[class*="order"] div[class*="row"], [class*="list"] > div').filter({ hasText: /order|#|dine|take/i });
  orderDetail = () => this.page.locator('[class*="detail"], [class*="modal"]').first();
  statusFilter = (status: string) => this.page.locator('button').filter({ hasText: new RegExp(status, 'i') }).first();
  orderItem = (name: string) => this.page.locator('text=' + name).first();
  closeModal = () => this.page.locator('button:has-text("Close"), button:has-text("×")').first();
  loadingSpinner = () => this.page.locator('text=/loading/i').first();
  emptyState = () => this.page.locator('text=/no orders|empty/i').first();

  async clickOrder(index = 0) {
    const rows = this.orderRow();
    await rows.nth(index).click();
    await this.page.waitForTimeout(500);
  }

  async filterByStatus(status: string) {
    await this.statusFilter(status).click();
    await this.page.waitForTimeout(500);
  }
}
