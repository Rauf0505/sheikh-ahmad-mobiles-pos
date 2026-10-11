import type { Page } from '@playwright/test';

export class StaffPage {
  constructor(private page: Page) {}

  staffItem = (name: string) => this.page.locator('main button').filter({ hasText: name }).first();
  addStaffButton = () => this.page.locator('button').filter({ hasText: /add|create|new/i }).first();
  editStaffButton = () => this.page.locator('button').filter({ hasText: /edit/i }).first();
  nameInput = () => this.page.locator('input').filter({ hasText: /name|full name/i }).first().or(this.page.locator('input[placeholder*="name" i]').first());
  roleSelect = () => this.page.locator('select').first();
  pinInput = () => this.page.locator('input[type="password"], input[maxlength="6"]').first();
  phoneInput = () => this.page.locator('input').filter({ hasText: /phone/i }).first().or(this.page.locator('input[placeholder*="phone" i]').first());
  saveButton = () => this.page.locator('button').filter({ hasText: /save|add|submit|create|update/i }).first();
  permissionToggle = (permLabel: string) => this.page.locator('div').filter({ hasText: permLabel }).locator('button[class*="rounded-full"], button').last();
  overrideSection = () => this.page.locator('text=/permission override/i').first();
  emptyState = () => this.page.locator('text=/no staff|empty|select/i').first();
  searchInput = () => this.page.locator('input[placeholder*="search" i]').first();

  async clickStaff(name: string) {
    await this.staffItem(name).click();
    await this.page.waitForTimeout(500);
  }

  async addStaff(name: string, role: string, pin: string) {
    await this.addStaffButton().click();
    await this.page.waitForTimeout(300);
    await this.nameInput().fill(name);
    await this.roleSelect().selectOption({ label: role });
    await this.pinInput().fill(pin);
    await this.saveButton().click();
    await this.page.waitForTimeout(500);
  }
}
