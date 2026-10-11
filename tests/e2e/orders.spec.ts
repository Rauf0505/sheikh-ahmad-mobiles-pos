import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { OrdersPage } from '../pages/orders.page';

test.describe('Orders Management', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
  });

  test('should display orders list page', async ({ window }) => {
    await navigateTo(window, 'orders');
    await expect(window.locator('text=/order|list|history/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show empty state when no orders exist', async ({ window }) => {
    await navigateTo(window, 'orders');
    const ordersPage = new OrdersPage(window);
    const hasOrders = await ordersPage.orderRow().first().isVisible().catch(() => false);
    if (!hasOrders) {
      await expect(ordersPage.emptyState().or(window.locator('text=/no orders/i').first())).toBeVisible();
    }
  });

  test('should show status filter buttons', async ({ window }) => {
    await navigateTo(window, 'orders');
    await expect(window.locator('button').filter({ hasText: /all|open|completed|pending/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('should handle order detail modal open/close', async ({ window }) => {
    await navigateTo(window, 'orders');
    const ordersPage = new OrdersPage(window);
    const hasOrders = await ordersPage.orderRow().first().isVisible().catch(() => false);
    if (hasOrders) {
      await ordersPage.clickOrder(0);
      await expect(window.locator('[class*="modal"], [class*="dialog"], [role="dialog"]').first()).toBeVisible({ timeout: 5_000 });
      const closeBtn = window.locator('button:has-text("Close"), button:has-text("×"), button[aria-label="close"]').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }
  });
});
