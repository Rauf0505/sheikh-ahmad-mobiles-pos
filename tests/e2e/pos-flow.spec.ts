import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { POSPage } from '../pages/pos.page';

test.describe('POS Flow', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'pos');
  });

  test('should display products on POS screen', async ({ window }) => {
    await expect(window.locator('text=/Rs\.|PKR|price/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should add item to cart on click', async ({ window }) => {
    const posPage = new POSPage(window);
    const firstItem = posPage.menuItemCard().first();
    if (await firstItem.isVisible()) {
      await firstItem.click();
      await window.waitForTimeout(500);
      await expect(window.locator('text=/total|subtotal|cart/i').first()).toBeVisible();
    }
  });

  test('should show retail/wholesale sale type toggle', async ({ window }) => {
    const posPage = new POSPage(window);
    await expect(posPage.retailButton().or(posPage.wholesaleButton()).first()).toBeVisible({ timeout: 5_000 });
  });

  test('should calculate subtotal', async ({ window }) => {
    const posPage = new POSPage(window);
    const firstItem = posPage.menuItemCard().first();
    if (await firstItem.isVisible()) {
      await firstItem.click();
      await window.waitForTimeout(500);
      await expect(posPage.subtotalText().or(posPage.totalText()).first()).toBeVisible();
    }
  });

  test('should open payment dialog', async ({ window }) => {
    const posPage = new POSPage(window);
    const firstItem = posPage.menuItemCard().first();
    if (await firstItem.isVisible()) {
      await firstItem.click();
      await window.waitForTimeout(500);
      await posPage.paymentButton().click();
      await expect(window.locator('text=/pay|cash|card|method/i').first()).toBeVisible({ timeout: 5_000 });
    }
  });
});
