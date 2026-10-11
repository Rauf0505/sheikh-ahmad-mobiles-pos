import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { CustomersPage } from '../pages/customers.page';

test.describe('Customers Management', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'customers');
  });

  test('should display customers page', async ({ window }) => {
    await expect(window.locator('text=/customer/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show add customer button', async ({ window }) => {
    const customersPage = new CustomersPage(window);
    await expect(customersPage.addCustomerButton()).toBeVisible({ timeout: 5_000 });
  });

  test('should show empty state initially', async ({ window }) => {
    const customersPage = new CustomersPage(window);
    const hasCustomers = await customersPage.customerItem('test').isVisible().catch(() => false);
    if (!hasCustomers) {
      await expect(customersPage.emptyState().or(window.locator('text=/select|no customers/i').first())).toBeVisible();
    }
  });

  test('should open add customer modal', async ({ window }) => {
    const customersPage = new CustomersPage(window);
    await customersPage.addCustomerButton().click();
    await expect(window.locator('text=/add.*customer|create.*customer/i').first()).toBeVisible({ timeout: 5_000 });
  });
});
