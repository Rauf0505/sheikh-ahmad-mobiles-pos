import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { ReportsPage } from '../pages/reports.page';

test.describe('Reports & Analytics', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'reports');
  });

  test('should display reports page', async ({ window }) => {
    await expect(window.locator('text=/report|analytics/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show report tabs', async ({ window }) => {
    await expect(window.locator('button').filter({ hasText: /sales|supplier|customer|expense|p.*l/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show date preset buttons', async ({ window }) => {
    await expect(window.locator('button').filter({ hasText: /today|week|month/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('should switch between tabs', async ({ window }) => {
    const reportsPage = new ReportsPage(window);
    const tabs = ['Tax', 'Suppliers', 'Customers', 'Expenses'];
    for (const tab of tabs) {
      const tabBtn = reportsPage.tabButton(tab);
      if (await tabBtn.isVisible().catch(() => false)) {
        await tabBtn.click();
        await window.waitForTimeout(300);
      }
    }
  });

  test('should show sales summary cards', async ({ window }) => {
    await expect(window.locator('text=/total sales|order count|revenue/i').first()).toBeVisible({ timeout: 5_000 });
  });
});
