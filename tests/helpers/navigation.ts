import type { Page } from '@playwright/test';

export type NavSection =
  | 'pos'
  | 'orders'
  | 'products'
  | 'suppliers'
  | 'inventory'
  | 'customers'
  | 'expenses'
  | 'staff'
  | 'reports'
  | 'settings'
  | 'dashboard';

export async function navigateTo(page: Page, section: NavSection): Promise<void> {
  const sectionMap: Record<NavSection, string> = {
    pos: 'POS',
    orders: 'Sales',
    products: 'Products',
    suppliers: 'Purchases',
    inventory: 'Stock',
    customers: 'Customers',
    expenses: 'Expenses',
    staff: 'Staff',
    reports: 'Reports',
    settings: 'Settings',
    dashboard: 'Dashboard',
  };

  const label = sectionMap[section];
  const navLink = page.getByRole('link', { name: label });
  await navLink.click();
  await page.waitForTimeout(500);
}
