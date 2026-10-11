import type { Page } from '@playwright/test';

export async function loginAsOwner(page: Page, pin = '123456'): Promise<void> {
  for (const digit of pin) {
    const btn = page.locator('button').filter({ hasText: new RegExp(`^${digit}$`) }).first();
    await btn.waitFor({ state: 'visible', timeout: 10_000 });
    await btn.click();
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2000);
}

export async function logout(page: Page): Promise<void> {
  const logoutBtn = page.locator('button').filter({ hasText: /logout|sign out/i }).first();
  if (await logoutBtn.isVisible().catch(() => false)) {
    await logoutBtn.click();
    await page.waitForTimeout(1000);
  }
}
