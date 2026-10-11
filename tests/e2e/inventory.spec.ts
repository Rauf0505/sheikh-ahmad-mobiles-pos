import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { InventoryPage } from '../pages/inventory.page';

test.describe('Inventory Management', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'inventory');
  });

  test('should display stock history page', async ({ window }) => {
    await expect(window.locator('text=/stock|inventory|history/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show date preset buttons', async ({ window }) => {
    await expect(window.locator('button').filter({ hasText: /today|7 days|week/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show add stock entry button', async ({ window }) => {
    const inventoryPage = new InventoryPage(window);
    await expect(inventoryPage.addEntryButton()).toBeVisible({ timeout: 5_000 });
  });

  test('should have search functionality', async ({ window }) => {
    const inventoryPage = new InventoryPage(window);
    await expect(inventoryPage.searchInput()).toBeVisible({ timeout: 5_000 });
  });

  test('should show table header', async ({ window }) => {
    await expect(window.locator('text=/date|item|qty|source|supplier/i').first()).toBeVisible({ timeout: 5_000 });
  });
});
