import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { ExpensesPage } from '../pages/expenses.page';

test.describe('Expenses Management', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'expenses');
  });

  test('should display expenses page', async ({ window }) => {
    await expect(window.locator('text=/expense/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show add expense button', async ({ window }) => {
    const expensesPage = new ExpensesPage(window);
    await expect(expensesPage.addExpenseButton()).toBeVisible({ timeout: 5_000 });
  });

  test('should show date filter inputs', async ({ window }) => {
    const expensesPage = new ExpensesPage(window);
    await expect(expensesPage.dateFromInput()).toBeVisible({ timeout: 5_000 });
  });

  test('should show expense categories', async ({ window }) => {
    await expect(window.locator('text=/rent|electricity|gas|salaries|maintenance|other/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should open add expense modal', async ({ window }) => {
    const expensesPage = new ExpensesPage(window);
    await expensesPage.addExpenseButton().click();
    await expect(window.locator('text=/add.*expense|create.*expense/i').first()).toBeVisible({ timeout: 5_000 });
  });
});
