import type { Page } from '@playwright/test';

export class SettingsPage {
  constructor(private page: Page) {}

  sectionButton = (label: string) => this.page.locator('button').filter({ hasText: new RegExp(label, 'i') }).first();
  roleItem = (name: string) => this.page.locator('div').filter({ hasText: name }).first();
  addRoleButton = () => this.page.locator('button').filter({ hasText: /add role|add/i }).first();
  roleInput = () => this.page.locator('input').filter({ hasText: /role name|name/i }).first().or(this.page.locator('input[placeholder*="role" i]').first());
  saveRoleButton = () => this.page.locator('button').filter({ hasText: /create|save|add/i }).first();
  deleteRoleButton = (name: string) => this.page.locator('div').filter({ hasText: name }).locator('button:has-text("delete"), button:has-text("Delete")').first();
  editRoleButton = (name: string) => this.page.locator('div').filter({ hasText: name }).locator('button:has-text("edit"), button:has-text("Edit")').first();
  permissionToggle = (permLabel: string) => this.page.locator('div').filter({ hasText: permLabel }).locator('button[class*="rounded-full"], button').last();
  savePermissionsButton = () => this.page.locator('button').filter({ hasText: /save/i }).first();
  stockSection = () => this.page.locator('text=/stock|sale type/i').first();
  backupSection = () => this.page.locator('text=/backup|cloud/i').first();

  async switchSection(label: string) {
    await this.sectionButton(label).click();
    await this.page.waitForTimeout(300);
  }

  async addRole(name: string) {
    await this.addRoleButton().click();
    await this.page.waitForTimeout(300);
    await this.roleInput().fill(name);
    await this.saveRoleButton().click();
    await this.page.waitForTimeout(500);
  }
}
