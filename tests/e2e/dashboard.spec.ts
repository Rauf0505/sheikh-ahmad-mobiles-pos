import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { DashboardPage } from '../pages/dashboard.page';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
  });

  test('should show KPI cards', async ({ window }) => {
    const dashboardPage = new DashboardPage(window);
    await expect(dashboardPage.kpiCard(/sales|orders|revenue|customer/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('should show activity feed', async ({ window }) => {
    await expect(window.locator('text=/activity|recent|audit|latest/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('should display today summary', async ({ window }) => {
    await expect(window.locator('text=/today|daily|summary/i').first()).toBeVisible({ timeout: 10_000 });
  });
});
