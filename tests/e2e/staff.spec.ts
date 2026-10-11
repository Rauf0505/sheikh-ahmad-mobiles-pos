import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import { navigateTo } from '../helpers/navigation';
import { StaffPage } from '../pages/staff.page';

test.describe('Staff Management', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
    await navigateTo(window, 'staff');
  });

  test('should display staff page', async ({ window }) => {
    await expect(window.locator('text=/staff|user/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show existing staff (Owner)', async ({ window }) => {
    await expect(window.locator('text=/Owner/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show add staff button', async ({ window }) => {
    const staffPage = new StaffPage(window);
    await expect(staffPage.addStaffButton()).toBeVisible({ timeout: 5_000 });
  });

  test('should show permission override section on staff select', async ({ window }) => {
    const staffPage = new StaffPage(window);
    await staffPage.clickStaff('Owner');
    await expect(window.locator('text=/Permission Overrides/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('should show search input', async ({ window }) => {
    const staffPage = new StaffPage(window);
    await expect(staffPage.searchInput()).toBeVisible({ timeout: 5_000 });
  });
});
