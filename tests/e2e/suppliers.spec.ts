import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { SuppliersPage } from '../pages/suppliers.page';

test.describe('Suppliers Management', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'suppliers');
  });

  test('should display suppliers page', async ({ window }) => {
    await expect(window.locator('text=/supplier/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show empty state initially', async ({ window }) => {
    const suppliersPage = new SuppliersPage(window);
    const hasSuppliers = await suppliersPage.supplierItem('test').isVisible().catch(() => false);
    if (!hasSuppliers) {
      await expect(suppliersPage.emptyState().or(window.locator('text=/select|no suppliers/i').first())).toBeVisible();
    }
  });

  test('should show search input', async ({ window }) => {
    const suppliersPage = new SuppliersPage(window);
    await expect(suppliersPage.searchInput()).toBeVisible({ timeout: 5_000 });
  });
});
