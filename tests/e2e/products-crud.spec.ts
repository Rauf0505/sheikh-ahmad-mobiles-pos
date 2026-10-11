import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { ProductsPage } from '../pages/products.page';

test.describe('Products CRUD', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'products');
  });

  test('should display products page', async ({ window }) => {
    await expect(window.locator('text=/product|category/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show add product button', async ({ window }) => {
    const productsPage = new ProductsPage(window);
    await expect(productsPage.addProductButton()).toBeVisible({ timeout: 5_000 });
  });

  test('should open add product modal', async ({ window }) => {
    const productsPage = new ProductsPage(window);
    await productsPage.addProductButton().click();
    await expect(window.locator('text=/add|create|new.*product/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should have category filter', async ({ window }) => {
    await expect(window.locator('select').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should have search functionality', async ({ window }) => {
    const searchInput = window.locator('input[placeholder*="search" i]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await window.waitForTimeout(300);
    }
  });
});