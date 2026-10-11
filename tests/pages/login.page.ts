import type { Page } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  digitButton = (digit: string) => this.page.locator('button').filter({ hasText: new RegExp(`^${digit}$`) }).first();
  deleteButton = () => this.page.locator('button').filter({ hasText: /backspace|del/i }).first();
  loginButton = () => this.page.locator('button').filter({ hasText: /login|sign in|enter/i }).first();
  errorMessage = () => this.page.locator('text=/invalid|error|incorrect/i').first();
  title = () => this.page.locator('h1').filter({ hasText: /sheikh|mobile/i }).first();
  pinIndicator = (index: number) => this.page.locator('.rounded-full.border-2').nth(index);
  terminalText = () => this.page.locator('text=/terminal/i').first();

  async enterPin(pin: string) {
    for (const digit of pin) {
      await this.digitButton(digit).click();
      await this.page.waitForTimeout(100);
    }
  }

  async deleteLastDigit() {
    await this.deleteButton().click();
  }

  async login(pin = '123456') {
    await this.enterPin(pin);
    await this.page.waitForTimeout(2000);
  }
}
