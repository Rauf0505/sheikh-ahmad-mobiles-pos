import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { SettingsPage } from '../pages/settings.page';

test.describe('Settings', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'settings');
  });

  test('should display settings page', async ({ window }) => {
    await expect(window.locator('text=/setting/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show roles & permissions section by default', async ({ window }) => {
    await expect(window.locator('text=/role|permission/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show settings navigation', async ({ window }) => {
    await expect(window.locator('text=/roles|terminal|stock|backup/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show existing roles', async ({ window }) => {
    await expect(window.locator('text=/Owner|Cashier|Manager|Sales/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show add role button', async ({ window }) => {
    const settingsPage = new SettingsPage(window);
    await expect(settingsPage.addRoleButton()).toBeVisible({ timeout: 5_000 });
  });

  test('should switch to printer settings', async ({ window }) => {
    const settingsPage = new SettingsPage(window);
    await settingsPage.switchSection('Printer');
    await expect(window.locator('text=/printer|terminal/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should switch to stock settings', async ({ window }) => {
    const settingsPage = new SettingsPage(window);
    await settingsPage.switchSection('Stock');
    await expect(window.locator('text=/stock|below zero|sale type/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should switch to cloud backup', async ({ window }) => {
    const settingsPage = new SettingsPage(window);
    await settingsPage.switchSection('Backup');
    await expect(window.locator('text=/backup|cloud/i').first()).toBeVisible({ timeout: 5_000 });
  });
});
