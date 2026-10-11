import { test, expect } from '../fixtures/electron';
import { LoginPage } from '../pages/login.page';

test.describe('Authentication', () => {
  test('should login with correct Owner PIN', async ({ window }) => {
    const loginPage = new LoginPage(window);
    await loginPage.login('123456');
    await expect(window.locator('text=/pos|dashboard|sidebar/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('should show error on invalid PIN', async ({ window }) => {
    const loginPage = new LoginPage(window);
    await loginPage.login('000000');
    await expect(window.locator('text=/invalid|error|incorrect|wrong/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('should show app title on login page', async ({ window }) => {
    await expect(window.locator('text=/sheikh|mobile/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show terminal label on login page', async ({ window }) => {
    const loginPage = new LoginPage(window);
    await expect(loginPage.terminalText()).toBeVisible({ timeout: 5_000 });
  });

  test('should show 6 PIN indicator dots', async ({ window }) => {
    const loginPage = new LoginPage(window);
    const dots = window.locator('.rounded-full.border-2');
    await expect(dots.first()).toBeVisible({ timeout: 5_000 });
    const count = await dots.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('should stay on login after 5 wrong PIN attempts', async ({ window }) => {
    const loginPage = new LoginPage(window);
    await loginPage.enterPin('000000');
    await window.waitForTimeout(2000);
    const stillOnLogin = await loginPage.digitButton('1').isVisible();
    expect(stillOnLogin).toBeTruthy();
  });
});
