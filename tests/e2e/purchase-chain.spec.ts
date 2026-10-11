import { test, expect } from '../fixtures/electron';
import { loginAsOwner } from '../helpers/auth';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';

type IpcResult<T = any> = { success: boolean; data?: T; error?: string };

/**
 * Call a main-process IPC handler through the preload bridge. These tests
 * exercise the real database (a fresh temp DB per test run) rather than the
 * rendered screen, so the whole purchase → stock → sales/adjust/return chain
 * is verified at the data layer.
 */
async function ipc<T = any>(page: Page, channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  return page.evaluate(
    ({ channel, args }) => (window as any).electronAPI.invoke(channel, ...args),
    { channel, args },
  ) as Promise<IpcResult<T>>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ownerId(page: Page): Promise<number> {
  const staff = await ipc<any[]>(page, 'staff:list');
  return Number((staff.data || [])[0]?.id || 1);
}

/** Returns an existing product or creates one, so the chain test is self-contained. */
async function ensureProduct(page: Page): Promise<{ id: number; name: string; unit: string }> {
  const list = await ipc<any[]>(page, 'menu:list', 1);
  const existing = (list.data || [])[0];
  if (existing) return existing;

  const created = await ipc<{ id: number }>(page, 'menu:create', {
    name: 'Chain Test Phone',
    category: 'Mobile Phones',
    price: 1500,
    wholesale_price: 1400,
    cost_price: 0,
    unit: 'pcs',
    active: 1,
  });
  expect(created.success, created.error).toBe(true);

  const again = await ipc<any[]>(page, 'menu:list', 1);
  const product = (again.data || []).find((p) => p.id === created.data!.id);
  expect(product).toBeTruthy();
  return product;
}

async function stockOf(page: Page, menuItemId: number): Promise<{ current: number; totalIn: number; totalUsed: number }> {
  const res = await ipc<any[]>(page, 'stock:summary');
  const row = (res.data || []).find((r) => r.menu_item_id === menuItemId);
  return {
    current: row ? Number(row.current_stock) : 0,
    totalIn: row ? Number(row.total_in) : 0,
    totalUsed: row ? Number(row.total_used) : 0,
  };
}

test.describe('Purchase → Stock chain (integration)', () => {
  test.beforeEach(async ({ window }) => {
    await loginAsOwner(window);
  });

  test('purchase applies discount, raises stock, keeps gross cost, and nets the ledger', async ({ window, testDbPath }) => {
    const uid = await ownerId(window);
    const supplier = await ipc<{ id: number }>(window, 'suppliers:create', { name: 'Chain Test Supplier' });
    expect(supplier.success, supplier.error).toBe(true);
    const supplierId = Number(supplier.data!.id);

    const product = await ensureProduct(window);
    const before = await stockOf(window, product.id);

    // 5 units @ 800 with a 10% supplier discount => gross 4000, discount 400, net 3600.
    const created = await ipc<any>(window, 'purchases:create', {
      supplier_id: supplierId,
      invoice_no: 'CHAIN-INV-1',
      purchase_date: today(),
      discount_type: 'percent',
      discount_value: 10,
      update_cost: true,
      apply_prices: false,
      items: [{ menu_item_id: product.id, item_name: product.name, quantity: 5, unit: product.unit, rate: 800 }],
    });
    expect(created.success, created.error).toBe(true);
    expect(Number(created.data.gross_amount)).toBeCloseTo(4000, 2);
    expect(Number(created.data.discount_amount)).toBeCloseTo(400, 2);
    expect(Number(created.data.total_amount)).toBeCloseTo(3600, 2);

    // Stock increased by the purchased quantity.
    const after = await stockOf(window, product.id);
    expect(after.current).toBeCloseTo(before.current + 5, 3);
    expect(after.totalIn).toBeCloseTo(before.totalIn + 5, 3);

    // Cost price stays at the GROSS buying rate — the discount does not touch it.
    const menu = await ipc<any[]>(window, 'menu:list', 1);
    const updated = (menu.data || []).find((p) => p.id === product.id);
    expect(Number(updated.cost_price)).toBeCloseTo(800, 2);

    // Report totals aggregate gross, discount and net separately.
    const listAll = await ipc<any>(window, 'purchases:list-all', {});
    expect(Number(listAll.data.totals.total_gross)).toBeCloseTo(4000, 2);
    expect(Number(listAll.data.totals.total_discount)).toBeCloseTo(400, 2);
    expect(Number(listAll.data.totals.total_net)).toBeCloseTo(3600, 2);
    expect(Number(listAll.data.totals.total_quantity)).toBeCloseTo(5, 3);

    // Per-product buying stats: avg cost is net-of-discount (3600/5 = 720), last rate is gross.
    const stats = await ipc<any[]>(window, 'purchases:stats-by-product', {});
    const stat = (stats.data || []).find((s) => s.menu_item_id === product.id);
    expect(Number(stat.total_quantity)).toBeCloseTo(5, 3);
    expect(Number(stat.avg_cost)).toBeCloseTo(720, 1);
    expect(Number(stat.last_rate)).toBeCloseTo(800, 2);

    // Supplier outstanding reflects the NET payable.
    const sup = await ipc<any>(window, 'suppliers:get', supplierId);
    expect(Number(sup.data.outstanding_balance)).toBeCloseTo(3600, 1);

    // Pay part of the invoice, outstanding drops accordingly.
    const pay = await ipc(window, 'supplier-payments:create', {
      supplier_id: supplierId, amount: 1000, payment_date: today(), method: 'cash',
    });
    expect(pay.success, pay.error).toBe(true);
    const sup2 = await ipc<any>(window, 'suppliers:get', supplierId);
    expect(Number(sup2.data.outstanding_balance)).toBeCloseTo(2600, 1);

    // DB-level check: the discount columns are persisted as expected.
    const db = new Database(testDbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT gross_amount, discount_amount, total_amount FROM purchases ORDER BY id DESC LIMIT 1').get() as any;
      expect(Number(row.gross_amount)).toBeCloseTo(4000, 2);
      expect(Number(row.discount_amount)).toBeCloseTo(400, 2);
      expect(Number(row.total_amount)).toBeCloseTo(3600, 2);
    } finally {
      db.close();
    }

    expect(uid).toBeGreaterThan(0);
  });

  test('stock adjustments can remove and re-add stock', async ({ window }) => {
    const uid = await ownerId(window);
    const product = await ensureProduct(window);
    const before = await stockOf(window, product.id);

    const out = await ipc(window, 'stock:adjust', {
      menu_item_id: product.id, item_name: product.name, quantity: 2, unit: product.unit,
      direction: 'out', source: 'damage', received_date: today(), created_by: uid,
    });
    expect(out.success, out.error).toBe(true);
    const afterOut = await stockOf(window, product.id);
    expect(afterOut.current).toBeCloseTo(before.current - 2, 3);
    expect(afterOut.totalUsed).toBeCloseTo(before.totalUsed + 2, 3);

    const back = await ipc(window, 'stock:adjust', {
      menu_item_id: product.id, item_name: product.name, quantity: 1, unit: product.unit,
      direction: 'in', source: 'found', received_date: today(), created_by: uid,
    });
    expect(back.success, back.error).toBe(true);
    const afterIn = await stockOf(window, product.id);
    expect(afterIn.current).toBeCloseTo(before.current - 1, 3);
    expect(afterIn.totalIn).toBeCloseTo(before.totalIn + 1, 3);
  });

  test('purchase return decrements stock and prorates the discount', async ({ window }) => {
    const uid = await ownerId(window);
    const supplier = await ipc<{ id: number }>(window, 'suppliers:create', { name: 'Return Test Supplier' });
    expect(supplier.success, supplier.error).toBe(true);
    const supplierId = Number(supplier.data!.id);

    const product = await ensureProduct(window);
    const before = await stockOf(window, product.id);

    const created = await ipc<any>(window, 'purchases:create', {
      supplier_id: supplierId, invoice_no: 'CHAIN-INV-RET', purchase_date: today(),
      discount_type: 'amount', discount_value: 100, update_cost: false, apply_prices: false,
      items: [{ menu_item_id: product.id, item_name: product.name, quantity: 4, unit: product.unit, rate: 500 }],
    });
    expect(created.success, created.error).toBe(true);
    // gross 2000, discount 100, net 1900 => net factor 0.95
    const afterBuy = await stockOf(window, product.id);
    expect(afterBuy.current).toBeCloseTo(before.current + 4, 3);

    const detail = await ipc<any>(window, 'purchases:get', Number(created.data.id));
    const line = detail.data.items[0];

    const ret = await ipc<any>(window, 'purchases:return', {
      purchase_id: Number(created.data.id), return_date: today(),
      items: [{ purchase_item_id: line.id, menu_item_id: product.id, item_name: product.name, quantity: 2, rate: 500 }],
    });
    expect(ret.success, ret.error).toBe(true);
    // 2 returned @ 500 gross * 0.95 net factor = 950 expected credit.
    expect(Number(ret.data.total_amount)).toBeCloseTo(950, 1);

    const afterReturn = await stockOf(window, product.id);
    expect(afterReturn.current).toBeCloseTo(before.current + 2, 3);

    expect(uid).toBeGreaterThan(0);
  });
});
