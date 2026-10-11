import type { Page } from '@playwright/test';

export class ExpensesPage {
  constructor(private page: Page) {}

  addExpenseButton = () => this.page.locator('button').filter({ hasText: /add|create|new/i }).first();
  dateFromInput = () => this.page.locator('input[type="date"]').first();
  dateToInput = () => this.page.locator('input[type="date"]').last();
  clearFilter = () => this.page.locator('button, a').filter({ hasText: /clear/i }).first();
  categoryCard = (name: string) => this.page.locator('[class*="card"], div').filter({ hasText: new RegExp(name, 'i') }).first();
  totalExpensesCard = () => this.page.locator('text=/total expenses/i').first();
  expenseRow = () => this.page.locator('[class*="grid"]').filter({ hasText: /Rs\.|rent|electricity|gas|salaries|maintenance|other/i });
  emptyState = () => this.page.locator('text=/no expenses|empty/i').first();
  categorySelect = () => this.page.locator('select').first();
  descriptionInput = () => this.page.locator('input').filter({ hasText: /description/i }).first().or(this.page.locator('input[placeholder*="description" i]').first());
  amountInput = () => this.page.locator('input[type="number"]').first();
  saveButton = () => this.page.locator('button').filter({ hasText: /save|add|submit|create/i }).first();

  async addExpense(category: string, description: string, amount: string) {
    await this.addExpenseButton().click();
    await this.page.waitForTimeout(300);
    await this.categorySelect().selectOption({ label: category });
    await this.descriptionInput().fill(description);
    await this.amountInput().fill(amount);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }

  async filterByDate(from: string, to: string) {
    await this.dateFromInput().fill(from);
    await this.dateToInput().fill(to);
    await this.page.waitForTimeout(500);
  }
}
