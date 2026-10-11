import type { Page } from '@playwright/test';

export class ReportsPage {
  constructor(private page: Page) {}

  tabButton = (label: string) => this.page.locator('button').filter({ hasText: new RegExp(label, 'i') }).first();
  salesSummaryCard = () => this.page.locator('[class*="card"], div').filter({ hasText: /total sales|order count/i }).first();
  taxSummaryCard = () => this.page.locator('[class*="card"], div').filter({ hasText: /tax|category/i }).first();
  pnlSection = () => this.page.locator('text=/profit.*loss|p.*l/i').first();
  datePresetButton = (label: string) => this.page.locator('button').filter({ hasText: new RegExp(label, 'i') }).first();
  customDateInput = () => this.page.locator('input[type="date"]');
  topItemRow = () => this.page.locator('[class*="grid"]').filter({ hasText: /Rs\./ });
  emptyState = () => this.page.locator('text=/no data|empty|no records/i').first();

  async switchTab(label: string) {
    await this.tabButton(label).click();
    await this.page.waitForTimeout(500);
  }

  async filterByPreset(label: string) {
    await this.datePresetButton(label).click();
    await this.page.waitForTimeout(500);
  }
}
