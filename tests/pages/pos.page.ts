import type { Page } from '@playwright/test';

export class POSPage {
  constructor(private page: Page) {}

  categoryFilter = () => this.page.locator('button').filter({ hasText: /all|category/i });
  menuItemCard = () => this.page.locator('[class*="menu"], [class*="grid"] > div').filter({ hasText: /Rs\./ });
  cartItems = () => this.page.locator('[class*="cart"], [class*="order"] [class*="item"]');
  cartItemRow = (name: string) => this.page.locator('[class*="cart"] div, [class*="order"] div').filter({ hasText: name }).first();
  subtotalText = () => this.page.locator('text=/subtotal/i').first();
  taxText = () => this.page.locator('text=/tax/i').first();
  totalText = () => this.page.locator('text=/total/i').last();
  paymentButton = () => this.page.locator('button').filter({ hasText: /pay|checkout|complete/i }).first();
  cashButton = () => this.page.locator('button').filter({ hasText: /cash/i }).first();
  cardButton = () => this.page.locator('button').filter({ hasText: /card/i }).first();
  retailButton = () => this.page.locator('button').filter({ hasText: /retail/i }).first();
  wholesaleButton = () => this.page.locator('button').filter({ hasText: /wholesale/i }).first();
  numpadButton = (digit: string) => this.page.locator('button').filter({ hasText: new RegExp(`^${digit}$`) }).first();
  quantityPlus = () => this.page.locator('button:has-text("+")').first();
  quantityMinus = () => this.page.locator('button:has-text("-")').first();
  successMessage = () => this.page.locator('text=/success|order created|bill/i').first();

  async clickMenuItem(name: string) {
    await this.page.locator(`text="${name}"`).first().click();
  }

  async setQuantity(qty: number) {
    for (let i = 0; i < qty; i++) {
      await this.quantityPlus().click();
    }
  }

  async completePayment(method: 'cash' | 'card' = 'cash') {
    await this.paymentButton().click();
    await this.page.waitForTimeout(300);
    if (method === 'cash') {
      await this.cashButton().click();
    } else {
      await this.cardButton().click();
    }
    await this.page.waitForTimeout(1000);
  }
}
