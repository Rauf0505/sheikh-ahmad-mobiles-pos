import type { Page } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  kpiCard = (label: string) => this.page.locator('[class*="card"], div').filter({ hasText: new RegExp(label, 'i') }).first();
  salesKpi = () => this.kpiCard(/sales|today/i);
  ordersKpi = () => this.kpiCard(/orders|count/i);
  activityFeed = () => this.page.locator('text=/activity|recent|audit/i').first();
  activityEntry = () => this.page.locator('[class*="list"] > div, [class*="activity"] > div').first();
  emptyState = () => this.page.locator('text=/no data|empty/i').first();

  async getKpiValue(label: string) {
    const card = this.kpiCard(label);
    return await card.textContent();
  }
}
