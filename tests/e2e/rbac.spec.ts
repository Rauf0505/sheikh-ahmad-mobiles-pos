import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';

const invoke = (window: import('@playwright/test').Page, channel: string, ...args: unknown[]) =>
  window.evaluate(
    ([ch, a]) => (window as any).electronAPI.invoke(ch, ...a) as Promise<any>,
    [channel, args] as [string, unknown[]]
  );

async function createScopedUser(window: import('@playwright/test').Page, pin: string) {
  const role = await invoke(window, 'roles:create', `Scoped-${pin}`);
  const roleId = role.data.id;
  const perms = await invoke(window, 'permissions:list');
  const createBill = perms.data.find((p: any) => p.key === 'create_bill');
  await invoke(window, 'roles:update-permissions', roleId, [{ permission_id: createBill.id, allowed: 1 }]);
  const staff = await invoke(window, 'staff:create', { name: `Scoped User ${pin}`, role_id: roleId, pin, phone: null });
  return { userId: staff.data.id as number, roleId };
}

test.describe('Role-Based Access Control', () => {
  test.describe('Data scoping', () => {
    test('a role without view_all_data sees only its own orders', async ({ window }) => {
      await loginAsOwner(window);

      const ownerOrder = await invoke(window, 'orders:create', {
        sale_type: 'retail',
        created_by: 1,
        customer_id: null,
      });
      const ownerOrderId = ownerOrder.data.orderId;

      const { userId } = await createScopedUser(window, '222333');

      await invoke(window, 'auth:login', '222333');
      const ownOrder = await invoke(window, 'orders:create', {
        sale_type: 'wholesale',
        created_by: userId,
        customer_id: null,
      });
      const ownOrderId = ownOrder.data.orderId;

      const list = await invoke(window, 'orders:list', {});
      const ids = (list.data.rows as Array<{ id: number }>).map((r) => r.id);
      expect(ids).toContain(ownOrderId);
      expect(ids).not.toContain(ownerOrderId);
      expect(list.data.total).toBe(1);

      const foreign = await invoke(window, 'orders:get', ownerOrderId);
      expect(foreign.success).toBe(false);

      const own = await invoke(window, 'orders:get', ownOrderId);
      expect(own.success).toBe(true);
    });

    test('bills are scoped to the logged-in cashier for non-view-all users', async ({ window }) => {
      await loginAsOwner(window);

      await invoke(window, 'orders:create', { sale_type: 'retail', created_by: 1, customer_id: null });

      const { userId } = await createScopedUser(window, '333444');
      await invoke(window, 'auth:login', '333444');

      const order = await invoke(window, 'orders:create', { sale_type: 'retail', created_by: userId, customer_id: null });
      await invoke(window, 'bills:create', {
        order_id: order.data.orderId,
        subtotal: 100,
        discount_amount: 0,
        total: 100,
        payment_method: 'cash',
        cashier_id: userId,
      });

      const bills = await invoke(window, 'bills:list', undefined, undefined);
      expect(bills.success).toBe(true);
      const cashiers = (bills.data as Array<{ cashier_id: number }>).map((b) => b.cashier_id);
      expect(cashiers).toContain(userId);
      expect(cashiers.every((c) => c === userId)).toBe(true);
    });

    test('owner (view_all_data) sees all orders', async ({ window }) => {
      await loginAsOwner(window);

      const a = await invoke(window, 'orders:create', { sale_type: 'retail', created_by: 1, customer_id: null });
      const { userId: scopedId } = await createScopedUser(window, '444555');

      await invoke(window, 'orders:create', { sale_type: 'wholesale', created_by: scopedId, customer_id: null });
      await invoke(window, 'auth:login', '123456');

      const list = await invoke(window, 'orders:list', {});
      const ids = (list.data.rows as Array<{ id: number }>).map((r) => r.id);
      expect(ids).toContain(a.data.orderId);
      expect(list.data.total).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('Backend permission enforcement', () => {
    test('a role without edit_menu cannot create menu items', async ({ window }) => {
      await loginAsOwner(window);
      await createScopedUser(window, '555666');
      await invoke(window, 'auth:login', '555666');

      const result = await invoke(window, 'menu:create', {
        name: 'Should Not Be Created',
        category: 'Test',
        price: 100,
      });
      expect(result.success).toBe(false);
    });

    test('a role without view_reports cannot read reports', async ({ window }) => {
      await loginAsOwner(window);
      await createScopedUser(window, '666777');
      await invoke(window, 'auth:login', '666777');

      const result = await invoke(window, 'reports:sales-summary', '2020-01-01', '2030-01-01');
      expect(result.success).toBe(false);
    });

    test('a non-view-all user cannot view another bill', async ({ window }) => {
      await loginAsOwner(window);
      const order = await invoke(window, 'orders:create', { sale_type: 'retail', created_by: 1, customer_id: null });
      await invoke(window, 'bills:create', {
        order_id: order.data.orderId,
        subtotal: 100,
        discount_amount: 0,
        total: 100,
        payment_method: 'cash',
        cashier_id: 1,
      });
      const bills = await invoke(window, 'bills:list', undefined, undefined);
      const ownerBillId = (bills.data as Array<{ id: number }>)[0].id;

      await createScopedUser(window, '777888');
      await invoke(window, 'auth:login', '777888');
      const result = await invoke(window, 'bills:get', ownerBillId);
      expect(result.success).toBe(false);
    });
  });

  test.describe('Frontend route guard', () => {
    test('restricted role is redirected away from unauthorized pages', async ({ window }) => {
      await loginAsOwner(window);
      await createScopedUser(window, '888999');
      await invoke(window, 'auth:login', '888999');
      await window.reload();
      await expect(window.locator('h1').first()).toBeVisible({ timeout: 10_000 });

      const settingsLink = window.locator('a', { hasText: 'Settings' });
      expect(await settingsLink.count()).toBe(0);

      const session = await invoke(window, 'auth:session');
      expect(session.permissions.manage_settings).toBeFalsy();

      await window.evaluate(() => { window.location.hash = '#/settings'; });
      await window.waitForTimeout(2000);
      expect(await window.locator('h2', { hasText: 'Settings' }).count()).toBe(0);
      expect(await window.locator('text=/Business Profile/i').count()).toBe(0);
    });
  });
});