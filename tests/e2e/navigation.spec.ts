import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';

test.describe('Navigation', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
  });

  test('should navigate to POS page', async ({ window }) => {
    await navigateTo(window, 'pos');
    await expect(window.locator('text=/cart|order|item|product/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Sales page', async ({ window }) => {
    await navigateTo(window, 'orders');
    await expect(window.locator('text=/sales|order list/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Products page', async ({ window }) => {
    await navigateTo(window, 'products');
    await expect(window.locator('text=/products|category/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Purchases page', async ({ window }) => {
    await navigateTo(window, 'suppliers');
    await expect(window.locator('text=/supplier|purchase/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Stock page', async ({ window }) => {
    await navigateTo(window, 'inventory');
    await expect(window.locator('text=/stock|inventory/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Customers page', async ({ window }) => {
    await navigateTo(window, 'customers');
    await expect(window.locator('text=/customer/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Expenses page', async ({ window }) => {
    await navigateTo(window, 'expenses');
    await expect(window.locator('text=/expense/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Staff page', async ({ window }) => {
    await navigateTo(window, 'staff');
    await expect(window.locator('text=/staff|user/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Reports page', async ({ window }) => {
    await navigateTo(window, 'reports');
    await expect(window.locator('text=/report|analytics/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to Settings page', async ({ window }) => {
    await navigateTo(window, 'settings');
    await expect(window.locator('text=/setting|role|permission/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show TopAppBar with user info after login', async ({ window }) => {
    await expect(window.locator('text=/owner|user|cashier/i').first()).toBeVisible({ timeout: 5_000 });
  });
});
