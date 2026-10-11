import { ipcMain } from 'electron';
import { getDatabase } from './connection.js';
import { getCurrentSession, isViewAll } from './auth.js';

function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(message: string) {
  return { success: false as const, error: message };
}

function writeAudit(db: import('better-sqlite3').Database, action: string, entity?: string, entityId?: number, details?: string, userId?: number) {
  const uid = userId ?? getCurrentSession()?.userId ?? 1;
  try {
    db.prepare(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)'
    ).run(uid, action, entity ?? null, entityId ?? null, details ?? null);
  } catch { /* audit logging must never break the main flow */ }
}

function hasPermission(key: string): boolean {
  return getCurrentSession()?.permissions?.[key] === true;
}

function ensureCategory(db: import('better-sqlite3').Database, categoryName: string) {
  const name = categoryName.trim();
  if (!name) return;
  const existing = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(name);
  if (existing) return;
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM menu_categories').get() as { n: number };
  db.prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)').run(name, max.n);
}

function getStockLevel(db: import('better-sqlite3').Database, menuItemId: number): number {
  const row = db.prepare('SELECT SUM(quantity) AS level FROM stock_entries WHERE menu_item_id = ?').get(menuItemId) as { level: number | null } | undefined;
  return Number(row?.level ?? 0);
}

function getAllowNegativeStock(db: import('better-sqlite3').Database): boolean {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('stock_allow_negative') as { value: string } | undefined;
  return row ? row.value !== '0' : false;
}

function getCustomerOutstanding(db: import('better-sqlite3').Database, customerId: number): number {
  const row = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE customer_id = ? AND type = 'credit'), 0)
      - COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE customer_id = ? AND type = 'payment'), 0) AS bal
  `).get(customerId, customerId) as { bal: number };
  return Number(row?.bal ?? 0);
}

function enforceCustomerCreditLimit(db: import('better-sqlite3').Database, customerId: number, amount: number) {
  const customer = db.prepare('SELECT credit_limit FROM customers WHERE id = ?').get(customerId) as { credit_limit: number } | undefined;
  const limit = Number(customer?.credit_limit ?? 0);
  if (limit <= 0) return;
  const outstanding = getCustomerOutstanding(db, customerId);
  if (outstanding + amount > limit) {
    throw new Error(
      `Credit limit exceeded — current balance ${outstanding.toLocaleString()} + this sale exceeds the limit of ${limit.toLocaleString()}`
    );
  }
}

function insertStockEntry(
  db: import('better-sqlite3').Database,
  entry: { menu_item_id: number | null; item_name: string; quantity: number; unit: string; received_date: string; supplier_id?: number | null; purchase_id?: number | null; order_id?: number | null; source: string; notes?: string | null; created_by: number }
) {
  return db.prepare(
    'INSERT INTO stock_entries (menu_item_id, item_name, quantity, unit, received_date, supplier_id, purchase_id, order_id, source, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    entry.menu_item_id, entry.item_name, entry.quantity, entry.unit, entry.received_date,
    entry.supplier_id ?? null, entry.purchase_id ?? null, entry.order_id ?? null,
    entry.source, entry.notes ?? null, entry.created_by
  );
}

interface CustomerLedgerRow {
  id: number;
  customer_id: number;
  order_id: number | null;
  type: 'credit' | 'payment';
  amount: number;
  entry_date: string;
  notes: string | null;
  created_at: string;
}

// Default selling margins applied when a purchase auto-creates a brand-new
// product (cost price comes from the purchase rate).
const AUTO_CREATE_RETAIL_MARKUP = 0.15;
const AUTO_CREATE_WHOLESALE_MARKUP = 0.10;

export function registerDatabaseHandlers() {
  // ─── MENU ITEMS ──────────────────────────────────────────────────────

  ipcMain.handle('menu:list', (_e, active?: number) => {
    try {
      const db = getDatabase();
      let where = '';
      const params: any[] = [];
      if (active !== undefined) {
        where += 'WHERE mi.active = ?';
        params.push(active);
      }
      const rows = db.prepare(`
        SELECT mi.*, s.name AS supplier_name,
          (
            SELECT COALESCE(SUM(se.quantity), 0)
            FROM stock_entries se WHERE se.menu_item_id = mi.id
          ) AS current_stock,
          (
            SELECT COALESCE(sr.reorder_level, 0)
            FROM stock_reorder sr
            WHERE sr.menu_item_id = mi.id
              OR (sr.item_name = mi.name AND sr.unit = mi.unit)
            ORDER BY (sr.menu_item_id = mi.id) DESC
            LIMIT 1
          ) AS reorder_level,
          (
            SELECT pi.rate
            FROM purchase_items pi
            INNER JOIN purchases p ON p.id = pi.purchase_id
            WHERE pi.menu_item_id = mi.id
            ORDER BY pi.id DESC LIMIT 1
          ) AS unit_cost
        FROM menu_items mi
        LEFT JOIN suppliers s ON s.id = mi.supplier_id
        ${where}
        ORDER BY mi.active DESC, mi.name
      `).all(...params);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:create', (_e, item: { name: string; category: string; price: number; wholesale_price?: number; cost_price?: number; brand?: string; model?: string; sku?: string; unit?: string; image_url?: string; description?: string; active?: number; shortcut?: string; supplier_id?: number }) => {
    try {
      if (!hasPermission('edit_menu')) return fail('Insufficient permissions to edit products');
      const db = getDatabase();
      const result = db.prepare(
        'INSERT INTO menu_items (name, category, price, wholesale_price, cost_price, brand, model, sku, unit, image_url, description, active, shortcut, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        item.name, item.category, item.price,
        item.wholesale_price ?? 0,
        item.cost_price ?? 0,
        item.brand ?? null,
        item.model ?? null,
        item.sku ?? null,
        item.unit ?? 'pcs',
        item.image_url ?? null,
        item.description ?? null,
        item.active ?? 1,
        item.shortcut ? String(item.shortcut).trim().toUpperCase() : null,
        item.supplier_id ?? null
      );
      ensureCategory(db, item.category);
      writeAudit(db, 'Create', 'Product', Number(result.lastInsertRowid), item.name);
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:update', (_e, id: number, item: { name?: string; category?: string; price?: number; wholesale_price?: number; cost_price?: number; brand?: string; model?: string; sku?: string; unit?: string; image_url?: string; description?: string; active?: number; shortcut?: string; supplier_id?: number }) => {
    try {
      if (!hasPermission('edit_menu')) return fail('Insufficient permissions to edit products');
      const db = getDatabase();
      const fields: string[] = [];
      const values: any[] = [];
      if (item.name !== undefined) { fields.push('name = ?'); values.push(item.name); }
      if (item.category !== undefined) { fields.push('category = ?'); values.push(item.category); }
      if (item.price !== undefined) { fields.push('price = ?'); values.push(item.price); }
      if (item.wholesale_price !== undefined) { fields.push('wholesale_price = ?'); values.push(item.wholesale_price); }
      if (item.cost_price !== undefined) { fields.push('cost_price = ?'); values.push(item.cost_price); }
      if (item.brand !== undefined) { fields.push('brand = ?'); values.push(item.brand); }
      if (item.model !== undefined) { fields.push('model = ?'); values.push(item.model); }
      if (item.sku !== undefined) { fields.push('sku = ?'); values.push(item.sku); }
      if (item.unit !== undefined) { fields.push('unit = ?'); values.push(item.unit); }
      if (item.image_url !== undefined) { fields.push('image_url = ?'); values.push(item.image_url); }
      if (item.description !== undefined) { fields.push('description = ?'); values.push(item.description); }
      if (item.active !== undefined) { fields.push('active = ?'); values.push(item.active); }
      if (item.shortcut !== undefined) { fields.push('shortcut = ?'); values.push(item.shortcut ? String(item.shortcut).trim().toUpperCase() : null); }
      if (item.supplier_id !== undefined) { fields.push('supplier_id = ?'); values.push(item.supplier_id); }
      if (fields.length === 0) return fail('No fields to update');
      const pricingChanged = item.price !== undefined || item.wholesale_price !== undefined || item.cost_price !== undefined;
      const before = pricingChanged
        ? (db.prepare('SELECT price, wholesale_price, cost_price FROM menu_items WHERE id = ?').get(id) as { price: number; wholesale_price: number; cost_price: number } | undefined)
        : undefined;
      values.push(id);
      db.prepare(`UPDATE menu_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (pricingChanged) {
        const after = db.prepare('SELECT price, wholesale_price, cost_price FROM menu_items WHERE id = ?').get(id) as { price: number; wholesale_price: number; cost_price: number } | undefined;
        if (after && (
          before?.price !== after.price ||
          before?.wholesale_price !== after.wholesale_price ||
          before?.cost_price !== after.cost_price
        )) {
          db.prepare(
            'INSERT INTO product_prices (menu_item_id, cost_price, retail_price, wholesale_price, source, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(id, after.cost_price ?? 0, after.price ?? 0, after.wholesale_price ?? 0, 'manual', 'Manual price edit', getCurrentSession()?.userId ?? 0);
        }
      }
      if (item.category !== undefined) ensureCategory(db, item.category);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:delete', (_e, id: number) => {
    try {
      if (!hasPermission('edit_menu')) return fail('Insufficient permissions to edit products');
      const db = getDatabase();
      const hasHistory = db.prepare(
        'SELECT (SELECT COUNT(*) FROM stock_entries WHERE menu_item_id = ?) + (SELECT COUNT(*) FROM purchase_items WHERE menu_item_id = ?) AS c'
      ).get(id, id) as { c: number };
      if (hasHistory.c > 0) {
        // Soft-delete: the product is referenced by purchases/stock. History must stay intact.
        db.prepare('UPDATE menu_items SET active = 0 WHERE id = ?').run(id);
        writeAudit(db, 'Deactivate', 'Product', id);
        return ok({ id, soft: true });
      }
      db.transaction(() => {
        db.prepare('DELETE FROM order_items WHERE menu_item_id = ?').run(id);
        db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
      })();
      writeAudit(db, 'Delete', 'Product', id);
      return ok({ id, soft: false });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:bulk-import', (_e, items: Array<{ name: string; category: string; price: number; wholesale_price?: number; cost_price?: number; brand?: string; model?: string; sku?: string; unit?: string; description?: string; image_url?: string; active?: number; shortcut?: string; supplier_id?: number }>) => {
    try {
      if (!hasPermission('edit_menu')) return fail('Insufficient permissions to edit products');
      if (!Array.isArray(items) || items.length === 0) return fail('No products to import');
      const db = getDatabase();
      const insert = db.prepare(
        'INSERT INTO menu_items (name, category, price, wholesale_price, cost_price, brand, model, sku, unit, image_url, description, active, shortcut, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      const errors: string[] = [];
      let imported = 0;
      const tx = db.transaction((list: typeof items) => {
        for (const item of list) {
          const name = String(item?.name ?? '').trim();
          const category = String(item?.category ?? '').trim();
          const price = Number(item?.price);
          if (!name || !category || isNaN(price)) {
            errors.push(`Invalid row: ${name || '(empty name)'} / ${category || '(empty category)'}`);
            continue;
          }
          const res = insert.run(
            name,
            category,
            price,
            Number(item?.wholesale_price) || 0,
            Number(item?.cost_price) || 0,
            item?.brand ? String(item.brand).trim() || null : null,
            item?.model ? String(item.model).trim() || null : null,
            item?.sku ? String(item.sku).trim() || null : null,
            item?.unit ? String(item.unit).trim() || 'pcs' : 'pcs',
            item.image_url ?? null,
            item.description ?? null,
            item.active === 0 ? 0 : 1,
            item.shortcut ? String(item.shortcut).trim().toUpperCase() : null,
            item.supplier_id ?? null
          );
          ensureCategory(db, category);
          imported++;
          writeAudit(db, 'Create', 'Product', Number(res.lastInsertRowid), name);
        }
      });
      tx(items);
      return ok({ imported, errors });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:categories', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT DISTINCT category FROM menu_items WHERE active = 1').all() as Array<{ category: string }>;
      return ok(rows.map((r) => r.category));
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── ORDERS ───────────────────────────────────────────────────────────

  ipcMain.handle('orders:create', (_e, order: { sale_type: string; created_by: number; customer_id?: number }) => {
    try {
      if (!hasPermission('create_bill')) return fail('Insufficient permissions to create sales');
      const db = getDatabase();
      const result = db.prepare(
        'INSERT INTO orders (sale_type, created_by, customer_id) VALUES (?, ?, ?)'
      ).run(order.sale_type === 'wholesale' ? 'wholesale' : 'retail', order.created_by, order.customer_id ?? null);
      return ok({ orderId: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('orders:add-item', (_e, item: { order_id: number; menu_item_id: number; qty: number; price: number; discount?: number; notes?: string }) => {
    try {
      const db = getDatabase();
      const result = db.prepare(
        'INSERT INTO order_items (order_id, menu_item_id, qty, price, discount, notes) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(item.order_id, item.menu_item_id, item.qty, item.price, item.discount ?? 0, item.notes ?? null);
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('orders:remove-item', (_e, id: number) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM order_items WHERE id = ?').run(id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('orders:update-item-qty', (_e, id: number, qty: number) => {
    try {
      const db = getDatabase();
      db.prepare('UPDATE order_items SET qty = ? WHERE id = ?').run(qty, id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('orders:get', (_e, id: number) => {
    try {
      const db = getDatabase();
      const order = db.prepare(`
        SELECT o.*, c.name AS customer_name
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ?
      `).get(id);
      if (!order) return fail('Order not found');
      if (!isViewAll() && (order as { created_by: number }).created_by !== (getCurrentSession()?.userId ?? 0)) {
        return fail('Insufficient permissions to view this order');
      }
      const items = db.prepare(`
        SELECT oi.*, mi.name AS name, mi.name AS item_name
        FROM order_items oi
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id = ?
      `).all(id);
      const bill = db.prepare('SELECT * FROM bills WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(id);
      return ok({ ...order as object, items, bill: bill || null });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('orders:list', (_e, filters?: { status?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }) => {
    try {
      const db = getDatabase();
      const conditions: string[] = [];
      const params: any[] = [];

      if (filters?.status) {
        conditions.push('o.status = ?');
        params.push(filters.status);
      }
      if (filters?.dateFrom) {
        conditions.push("o.created_at >= ?");
        params.push(filters.dateFrom);
      }
      if (filters?.dateTo) {
        conditions.push("o.created_at <= ? || ' 23:59:59'");
        params.push(filters.dateTo);
      }

      if (!isViewAll()) {
        conditions.push('o.created_by = ?');
        params.push(getCurrentSession()?.userId ?? 0);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRow = db.prepare(`SELECT COUNT(*) as count FROM orders o ${where}`).get(...params) as { count: number };
      const total = countRow.count;

      let query = `
        SELECT o.*, u.name AS created_by_name, b.total AS bill_total, b.payment_method
        FROM orders o
        LEFT JOIN users u ON u.id = o.created_by
        LEFT JOIN bills b ON b.order_id = o.id
        ${where}
        ORDER BY o.created_at DESC
      `;

      if (filters?.limit) {
        query += ' LIMIT ? OFFSET ?';
        params.push(filters.limit, filters.offset ?? 0);
      }

      const rows = db.prepare(query).all(...params);
      return ok({ rows, total });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('orders:update-status', (_e, id: number, status: string, reason?: string) => {
    try {
      const db = getDatabase();
      const session = getCurrentSession();
      if (status === 'cancelled') {
        if (!session?.permissions?.void_bill) {
          return fail('Insufficient permissions to void orders');
        }
      } else if (status === 'billed') {
        if (!session?.permissions?.create_bill) {
          return fail('Insufficient permissions to bill orders');
        }
      }
      const result = db.transaction(() => {
        const current = db.prepare('SELECT status, customer_id FROM orders WHERE id = ?').get(id) as { status: string; customer_id: number | null } | undefined;
        if (!current) throw new Error('Order not found');
        if (current.status === status) return { unchanged: true as const };

        const getProduct = db.prepare('SELECT name, unit FROM menu_items WHERE id = ?');
        const today = new Date().toISOString().slice(0, 10);
        const insertLedger = db.prepare(
          'INSERT INTO customer_ledger (customer_id, order_id, type, amount, entry_date, notes) VALUES (?, ?, ?, ?, ?, ?)'
        );

        if (status === 'cancelled') {
          const items = db.prepare('SELECT menu_item_id, qty FROM order_items WHERE order_id = ?').all(id) as Array<{ menu_item_id: number; qty: number }>;
          for (const it of items) {
            if (!it.menu_item_id) continue;
            const product = getProduct.get(it.menu_item_id) as { name: string; unit: string } | undefined;
            if (!product) continue;
            insertStockEntry(db, {
              menu_item_id: it.menu_item_id,
              item_name: product.name,
              quantity: Math.abs(it.qty),
              unit: product.unit,
              received_date: today,
              order_id: id,
              source: 'return',
              notes: `Void Order #${id}${reason ? ` — ${reason}` : ''}`,
              created_by: session?.userId ?? 0,
            });
          }
          // Reverse any credit that was put on the customer's account for this sale.
          const bill = db.prepare('SELECT total, payment_method FROM bills WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(id) as { total: number; payment_method: string } | undefined;
          if (bill && bill.payment_method === 'credit' && current.customer_id && Number(bill.total) > 0) {
            insertLedger.run(
              current.customer_id, id, 'payment', Number(bill.total), today,
              `Void Order #${id} — credit returned${reason ? ` (${reason})` : ''}`
            );
          }
        } else if (status === 'billed') {
          if (current.status !== 'open') throw new Error('Only open (unbilled) orders can be marked billed');
          const existing = db.prepare('SELECT id FROM bills WHERE order_id = ?').get(id);
          if (existing) throw new Error('This order has already been billed');
          const allowNegative = getAllowNegativeStock(db);
          const items = db.prepare('SELECT menu_item_id, qty FROM order_items WHERE order_id = ?').all(id) as Array<{ menu_item_id: number; qty: number }>;
          for (const it of items) {
            if (!it.menu_item_id) continue;
            const qty = Math.abs(Number(it.qty) || 0);
            if (qty > 0 && qty > getStockLevel(db, it.menu_item_id) && !allowNegative) {
              throw new Error('Insufficient stock to complete the sale — add stock first or enable negative stock in Settings');
            }
          }
          const totals = db.prepare('SELECT COALESCE(SUM(qty * price - discount), 0) AS subtotal FROM order_items WHERE order_id = ?').get(id) as { subtotal: number };
          const customerId = current.customer_id ?? null;
          const billTotal = Math.max(0, Math.round(Number(totals.subtotal || 0) * 100) / 100);
          if (billTotal <= 0) throw new Error('Cannot bill an order with no items');
          db.prepare(`
            INSERT INTO bills (order_id, subtotal, discount_amount, total, payment_method, cashier_id)
            VALUES (?, ?, 0, ?, ?, ?)
          `).run(id, billTotal, billTotal, customerId ? 'credit' : 'cash', session?.userId ?? 0);
          db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('billed', id);
          for (const it of items) {
            if (!it.menu_item_id) continue;
            const product = getProduct.get(it.menu_item_id) as { name: string; unit: string } | undefined;
            if (!product) continue;
            insertStockEntry(db, {
              menu_item_id: it.menu_item_id,
              item_name: product.name,
              quantity: -Math.abs(it.qty),
              unit: product.unit,
              received_date: today,
              order_id: id,
              source: 'sale',
              notes: `Sale Order #${id}`,
              created_by: session?.userId ?? 0,
            });
          }
          if (customerId && billTotal > 0) {
            insertLedger.run(customerId, id, 'credit', billTotal, today, `Sale Order #${id}`);
          }
        } else {
          db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
        }
        return { unchanged: false as const };
      })();
      if (result.unchanged) return ok({ id, unchanged: true });
      const details = status === 'cancelled'
        ? `Order #${id} voided${reason ? ` — Reason: ${reason}` : ''}`
        : `Order #${id} status changed to ${status}`;
      writeAudit(db, status === 'cancelled' ? 'Void' : 'Status Update', 'Order', id, details, session?.userId);
      return ok({ id, unchanged: false });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── BILLS ────────────────────────────────────────────────────────────

  ipcMain.handle('orders:delete', (_e, id: number) => {
    try {
      if (!hasPermission('create_bill')) return fail('Insufficient permissions to delete orders');
      const db = getDatabase();
      const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(id) as { status: string } | undefined;
      if (!order) return fail('Order not found');
      if (order.status !== 'open') return fail('Only open (unbilled) orders can be deleted');
      db.transaction(() => {
        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
        db.prepare('DELETE FROM orders WHERE id = ?').run(id);
      })();
      writeAudit(db, 'Delete', 'Order', id, `Order #${id} deleted (unbilled)`);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('bills:create', (_e, bill: {
    order_id: number; subtotal: number;
    discount_amount: number; total: number; payment_method: string; cashier_id: number;
  }) => {
    try {
      if (!hasPermission('create_bill')) return fail('Insufficient permissions to create sales');
      const db = getDatabase();
      const createBill = db.prepare(`
        INSERT INTO bills (order_id, subtotal, discount_amount, total, payment_method, cashier_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const updateOrder = db.prepare('UPDATE orders SET status = ? WHERE id = ?');
      const allowNegative = getAllowNegativeStock(db);

      const result = db.transaction(() => {
        const items = db.prepare('SELECT menu_item_id, qty FROM order_items WHERE order_id = ?').all(bill.order_id) as Array<{ menu_item_id: number; qty: number }>;
        for (const it of items) {
          if (!it.menu_item_id) continue;
          const qty = Math.abs(Number(it.qty) || 0);
          if (qty > 0 && qty > getStockLevel(db, it.menu_item_id) && !allowNegative) {
            throw new Error('Insufficient stock to complete the sale — add stock first or enable negative stock in Settings');
          }
        }
        const r = createBill.run(bill.order_id, bill.subtotal, bill.discount_amount, bill.total, bill.payment_method, bill.cashier_id);
        updateOrder.run('billed', bill.order_id);
        for (const it of items) {
          if (!it.menu_item_id) continue;
          const product = db.prepare('SELECT name, unit FROM menu_items WHERE id = ?').get(it.menu_item_id) as { name: string; unit: string } | undefined;
          if (!product) continue;
          insertStockEntry(db, {
            menu_item_id: it.menu_item_id,
            item_name: product.name,
            quantity: -Math.abs(it.qty),
            unit: product.unit,
            received_date: new Date().toISOString().slice(0, 10),
            order_id: bill.order_id,
            source: 'sale',
            notes: `Sale Order #${bill.order_id}`,
            created_by: bill.cashier_id,
          });
        }
        return r;
      })();

      return ok({ billId: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // Single-transaction checkout: order + items + bill + stock. Any failure
  // rolls back entirely so no orphan "open" orders can be left behind.
  ipcMain.handle('pos:checkout', (_e, sale: {
    sale_type: string; created_by: number; customer_id?: number;
    items: Array<{ menu_item_id: number; qty: number; price: number; discount?: number; notes?: string }>;
    subtotal: number; discount_amount: number; total: number;
    payment_method: string; cashier_id: number;
  }) => {
    try {
      if (!hasPermission('create_bill')) return fail('Insufficient permissions to create sales');
      const db = getDatabase();
      const session = getCurrentSession();
      const cashierId = sale.cashier_id ?? session?.userId ?? 0;
      const allowNegative = getAllowNegativeStock(db);

      const insertOrder = db.prepare('INSERT INTO orders (sale_type, created_by, customer_id) VALUES (?, ?, ?)');
      const insertItem = db.prepare('INSERT INTO order_items (order_id, menu_item_id, qty, price, discount, notes) VALUES (?, ?, ?, ?, ?, ?)');
      const getProduct = db.prepare('SELECT name, unit FROM menu_items WHERE id = ?');
      const createBill = db.prepare(`
        INSERT INTO bills (order_id, subtotal, discount_amount, total, payment_method, cashier_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const markBilled = db.prepare('UPDATE orders SET status = ? WHERE id = ?');
      const orderItems = db.prepare('SELECT menu_item_id, qty FROM order_items WHERE order_id = ?');
      const ledger = db.prepare('INSERT INTO customer_ledger (customer_id, order_id, type, amount, entry_date, notes) VALUES (?, ?, ?, ?, ?, ?)');

      let billId: number | bigint = 0;
      const result = db.transaction(() => {
        const orderResult = insertOrder.run(
          sale.sale_type === 'wholesale' ? 'wholesale' : 'retail',
          sale.created_by,
          sale.customer_id ?? null
        );
        const orderId = orderResult.lastInsertRowid;

        for (const item of sale.items) {
          insertItem.run(
            orderId, item.menu_item_id, Math.abs(Number(item.qty) || 0),
            Number(item.price) || 0, item.discount ?? 0, item.notes ?? null
          );
        }

        const items = orderItems.all(orderId) as Array<{ menu_item_id: number; qty: number }>;
        for (const it of items) {
          if (!it.menu_item_id) continue;
          const qty = Math.abs(Number(it.qty) || 0);
          if (qty > 0 && qty > getStockLevel(db, it.menu_item_id) && !allowNegative) {
            throw new Error('Insufficient stock to complete the sale — add stock first or enable negative stock in Settings');
          }
        }

        if (sale.payment_method === 'credit' && sale.customer_id) {
          enforceCustomerCreditLimit(db, sale.customer_id, sale.total);
        }

        const billResult = createBill.run(
          orderId, sale.subtotal, sale.discount_amount,
          sale.total, sale.payment_method, cashierId
        );
        billId = billResult.lastInsertRowid;
        markBilled.run('billed', orderId);

        const today = new Date().toISOString().slice(0, 10);
        for (const it of items) {
          if (!it.menu_item_id) continue;
          const product = getProduct.get(it.menu_item_id) as { name: string; unit: string } | undefined;
          if (!product) continue;
          insertStockEntry(db, {
            menu_item_id: it.menu_item_id,
            item_name: product.name,
            quantity: -Math.abs(it.qty),
            unit: product.unit,
            received_date: today,
            order_id: Number(orderId),
            source: 'sale',
            notes: `Sale Order #${orderId}`,
            created_by: cashierId,
          });
        }

        if (sale.payment_method === 'credit' && sale.customer_id) {
          ledger.run(
            sale.customer_id, Number(orderId), 'credit', sale.total, today,
            `Sale Order #${orderId} (${sale.sale_type === 'wholesale' ? 'Wholesale' : 'Retail'})`
          );
        }

        writeAudit(db, 'Create', 'Order', Number(orderId), `Order #${orderId} billed (${sale.payment_method})`, session?.userId);
        return Number(orderId);
      })();

      return ok({ orderId: result, billId: Number(billId) });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('bills:get', (_e, id: number) => {
    try {
      const db = getDatabase();
      const bill = db.prepare(`
        SELECT b.*, o.sale_type, o.customer_id, o.created_by AS order_created_by, o.status AS order_status
        FROM bills b
        JOIN orders o ON o.id = b.order_id
        WHERE b.id = ?
      `).get(id);
      if (!bill) return fail('Bill not found');
      if (!isViewAll() && (bill as { cashier_id: number }).cashier_id !== (getCurrentSession()?.userId ?? 0)) {
        return fail('Insufficient permissions to view this bill');
      }
      return ok(bill);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('bills:list', (_e, dateFrom?: string, dateTo?: string) => {
    try {
      const db = getDatabase();
      const scopeClause = isViewAll() ? '' : 'WHERE cashier_id = ?';
      const scopeParams: any[] = isViewAll() ? [] : [getCurrentSession()?.userId ?? 0];
      if (dateFrom && dateTo) {
        const where = scopeClause ? `${scopeClause} AND created_at >= ? AND created_at <= ?` : 'WHERE created_at >= ? AND created_at <= ?';
        const rows = db.prepare(
          `SELECT * FROM bills ${where} ORDER BY created_at DESC`
        ).all(...scopeParams, dateFrom, dateTo);
        return ok(rows);
      }
      const rows = db.prepare(`SELECT * FROM bills ${scopeClause} ORDER BY created_at DESC`).all(...scopeParams);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });


  // ─── SUPPLIERS ────────────────────────────────────────────────────────

  ipcMain.handle('suppliers:list', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT s.*,
          COALESCE(p.total_purchases, 0) - COALESCE(r.total_returns, 0) - COALESCE(pay.total_payments, 0) AS outstanding_balance
        FROM suppliers s
        LEFT JOIN (SELECT supplier_id, SUM(total_amount) AS total_purchases FROM purchases GROUP BY supplier_id) p ON p.supplier_id = s.id
        LEFT JOIN (SELECT supplier_id, SUM(returned_amount) AS total_returns FROM purchases GROUP BY supplier_id) r ON r.supplier_id = s.id
        LEFT JOIN (SELECT supplier_id, SUM(amount) AS total_payments FROM supplier_payments GROUP BY supplier_id) pay ON pay.supplier_id = s.id
        WHERE s.active = 1
        ORDER BY s.name
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('suppliers:create', (_e, supplier: { name: string; contact_phone?: string; address?: string; email?: string; gstin?: string; notes?: string }) => {
    try {
      if (!hasPermission('manage_suppliers')) return fail('Insufficient permissions to manage suppliers');
      const db = getDatabase();
      const result = db.prepare('INSERT INTO suppliers (name, contact_phone, address, email, gstin, notes) VALUES (?, ?, ?, ?, ?, ?)').run(
        supplier.name, supplier.contact_phone ?? null, supplier.address ?? null,
        supplier.email ?? null, supplier.gstin ?? null, supplier.notes ?? null
      );
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('suppliers:update', (_e, id: number, supplier: { name?: string; contact_phone?: string; address?: string; email?: string; gstin?: string; notes?: string }) => {
    try {
      if (!hasPermission('manage_suppliers')) return fail('Insufficient permissions to manage suppliers');
      const db = getDatabase();
      const fields: string[] = [];
      const values: any[] = [];
      if (supplier.name !== undefined) { fields.push('name = ?'); values.push(supplier.name); }
      if (supplier.contact_phone !== undefined) { fields.push('contact_phone = ?'); values.push(supplier.contact_phone); }
      if (supplier.address !== undefined) { fields.push('address = ?'); values.push(supplier.address); }
      if (supplier.email !== undefined) { fields.push('email = ?'); values.push(supplier.email); }
      if (supplier.gstin !== undefined) { fields.push('gstin = ?'); values.push(supplier.gstin); }
      if (supplier.notes !== undefined) { fields.push('notes = ?'); values.push(supplier.notes); }
      if (fields.length === 0) return fail('No fields to update');
      values.push(id);
      db.prepare(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('suppliers:get', (_e, id: number) => {
    try {
      const db = getDatabase();
      const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND active = 1').get(id);
      if (!supplier) return fail('Supplier not found');
      const purchases = db.prepare(`
        SELECT p.*, s.name AS supplier_name
        FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.supplier_id = ?
        ORDER BY p.purchase_date DESC, p.id DESC
      `).all(id);
      const payments = db.prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? ORDER BY payment_date DESC, id DESC').all(id);
      const returns = db.prepare(`
        SELECT pr.*, s.name AS supplier_name
        FROM purchase_returns pr
        LEFT JOIN suppliers s ON s.id = pr.supplier_id
        WHERE pr.supplier_id = ?
        ORDER BY pr.return_date DESC, pr.id DESC
      `).all(id);
      const products = db.prepare(`
        SELECT
          mi.id AS menu_item_id,
          mi.name,
          mi.unit,
          mi.price AS retail_price,
          mi.wholesale_price AS wholesale_price,
          mi.cost_price,
          (
            SELECT COALESCE(SUM(se.quantity), 0) FROM stock_entries se WHERE se.menu_item_id = mi.id
          ) AS on_hand,
          COALESCE(sr.reorder_level, 0) AS reorder_level,
          (
            SELECT MAX(se.received_date) FROM stock_entries se
            WHERE se.menu_item_id = mi.id AND se.source = 'purchase'
          ) AS last_received,
          (
            SELECT pi.rate FROM purchase_items pi
            INNER JOIN purchases p ON p.id = pi.purchase_id
            WHERE pi.menu_item_id = mi.id AND p.supplier_id = ?
            ORDER BY pi.id DESC LIMIT 1
          ) AS last_purchase_rate,
          (SELECT COUNT(*) FROM product_prices pp WHERE pp.menu_item_id = mi.id) AS price_history_count
        FROM menu_items mi
        LEFT JOIN stock_reorder sr ON sr.menu_item_id = mi.id
        WHERE mi.active = 1 AND (
          mi.supplier_id = ? OR EXISTS (
            SELECT 1 FROM purchase_items pi
            INNER JOIN purchases p ON p.id = pi.purchase_id AND p.supplier_id = ?
            WHERE pi.menu_item_id = mi.id
          )
        )
        ORDER BY mi.name
      `).all(id, id, id);
      const totals = db.prepare(`
        SELECT
          COALESCE((SELECT SUM(total_amount) FROM purchases WHERE supplier_id = ?), 0) AS total_purchases,
          COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = ?), 0) AS total_payments,
          COALESCE((SELECT SUM(returned_amount) FROM purchases WHERE supplier_id = ?), 0) AS total_returns
      `).get(id, id, id) as { total_purchases: number; total_payments: number; total_returns: number };
      const stats = db.prepare(`
        SELECT
          COUNT(DISTINCT p.id) AS purchase_count,
          COALESCE(SUM(p.total_amount), 0) AS total_purchased,
          COALESCE(SUM(pi.quantity), 0) AS total_units,
          MAX(p.purchase_date) AS last_purchase_date,
          (SELECT COUNT(*) FROM purchases p2 WHERE p2.supplier_id = ? AND p2.status IN ('unpaid', 'partial', 'partially_returned')) AS unpaid_purchases
        FROM purchases p
        LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
        WHERE p.supplier_id = ?
      `).get(id, id);
      return ok({
        ...supplier as object,
        outstanding_balance: Math.max(0, totals.total_purchases - totals.total_returns - totals.total_payments),
        total_returns: totals.total_returns,
        purchases,
        payments,
        returns,
        products,
        stats,
        product_count: products.length,
      });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('suppliers:delete', (_e, id: number) => {
    try {
      if (!hasPermission('manage_suppliers')) return fail('Insufficient permissions to manage suppliers');
      const db = getDatabase();
      db.prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('supplier-dashboard', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT
          s.id,
          s.name,
          COALESCE(prd.product_count, 0) AS product_count,
          COALESCE(prd.products_to_reorder, 0) AS products_to_reorder,
          COALESCE(prd.total_units, 0) AS total_units,
          COALESCE(prd.total_purchased, 0) AS total_purchased
        FROM suppliers s
        LEFT JOIN (
          SELECT
            COALESCE(mi.supplier_id, supply.last_supplier_id) AS supplier_id,
            COUNT(DISTINCT mi.id) AS product_count,
            SUM(CASE
              WHEN sr.reorder_level > 0 AND COALESCE(onhand.qty, 0) <= sr.reorder_level THEN 1
              ELSE 0
            END) AS products_to_reorder,
            COALESCE(SUM(supply.units), 0) AS total_units,
            COALESCE(SUM(supply.amount), 0) AS total_purchased
          FROM menu_items mi
          LEFT JOIN stock_reorder sr ON sr.menu_item_id = mi.id
          LEFT JOIN (
            SELECT se.menu_item_id, SUM(se.quantity) AS qty
            FROM stock_entries se GROUP BY se.menu_item_id
          ) onhand ON onhand.menu_item_id = mi.id
          LEFT JOIN (
            SELECT pi.menu_item_id,
              MIN(p.supplier_id) AS last_supplier_id,
              SUM(pi.quantity) AS units,
              SUM(pi.amount) AS amount
            FROM purchase_items pi
            INNER JOIN purchases p ON p.id = pi.purchase_id
            GROUP BY pi.menu_item_id
          ) supply ON supply.menu_item_id = mi.id
          WHERE mi.active = 1
          GROUP BY COALESCE(mi.supplier_id, supply.last_supplier_id)
        ) prd ON prd.supplier_id = s.id
        WHERE s.active = 1 AND prd.supplier_id IS NOT NULL
        ORDER BY prd.products_to_reorder DESC, s.name
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── PURCHASES ────────────────────────────────────────────────────────

  ipcMain.handle('purchases:create', (_e, purchase: {
    supplier_id: number; invoice_no?: string; purchase_date: string; notes?: string;
    update_cost?: boolean; apply_prices?: boolean;
    discount_type?: 'amount' | 'percent'; discount_value?: number;
    items: Array<{ item_name: string; menu_item_id?: number; quantity: number; unit: string; rate: number }>;
  }) => {
    try {
      if (!hasPermission('manage_purchases')) return fail('Insufficient permissions to manage purchases');
      const db = getDatabase();
      const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

      // Gross = sum of line amounts (qty × rate). The supplier may grant a
      // discount on the whole invoice; total_amount stores the NET payable.
      const grossAmount = round2(purchase.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0), 0));
      const discountType: 'amount' | 'percent' = purchase.discount_type === 'percent' ? 'percent' : 'amount';
      const discountValue = Math.max(0, Number(purchase.discount_value) || 0);
      let discountAmount = discountType === 'percent' ? round2(grossAmount * (discountValue / 100)) : round2(discountValue);
      if (discountAmount > grossAmount) discountAmount = grossAmount;
      const totalAmount = round2(grossAmount - discountAmount);

      const insertPurchase = db.prepare(
        'INSERT INTO purchases (supplier_id, invoice_no, purchase_date, gross_amount, discount_type, discount_value, discount_amount, total_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      const insertItem = db.prepare(
        'INSERT INTO purchase_items (purchase_id, menu_item_id, item_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const findProduct = db.prepare('SELECT id FROM menu_items WHERE name = ? AND active = 1');
      const insertProduct = db.prepare(
        'INSERT INTO menu_items (name, category, price, wholesale_price, cost_price, unit, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const getPricing = db.prepare('SELECT price, wholesale_price, cost_price FROM menu_items WHERE id = ?');
      const updatePricing = db.prepare('UPDATE menu_items SET price = ?, wholesale_price = ?, cost_price = ?, supplier_id = COALESCE(supplier_id, ?) WHERE id = ?');
      const insertPriceHistory = db.prepare(
        'INSERT INTO product_prices (menu_item_id, cost_price, retail_price, wholesale_price, source, purchase_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );

      const canAutoCreate = hasPermission('edit_menu');
      const updateCost = purchase.update_cost !== false;
      const applyPrices = purchase.apply_prices === true;

      const session = getCurrentSession();
      const userId = session?.userId ?? 0;

      const result = db.transaction(() => {
        const r = insertPurchase.run(
          purchase.supplier_id, purchase.invoice_no ?? null, purchase.purchase_date,
          grossAmount, discountType, discountValue, discountAmount, totalAmount, purchase.notes ?? null
        );
        const purchaseId = Number(r.lastInsertRowid);
        const refLabel = purchase.invoice_no ? `Invoice ${purchase.invoice_no}` : `Purchase #${purchaseId}`;
        let autoCreated = 0;
        for (const item of purchase.items) {
          const rate = Math.round(Number(item.rate) * 100) / 100;
          const amount = round2((Number(item.quantity) || 0) * rate);
          let menuItemId: number | null = item.menu_item_id ?? null;
          if (menuItemId === null) {
            const match = findProduct.get(item.item_name) as { id: number } | undefined;
            if (match) {
              menuItemId = match.id;
            } else {
              if (!canAutoCreate) {
                throw new Error(`"${item.item_name}" is not in the catalog. Add it as a product first (owner grant needed).`);
              }
              const name = String(item.item_name || '').trim();
              if (!name) throw new Error('Purchase line has an empty product name');
              const autoRetail = Math.round(rate * (1 + AUTO_CREATE_RETAIL_MARKUP));
              const autoWholesale = Math.round(rate * (1 + AUTO_CREATE_WHOLESALE_MARKUP));
              const created = insertProduct.run(
                name,
                'Accessories',
                autoRetail,
                autoWholesale,
                rate,
                item.unit || 'pcs',
                purchase.supplier_id
              );
              menuItemId = Number(created.lastInsertRowid);
              menuItemId = Number(created.lastInsertRowid);
              ensureCategory(db, 'Accessories');
              menuItemId = Number(created.lastInsertRowid);
              writeAudit(db, 'Create', 'Product', Number(menuItemId), name);
              autoCreated++;
            }
          }
          insertItem.run(purchaseId, menuItemId, item.item_name, item.quantity, item.unit, rate, amount);
          insertStockEntry(db, {
            menu_item_id: menuItemId,
            item_name: item.item_name,
            quantity: item.quantity,
            unit: item.unit,
            received_date: purchase.purchase_date,
            supplier_id: purchase.supplier_id,
            purchase_id: purchaseId,
            source: 'purchase',
            created_by: userId,
          });
          const cur = (getPricing.get(menuItemId) as { price: number; wholesale_price: number; cost_price: number } | undefined) ?? { price: rate, wholesale_price: 0, cost_price: 0 };
          const newRetail = applyPrices ? rate : Number(cur.price) || rate;
          const newWholesale = applyPrices ? rate : Number(cur.wholesale_price) || 0;
          const newCost = updateCost ? rate : Number(cur.cost_price) || 0;
          updatePricing.run(newRetail, newWholesale, newCost, purchase.supplier_id, menuItemId);
          insertPriceHistory.run(menuItemId, newCost, newRetail, newWholesale, 'purchase', Number(purchaseId), `${refLabel} — ${item.quantity} @ ${rate}`, Number(userId));
        }
        writeAudit(db, 'Create', 'Purchase', Number(purchaseId), `Supplier #${purchase.supplier_id} ${purchase.invoice_no ?? ''} (${purchase.items.length} lines)${discountAmount > 0 ? ` − discount ${discountAmount}` : ''}`);
        return { ...r, autoCreated };
      })();

      return ok({ id: result.lastInsertRowid, gross_amount: grossAmount, discount_amount: discountAmount, total_amount: totalAmount, auto_created: result.autoCreated });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('purchases:list', (_e, supplier_id: number) => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT p.*, s.name AS supplier_name
        FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.supplier_id = ?
        ORDER BY p.purchase_date DESC, p.id DESC
      `).all(supplier_id);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('purchases:list-all', (_e, filters?: { dateFrom?: string; dateTo?: string; supplier_id?: number; search?: string }) => {
    try {
      const db = getDatabase();
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (filters?.dateFrom) { where += ' AND p.purchase_date >= ?'; params.push(filters.dateFrom); }
      if (filters?.dateTo) { where += ' AND p.purchase_date <= ?'; params.push(filters.dateTo); }
      if (filters?.supplier_id) { where += ' AND p.supplier_id = ?'; params.push(filters.supplier_id); }
      if (filters?.search) {
        where += ' AND (p.invoice_no LIKE ? OR s.name LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`);
      }

      const rows = db.prepare(`
        SELECT p.*, s.name AS supplier_name,
          (SELECT COALESCE(SUM(pi.quantity), 0) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS total_quantity,
          (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS line_count
        FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        ${where}
        ORDER BY p.purchase_date DESC, p.id DESC
      `).all(...params);

      const totals = db.prepare(`
        SELECT
          COALESCE(SUM(p.gross_amount), 0) AS total_gross,
          COALESCE(SUM(p.discount_amount), 0) AS total_discount,
          COALESCE(SUM(p.total_amount), 0) AS total_net,
          COALESCE(SUM(p.paid_amount), 0) AS total_paid,
          COALESCE(SUM(p.returned_amount), 0) AS total_returned,
          COUNT(*) AS purchase_count
        FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        ${where}
      `).get(...params) as any;

      const qtyRow = db.prepare(`
        SELECT COALESCE(SUM(pi.quantity), 0) AS total_quantity
        FROM purchase_items pi
        INNER JOIN purchases p ON p.id = pi.purchase_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        ${where}
      `).get(...params) as { total_quantity: number };

      totals.total_quantity = qtyRow.total_quantity;
      totals.outstanding = Math.max(0, (Number(totals.total_net) || 0) - (Number(totals.total_paid) || 0) - (Number(totals.total_returned) || 0));
      return ok({ rows, totals });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('purchases:stats-by-product', (_e, filters?: { dateFrom?: string; dateTo?: string; supplier_id?: number }) => {
    try {
      const db = getDatabase();
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (filters?.dateFrom) { where += ' AND p.purchase_date >= ?'; params.push(filters.dateFrom); }
      if (filters?.dateTo) { where += ' AND p.purchase_date <= ?'; params.push(filters.dateTo); }
      if (filters?.supplier_id) { where += ' AND p.supplier_id = ?'; params.push(filters.supplier_id); }

      const rows = db.prepare(`
        SELECT
          COALESCE(mi.name, pi.item_name) AS product_name,
          pi.menu_item_id,
          COALESCE(mi.unit, pi.unit) AS unit,
          SUM(pi.quantity) AS total_quantity,
          SUM(pi.amount) AS total_gross,
          SUM(pi.amount * (CASE WHEN p.gross_amount > 0 THEN p.total_amount / p.gross_amount ELSE 1 END)) AS total_net,
          COALESCE(SUM(pi.amount * (CASE WHEN p.gross_amount > 0 THEN p.total_amount / p.gross_amount ELSE 1 END)) / NULLIF(SUM(pi.quantity), 0), 0) AS avg_cost,
          MAX(p.purchase_date) AS last_purchase_date,
          (SELECT pi2.rate FROM purchase_items pi2
             INNER JOIN purchases p2 ON p2.id = pi2.purchase_id
             WHERE pi2.menu_item_id = pi.menu_item_id
             ORDER BY pi2.id DESC LIMIT 1) AS last_rate
        FROM purchase_items pi
        INNER JOIN purchases p ON p.id = pi.purchase_id
        LEFT JOIN menu_items mi ON mi.id = pi.menu_item_id
        ${where}
        GROUP BY pi.menu_item_id, pi.item_name
        ORDER BY total_net DESC
      `).all(...params);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('purchases:get', (_e, id: number) => {
    try {
      const db = getDatabase();
      const purchase = db.prepare(`
        SELECT p.*, s.name AS supplier_name
        FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id = ?
      `).get(id);
      if (!purchase) return fail('Purchase not found');
      const items = db.prepare(`
        SELECT pi.*, mi.name AS product_name,
          COALESCE((SELECT COALESCE(SUM(pri.quantity), 0) FROM purchase_return_items pri WHERE pri.purchase_item_id = pi.id), 0) AS returned_qty
        FROM purchase_items pi
        LEFT JOIN menu_items mi ON mi.id = pi.menu_item_id
        WHERE pi.purchase_id = ?
        ORDER BY pi.id
      `).all(id);
      const returns = db.prepare(`
        SELECT pr.*, u.name AS created_by_name
        FROM purchase_returns pr
        LEFT JOIN users u ON u.id = pr.created_by
        WHERE pr.purchase_id = ?
        ORDER BY pr.return_date DESC, pr.id DESC
      `).all(id);
      return ok({ ...purchase as object, items, returns });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── PRODUCT PRICE HISTORY ─────────────────────────────────────────────

  ipcMain.handle('product-prices:list', (_e, menu_item_id: number) => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT pp.*, u.name AS created_by_name, s.name AS supplier_name
        FROM product_prices pp
        LEFT JOIN users u ON u.id = pp.created_by
        LEFT JOIN purchases pu ON pu.id = pp.purchase_id
        LEFT JOIN suppliers s ON s.id = pu.supplier_id
        WHERE pp.menu_item_id = ?
        ORDER BY pp.created_at DESC, pp.id DESC
      `).all(menu_item_id);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── PURCHASE RETURNS ──────────────────────────────────────────────────

  ipcMain.handle('purchases:return', (_e, ret: {
    purchase_id: number; return_date: string; notes?: string;
    items: Array<{ purchase_item_id: number; menu_item_id: number; item_name: string; quantity: number; rate: number }>;
  }) => {
    try {
      if (!hasPermission('manage_purchases')) return fail('Insufficient permissions to manage purchases');
      const db = getDatabase();
      const session = getCurrentSession();
      const userId = session?.userId ?? 0;

      const result = db.transaction(() => {
        const purchase = db.prepare('SELECT supplier_id, gross_amount, discount_amount, total_amount FROM purchases WHERE id = ?').get(ret.purchase_id) as { supplier_id: number; gross_amount: number; discount_amount: number; total_amount: number } | undefined;
        if (!purchase) throw new Error('Purchase not found');
        // When the supplier granted a discount, the return credit must be
        // prorated so it matches the net amount actually owed/paid.
        const gross = Number(purchase.gross_amount) || 0;
        const netFactor = gross > 0 ? (Number(purchase.total_amount) || 0) / gross : 1;
        let totalAmount = 0;
        for (const item of ret.items) {
          const qty = Number(item.quantity) || 0;
          const rate = Math.round(Number(item.rate) * 100) / 100;
          if (qty <= 0) throw new Error('Return quantity must be greater than zero');
          totalAmount += qty * rate * netFactor;
        }
        totalAmount = Math.round(totalAmount * 100) / 100;
        if (totalAmount <= 0) throw new Error('Nothing to return');

        const r = db.prepare(
          'INSERT INTO purchase_returns (purchase_id, supplier_id, return_date, total_amount, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(ret.purchase_id, purchase.supplier_id, ret.return_date, totalAmount, ret.notes ?? null, userId);
        const returnId = Number(r.lastInsertRowid);

        const insertItem = db.prepare(
          'INSERT INTO purchase_return_items (return_id, purchase_item_id, menu_item_id, item_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const getProduct = db.prepare('SELECT name, unit FROM menu_items WHERE id = ?');

        for (const item of ret.items) {
          const qty = Number(item.quantity) || 0;
          const netRate = Math.round((Number(item.rate) || 0) * netFactor * 100) / 100;
          const pi = db.prepare(`
            SELECT id, menu_item_id, item_name, unit, quantity,
              COALESCE((SELECT COALESCE(SUM(pri.quantity), 0) FROM purchase_return_items pri WHERE pri.purchase_item_id = purchase_items.id), 0) AS returned_qty
            FROM purchase_items
            WHERE id = ? AND purchase_id = ?
          `).get(item.purchase_item_id, ret.purchase_id) as { id: number; menu_item_id: number | null; item_name: string; unit: string; quantity: number; returned_qty: number } | undefined;
          if (!pi) throw new Error('Return line does not belong to this purchase');
          if (qty > pi.quantity - pi.returned_qty) throw new Error(`Cannot return more than purchased for "${pi.item_name}" (remaining ${pi.quantity - pi.returned_qty})`);
          insertItem.run(returnId, pi.id, pi.menu_item_id ?? item.menu_item_id, pi.item_name, qty, pi.unit || 'pcs', netRate, Math.round(qty * netRate * 100) / 100);
          const product = pi.menu_item_id ? (getProduct.get(pi.menu_item_id) as { name: string; unit: string } | undefined) : undefined;
          insertStockEntry(db, {
            menu_item_id: pi.menu_item_id ?? item.menu_item_id,
            item_name: product?.name ?? item.item_name,
            quantity: -qty,
            unit: product?.unit ?? 'pcs',
            received_date: ret.return_date,
            supplier_id: purchase.supplier_id,
            purchase_id: ret.purchase_id,
            source: 'purchase_return',
            notes: `Return #${returnId} on Purchase #${ret.purchase_id}`,
            created_by: userId,
          });
        }

        const upd = db.prepare('SELECT total_amount, paid_amount, returned_amount FROM purchases WHERE id = ?').get(ret.purchase_id) as { total_amount: number; paid_amount: number; returned_amount: number };
        const newReturned = upd.returned_amount + totalAmount;
        let status: string;
        if (newReturned >= upd.total_amount) {
          status = 'returned';
        } else if (newReturned > 0) {
          status = 'partially_returned';
        } else if (upd.paid_amount >= upd.total_amount) {
          status = 'paid';
        } else if (upd.paid_amount > 0) {
          status = 'partial';
        } else {
          status = 'unpaid';
        }
        db.prepare('UPDATE purchases SET returned_amount = ?, status = ? WHERE id = ?').run(newReturned, status, ret.purchase_id);
        writeAudit(db, 'Create', 'Purchase Return', returnId, `Purchase #${ret.purchase_id} return ${totalAmount} (${ret.items.length} lines)`);
        return { id: returnId, total_amount: totalAmount };
      })();

      return ok(result);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── SUPPLIER PAYMENTS ────────────────────────────────────────────────

  ipcMain.handle('supplier-payments:create', (_e, payment: {
    supplier_id: number; purchase_id?: number | null; amount: number;
    payment_date: string; method: string; notes?: string;
  }) => {
    try {
      if (!hasPermission('record_supplier_payments')) return fail('Insufficient permissions to record supplier payments');
      const db = getDatabase();
      const amount = Math.round(Number(payment.amount) * 100) / 100;
      if (!(amount > 0)) return fail('Payment amount must be greater than zero');

      const result = db.transaction(() => {
        // Resolve the invoice this payment is applied to (explicit or oldest unpaid).
        let purchaseId: number | null = payment.purchase_id ?? null;
        if (purchaseId != null) {
          const inv = db.prepare('SELECT supplier_id, total_amount, paid_amount, returned_amount, status FROM purchases WHERE id = ?').get(purchaseId) as
            { supplier_id: number; total_amount: number; paid_amount: number; returned_amount: number; status: string } | undefined;
          if (!inv) throw new Error('Purchase invoice not found');
          if (inv.supplier_id !== payment.supplier_id) throw new Error('Invoice does not belong to this supplier');
          const due = inv.total_amount - inv.paid_amount - inv.returned_amount;
          if (inv.status === 'paid' || inv.status === 'returned' || due <= 0) throw new Error('This invoice has no outstanding balance');
          if (amount > due) throw new Error(`Payment of ${amount} exceeds this invoice's outstanding of ${Math.round(due * 100) / 100}`);
        } else {
          const open = db.prepare(`
            SELECT id, total_amount, paid_amount, returned_amount
            FROM purchases
            WHERE supplier_id = ?
              AND status NOT IN ('paid', 'returned')
              AND (total_amount - paid_amount - returned_amount) > 0
            ORDER BY purchase_date ASC, id ASC
            LIMIT 1
          `).get(payment.supplier_id) as { id: number; total_amount: number; paid_amount: number; returned_amount: number } | undefined;
          if (!open) {
            const anyDue = db.prepare(`
              SELECT COALESCE(SUM(total_amount - paid_amount - returned_amount), 0) AS due
              FROM purchases WHERE supplier_id = ?
            `).get(payment.supplier_id) as { due: number };
            if (Number(anyDue.due) <= 0) throw new Error('Supplier has no outstanding balance to pay');
            throw new Error('Unable to resolve an open invoice for this payment');
          }
          purchaseId = open.id;
        }

        const r = db.prepare(
          'INSERT INTO supplier_payments (supplier_id, purchase_id, amount, payment_date, method, notes) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(payment.supplier_id, purchaseId, amount, payment.payment_date, payment.method, payment.notes ?? null);

        const purchase = db.prepare('SELECT total_amount, paid_amount, returned_amount FROM purchases WHERE id = ?').get(purchaseId) as
          { total_amount: number; paid_amount: number; returned_amount: number } | undefined;
        if (purchase) {
          const newPaid = purchase.paid_amount + amount;
          const remaining = purchase.total_amount - purchase.returned_amount;
          let status: string;
          if (purchase.returned_amount >= purchase.total_amount) {
            status = 'returned';
          } else if (purchase.returned_amount > 0) {
            status = 'partially_returned';
          } else if (newPaid >= remaining) {
            status = 'paid';
          } else if (newPaid > 0) {
            status = 'partial';
          } else {
            status = 'unpaid';
          }
          db.prepare('UPDATE purchases SET paid_amount = ?, status = ? WHERE id = ?').run(newPaid, status, purchaseId);
        }

        writeAudit(db, 'Create', 'Supplier Payment', purchaseId, `Supplier #${payment.supplier_id} ${amount} applied to invoice #${purchaseId}`);
        return { ...r, purchase_id: purchaseId };
      })();

      return ok({ id: result.lastInsertRowid, purchase_id: result.purchase_id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('supplier-payments:list', (_e, supplier_id: number) => {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? ORDER BY payment_date DESC').all(supplier_id);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── STOCK ENTRIES ────────────────────────────────────────────────────

  ipcMain.handle('stock:list', (_e, filters?: { dateFrom?: string; dateTo?: string; item_name?: string; supplier_id?: number }) => {
    try {
      const db = getDatabase();
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (filters?.dateFrom) { where += ' AND se.received_date >= ?'; params.push(filters.dateFrom); }
      if (filters?.dateTo) { where += ' AND se.received_date <= ?'; params.push(filters.dateTo); }
      if (filters?.item_name) { where += ' AND se.item_name LIKE ?'; params.push(`%${filters.item_name}%`); }
      if (filters?.supplier_id) { where += ' AND se.supplier_id = ?'; params.push(filters.supplier_id); }
      const rows = db.prepare(`
        SELECT se.*, s.name AS supplier_name, u.name AS created_by_name, u.name AS logged_by_name
        FROM stock_entries se
        LEFT JOIN suppliers s ON s.id = se.supplier_id
        LEFT JOIN users u ON u.id = se.created_by
        ${where}
        ORDER BY se.received_date DESC, se.id DESC
      `).all(...params);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('stock:create', (_e, entry: {
    item_name: string; menu_item_id?: number; quantity: number; unit: string; received_date: string;
    supplier_id?: number; notes?: string; created_by: number;
  }) => {
    try {
      if (!hasPermission('add_stock_entries')) return fail('Insufficient permissions to add stock entries');
      const db = getDatabase();
      let menuItemId: number | null = entry.menu_item_id ?? null;
      if (menuItemId === null) {
        const match = db.prepare('SELECT id FROM menu_items WHERE name = ? AND active = 1').get(entry.item_name) as { id: number } | undefined;
        if (match) menuItemId = match.id;
      }
      if (menuItemId === null) {
        throw new Error(`"${entry.item_name}" is not in the catalog — it must be added as a product before stock can be recorded for it.`);
      }
      const result = insertStockEntry(db, {
        menu_item_id: menuItemId,
        item_name: entry.item_name,
        quantity: entry.quantity,
        unit: entry.unit,
        received_date: entry.received_date,
        supplier_id: entry.supplier_id,
        source: 'manual',
        notes: entry.notes ?? null,
        created_by: entry.created_by,
      });
      writeAudit(db, 'Create', 'Stock Entry', Number(result.lastInsertRowid), `${entry.item_name} +${entry.quantity} ${entry.unit}`, entry.created_by);
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('stock:summary', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT
          mi.id AS menu_item_id,
          COALESCE(mi.name, se.item_name) AS item_name,
          COALESCE(mi.unit, se.unit) AS unit,
          mi.category,
          mi.price AS retail_price,
          mi.wholesale_price AS wholesale_price,
          COALESCE(mi.supplier_id, (
            SELECT sed.supplier_id FROM stock_entries sed
            WHERE sed.menu_item_id = mi.id AND sed.source = 'purchase'
            ORDER BY sed.id DESC LIMIT 1
          )) AS supplier_id,
          (SELECT s.name FROM suppliers s WHERE s.id = COALESCE(mi.supplier_id, (
              SELECT sed.supplier_id FROM stock_entries sed
              WHERE sed.menu_item_id = mi.id AND sed.source = 'purchase'
              ORDER BY sed.id DESC LIMIT 1
          ))) AS supplier_name,
          COALESCE(SUM(CASE WHEN se.source <> 'sale' AND se.quantity > 0 THEN se.quantity ELSE 0 END), 0) AS total_in,
          COALESCE(SUM(CASE WHEN se.source = 'sale' THEN -se.quantity ELSE 0 END), 0) AS total_sold,
          COALESCE(SUM(CASE WHEN se.source <> 'sale' AND se.quantity < 0 THEN -se.quantity ELSE 0 END), 0) AS total_used,
          COALESCE(SUM(se.quantity), 0) AS current_stock,
          MAX(se.received_date) AS last_received,
          COALESCE(sr.reorder_level, (
            SELECT sr2.reorder_level FROM stock_reorder sr2
            WHERE sr2.item_name = COALESCE(mi.name, se.item_name) AND sr2.unit = COALESCE(mi.unit, se.unit)
            LIMIT 1
          ), 0) AS reorder_level,
          (
            SELECT pi.rate FROM purchase_items pi
            INNER JOIN purchases p ON p.id = pi.purchase_id
            WHERE pi.menu_item_id = mi.id
            ORDER BY pi.id DESC LIMIT 1
          ) AS last_purchase_rate
        FROM stock_entries se
        LEFT JOIN menu_items mi ON mi.id = se.menu_item_id
        LEFT JOIN stock_reorder sr ON sr.menu_item_id = mi.id
        GROUP BY mi.id, se.item_name, se.unit
        ORDER BY COALESCE(mi.name, se.item_name)
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('stock:reorder:set', (_e, opts: { menu_item_id?: number | null; item_name?: string; unit?: string; reorder_level: number }) => {
    try {
      const db = getDatabase();
      const reorderLevel = Number(opts.reorder_level) || 0;
      const menuItemId = opts.menu_item_id ?? null;
      const itemName = opts.item_name ?? '';
      const unit = opts.unit ?? 'pcs';
      if (menuItemId != null) {
        db.prepare(`
          INSERT INTO stock_reorder (menu_item_id, item_name, unit, reorder_level) VALUES (?, ?, ?, ?)
          ON CONFLICT(menu_item_id) WHERE menu_item_id IS NOT NULL DO UPDATE SET
            item_name = excluded.item_name,
            unit = excluded.unit,
            reorder_level = excluded.reorder_level
        `).run(menuItemId, itemName, unit, reorderLevel);
      } else {
        db.prepare(`
          INSERT INTO stock_reorder (item_name, unit, reorder_level) VALUES (?, ?, ?)
          ON CONFLICT(item_name, unit) DO UPDATE SET reorder_level = excluded.reorder_level
        `).run(itemName, unit, reorderLevel);
      }
      return ok({});
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── CUSTOMERS ────────────────────────────────────────────────────────

  ipcMain.handle('customers:list', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT c.*,
          COALESCE(cred.total_credit, 0) - COALESCE(pay.total_payment, 0) AS outstanding_balance
        FROM customers c
        LEFT JOIN (SELECT customer_id, SUM(amount) AS total_credit FROM customer_ledger WHERE type = 'credit' GROUP BY customer_id) cred ON cred.customer_id = c.id
        LEFT JOIN (SELECT customer_id, SUM(amount) AS total_payment FROM customer_ledger WHERE type = 'payment' GROUP BY customer_id) pay ON pay.customer_id = c.id
        WHERE c.active = 1
        ORDER BY c.name
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('customers:create', (_e, customer: { name: string; phone?: string; address?: string; email?: string; credit_limit?: number; notes?: string }) => {
    try {
      if (!hasPermission('add_customers')) return fail('Insufficient permissions to manage customers');
      const db = getDatabase();
      const result = db.prepare('INSERT INTO customers (name, phone, address, email, credit_limit, notes) VALUES (?, ?, ?, ?, ?, ?)').run(
        customer.name, customer.phone ?? null, customer.address ?? null,
        customer.email ?? null, customer.credit_limit ?? 0, customer.notes ?? null
      );
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('customers:update', (_e, id: number, customer: { name?: string; phone?: string; address?: string; email?: string; credit_limit?: number; notes?: string }) => {
    try {
      if (!hasPermission('add_customers')) return fail('Insufficient permissions to manage customers');
      const db = getDatabase();
      const fields: string[] = [];
      const values: any[] = [];
      if (customer.name !== undefined) { fields.push('name = ?'); values.push(customer.name); }
      if (customer.phone !== undefined) { fields.push('phone = ?'); values.push(customer.phone); }
      if (customer.address !== undefined) { fields.push('address = ?'); values.push(customer.address); }
      if (customer.email !== undefined) { fields.push('email = ?'); values.push(customer.email); }
      if (customer.credit_limit !== undefined) { fields.push('credit_limit = ?'); values.push(customer.credit_limit); }
      if (customer.notes !== undefined) { fields.push('notes = ?'); values.push(customer.notes); }
      if (fields.length === 0) return fail('No fields to update');
      values.push(id);
      db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('customers:get', (_e, id: number) => {
    try {
      const db = getDatabase();
      const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(id);
      if (!customer) return fail('Customer not found');
      const entries = db.prepare('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY entry_date ASC, id ASC').all(id) as Array<CustomerLedgerRow>;
      let running = 0;
      const ledgerDesc = entries.map((e) => {
        running += e.type === 'credit' ? Number(e.amount) : -Number(e.amount);
        return { ...e, running_balance: running };
      }).reverse();
      return ok({ ...customer as object, outstanding_balance: getCustomerOutstanding(db, id), ledger: ledgerDesc });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('customers:delete', (_e, id: number) => {
    try {
      if (!hasPermission('add_customers')) return fail('Insufficient permissions to manage customers');
      const db = getDatabase();
      db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── CUSTOMER LEDGER ──────────────────────────────────────────────────

  ipcMain.handle('customer-ledger:create', (_e, entry: {
    customer_id: number; order_id?: number; type: 'credit' | 'payment';
    amount: number; entry_date: string; notes?: string;
  }) => {
    try {
      if (entry.type === 'credit' && !hasPermission('record_customer_credit')) return fail('Insufficient permissions to record customer credit');
      if (entry.type === 'payment' && !hasPermission('record_customer_payments')) return fail('Insufficient permissions to record customer payments');
      const db = getDatabase();
      if (entry.type === 'credit' && Number(entry.amount) > 0) {
        enforceCustomerCreditLimit(db, entry.customer_id, Number(entry.amount));
      }
      db.transaction(() => {
        db.prepare(
          'INSERT INTO customer_ledger (customer_id, order_id, type, amount, entry_date, notes) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(entry.customer_id, entry.order_id ?? null, entry.type, entry.amount, entry.entry_date, entry.notes ?? null);
        writeAudit(db, entry.type === 'credit' ? 'Create' : 'Create', 'Customer Ledger', Number(entry.customer_id),
          `${entry.type === 'credit' ? 'Credit' : 'Payment'} ${entry.amount} for customer #${entry.customer_id}`);
      })();
      return ok({});
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('customer-ledger:list', (_e, customer_id: number) => {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY entry_date DESC').all(customer_id);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── EXPENSES ─────────────────────────────────────────────────────────

  ipcMain.handle('expenses:list', (_e, dateFrom?: string, dateTo?: string) => {
    try {
      const db = getDatabase();
      let query = `
        SELECT e.*, ec.name AS category_name
        FROM expenses e
        JOIN expense_categories ec ON ec.id = e.category_id
      `;
      const params: any[] = [];
      if (dateFrom && dateTo) {
        query += ' WHERE e.expense_date >= ? AND e.expense_date <= ?';
        params.push(dateFrom, dateTo);
      }
      if (!isViewAll()) {
        query += (params.length ? ' AND' : ' WHERE') + ' e.paid_by = ?';
        params.push(getCurrentSession()?.userId ?? 0);
      }
      query += ' ORDER BY e.expense_date DESC';
      const rows = db.prepare(query).all(...params);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('expenses:create', (_e, expense: {
    category_id: number; description: string; amount: number;
    expense_date: string; paid_by: number; notes?: string;
  }) => {
    try {
      if (!hasPermission('manage_expenses')) return fail('Insufficient permissions to manage expenses');
      const db = getDatabase();
      const result = db.prepare(
        'INSERT INTO expenses (category_id, description, amount, expense_date, paid_by, notes) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(expense.category_id, expense.description, expense.amount, expense.expense_date, expense.paid_by, expense.notes ?? null);
      writeAudit(db, 'Create', 'Expense', Number(result.lastInsertRowid), expense.description, expense.paid_by);
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('expenses:update', (_e, id: number, expense: {
    category_id?: number; description?: string; amount?: number;
    expense_date?: string; notes?: string;
}) => {
    try {
      if (!hasPermission('manage_expenses')) return fail('Insufficient permissions to manage expenses');
      const db = getDatabase();
      const fields: string[] = [];
      const values: any[] = [];
      if (expense.category_id !== undefined) { fields.push('category_id = ?'); values.push(expense.category_id); }
      if (expense.description !== undefined) { fields.push('description = ?'); values.push(expense.description); }
      if (expense.amount !== undefined) { fields.push('amount = ?'); values.push(expense.amount); }
      if (expense.expense_date !== undefined) { fields.push('expense_date = ?'); values.push(expense.expense_date); }
      if (expense.notes !== undefined) { fields.push('notes = ?'); values.push(expense.notes); }
      if (fields.length === 0) return fail('No fields to update');
      values.push(id);
      db.prepare(`UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      writeAudit(db, 'Update', 'Expense', id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('expenses:delete', (_e, id: number) => {
    try {
      if (!hasPermission('manage_expenses')) return fail('Insufficient permissions to manage expenses');
      const db = getDatabase();
      db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
      writeAudit(db, 'Delete', 'Expense', id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('expenses:categories:delete', (_e, id: number) => {
    try {
      if (!hasPermission('manage_expense_categories')) return fail('Insufficient permissions to manage expense categories');
      const db = getDatabase();
      const count = db.prepare('SELECT COUNT(*) AS c FROM expenses WHERE category_id = ?').get(id) as { c: number };
      if (count.c > 0) return fail('Cannot delete category with existing expenses');
      db.prepare('DELETE FROM expense_categories WHERE id = ?').run(id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('expenses:categories', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM expense_categories ORDER BY name').all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('expenses:categories:create', (_e, name: string) => {
    try {
      if (!hasPermission('manage_expense_categories')) return fail('Insufficient permissions to manage expense categories');
      const db = getDatabase();
      const result = db.prepare('INSERT INTO expense_categories (name) VALUES (?)').run(name);
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── STAFF (USERS) ───────────────────────────────────────────────────

  ipcMain.handle('staff:list', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT u.id, u.name, u.phone, u.active, u.role_id, r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        ORDER BY u.name
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('staff:create', (_e, staff: { name: string; role_id: number; pin: string; phone?: string }) => {
    try {
      if (!hasPermission('manage_staff')) return fail('Insufficient permissions to manage staff');
      const db = getDatabase();
      const bcrypt = require('bcryptjs');
      const hashedPin = bcrypt.hashSync(staff.pin, 10);
      const result = db.prepare('INSERT INTO users (name, role_id, pin, phone) VALUES (?, ?, ?, ?)').run(
        staff.name, staff.role_id, hashedPin, staff.phone ?? null
      );
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('staff:update', (_e, id: number, staff: { name?: string; role_id?: number; phone?: string }) => {
    try {
      if (!hasPermission('manage_staff')) return fail('Insufficient permissions to manage staff');
      const db = getDatabase();
      const fields: string[] = [];
      const values: any[] = [];
      if (staff.name !== undefined) { fields.push('name = ?'); values.push(staff.name); }
      if (staff.role_id !== undefined) { fields.push('role_id = ?'); values.push(staff.role_id); }
      if (staff.phone !== undefined) { fields.push('phone = ?'); values.push(staff.phone); }
      if (fields.length === 0) return fail('No fields to update');
      values.push(id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('staff:update-pin', (_e, id: number, newPin: string) => {
    try {
      if (!hasPermission('manage_staff')) return fail('Insufficient permissions to manage staff');
      const db = getDatabase();
      const bcrypt = require('bcryptjs');
      const hashedPin = bcrypt.hashSync(newPin, 10);
      db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(hashedPin, id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('staff:delete', (_e, id: number) => {
    try {
      if (!hasPermission('manage_staff')) return fail('Insufficient permissions to manage staff');
      const db = getDatabase();
      db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── ROLES & PERMISSIONS ──────────────────────────────────────────────

  ipcMain.handle('roles:list', () => {
    try {
      const db = getDatabase();
      const roles = db.prepare('SELECT * FROM roles ORDER BY id').all();
      const result = (roles as Array<{ id: number; name: string; is_system: number }>).map((role) => {
        const permissions = db.prepare(`
          SELECT p.id, p.key, p.label, p.category, rp.allowed
          FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ?
          ORDER BY p.category, p.key
        `).all(role.id);
        return { ...role, permissions };
      });
      return ok(result);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('roles:create', (_e, name: string) => {
    try {
      if (!hasPermission('manage_roles')) return fail('Insufficient permissions to manage roles');
      const db = getDatabase();
      const result = db.prepare('INSERT INTO roles (name, is_system) VALUES (?, 0)').run(name);
      const roleId = result.lastInsertRowid;
      const perms = db.prepare('SELECT id FROM permissions').all() as Array<{ id: number }>;
      const insertPerm = db.prepare('INSERT INTO role_permissions (role_id, permission_id, allowed) VALUES (?, ?, 0)');
      for (const p of perms) {
        insertPerm.run(roleId, p.id);
      }
      return ok({ id: roleId });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('roles:update', (_e, id: number, name: string) => {
    try {
      if (!hasPermission('manage_roles')) return fail('Insufficient permissions to manage roles');
      const db = getDatabase();
      const role = db.prepare('SELECT is_system FROM roles WHERE id = ?').get(id) as { is_system: number } | undefined;
      if (role?.is_system) return fail('Cannot rename a system role');
      db.prepare('UPDATE roles SET name = ? WHERE id = ?').run(name, id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('roles:delete', (_e, id: number) => {
    try {
      if (!hasPermission('manage_roles')) return fail('Insufficient permissions to manage roles');
      const db = getDatabase();
      const role = db.prepare('SELECT is_system FROM roles WHERE id = ?').get(id) as { is_system: number } | undefined;
      if (role?.is_system) return fail('Cannot delete a system role');
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
      db.prepare('DELETE FROM roles WHERE id = ?').run(id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('roles:update-permissions', (_e, roleId: number, permissions: Array<{ permission_id: number; allowed: number }>) => {
    try {
      if (!hasPermission('manage_roles')) return fail('Insufficient permissions to manage roles');
      const db = getDatabase();
      const upsert = db.prepare(
        'INSERT INTO role_permissions (role_id, permission_id, allowed) VALUES (?, ?, ?) ON CONFLICT(role_id, permission_id) DO UPDATE SET allowed = excluded.allowed'
      );
      db.transaction(() => {
        for (const perm of permissions) {
          upsert.run(roleId, perm.permission_id, perm.allowed);
        }
      })();
      return ok({ roleId });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('permissions:list', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM permissions ORDER BY category, key').all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('staff:get-overrides', (_e, userId: number) => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT upo.permission_id, p.key, p.label, upo.allowed
        FROM user_permission_overrides upo
        JOIN permissions p ON p.id = upo.permission_id
        WHERE upo.user_id = ?
      `).all(userId);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('staff:set-overrides', (_e, userId: number, overrides: Array<{ permission_id: number; allowed: number }>) => {
    try {
      if (!hasPermission('manage_roles')) return fail('Insufficient permissions to manage permissions');
      const db = getDatabase();
      db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(userId);
      const insert = db.prepare('INSERT INTO user_permission_overrides (user_id, permission_id, allowed) VALUES (?, ?, ?)');
      db.transaction(() => {
        for (const o of overrides) {
          insert.run(userId, o.permission_id, o.allowed);
        }
      })();
      return ok({ userId });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── AUDIT LOG ────────────────────────────────────────────────────────

  ipcMain.handle('audit:list', (_e, filters?: { action?: string; entity?: string; limit?: number }) => {
    try {
      const db = getDatabase();
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (filters?.action) { where += ' AND al.action = ?'; params.push(filters.action); }
      if (filters?.entity) { where += ' AND al.entity = ?'; params.push(filters.entity); }
      const limit = filters?.limit ?? 200;
      const rows = db.prepare(`
        SELECT al.*, u.name AS user_name
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.user_id
        ${where}
        ORDER BY al.timestamp DESC
        LIMIT ?
      `).all(...params, limit);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── REPORTS ──────────────────────────────────────────────────────────

  ipcMain.handle('reports:sales-summary', (_e, dateFrom: string, dateTo: string) => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const row = db.prepare(`
        SELECT
          COALESCE(SUM(b.total), 0) AS total_sales,
          COUNT(b.id) AS order_count,
          CASE WHEN COUNT(b.id) > 0 THEN COALESCE(SUM(b.total), 0) / COUNT(b.id) ELSE 0 END AS average_order_value
        FROM bills b
        WHERE b.created_at >= ? AND b.created_at <= ? || ' 23:59:59'
        ${isViewAll() ? '' : 'AND b.cashier_id = ?'}
      `).get(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, getCurrentSession()?.userId ?? 0]));
      return ok(row);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:daily-sales', (_e, dateFrom: string, dateTo: string) => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT DATE(created_at) AS date, SUM(total) AS total_sales, COUNT(*) AS order_count
        FROM bills
        WHERE created_at >= ? AND created_at <= ? || ' 23:59:59'
        ${isViewAll() ? '' : 'AND cashier_id = ?'}
        GROUP BY DATE(created_at)
        ORDER BY date
      `).all(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, getCurrentSession()?.userId ?? 0]));
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:top-items', (_e, dateFrom: string, dateTo: string, limit?: number) => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT mi.name, SUM(oi.qty) AS total_qty, SUM(oi.qty * oi.price) AS total_revenue
        FROM order_items oi
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        JOIN orders o ON o.id = oi.order_id
        JOIN bills b ON b.order_id = o.id
        WHERE o.status != 'cancelled'
          AND b.created_at >= ? AND b.created_at <= ? || ' 23:59:59'
          ${isViewAll() ? '' : 'AND o.created_by = ?'}
        GROUP BY mi.id
        ORDER BY total_qty DESC
        LIMIT ?
      `).all(...(isViewAll() ? [dateFrom, dateTo, limit ?? 10] : [dateFrom, dateTo, getCurrentSession()?.userId ?? 0, limit ?? 10]));
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('sales:retail-consolidated', (_e, dateFrom: string, dateTo: string) => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const scope = isViewAll() ? [] : [getCurrentSession()?.userId ?? 0];

      const products = db.prepare(`
        SELECT mi.name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price - COALESCE(oi.discount, 0)) AS amount
        FROM order_items oi
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        JOIN orders o ON o.id = oi.order_id
        JOIN bills b ON b.order_id = o.id
        WHERE o.sale_type = 'retail' AND o.status = 'billed'
          AND b.created_at >= ? AND b.created_at <= ? || ' 23:59:59'
          ${isViewAll() ? '' : 'AND o.created_by = ?'}
        GROUP BY mi.id
        ORDER BY qty DESC
      `).all(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, ...scope]));

      const summary = db.prepare(`
        SELECT COUNT(b.id) AS sales_count,
               COALESCE(SUM(b.subtotal), 0) AS subtotal,
               COALESCE(SUM(b.discount_amount), 0) AS discount_amount,
               COALESCE(SUM(b.total), 0) AS total
        FROM bills b
        JOIN orders o ON o.id = b.order_id
        WHERE o.sale_type = 'retail' AND o.status = 'billed'
          AND b.created_at >= ? AND b.created_at <= ? || ' 23:59:59'
          ${isViewAll() ? '' : 'AND o.created_by = ?'}
      `).get(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, ...scope]));

      const payment_split = db.prepare(`
        SELECT b.payment_method AS method, COUNT(b.id) AS count, COALESCE(SUM(b.total), 0) AS amount
        FROM bills b
        JOIN orders o ON o.id = b.order_id
        WHERE o.sale_type = 'retail' AND o.status = 'billed'
          AND b.created_at >= ? AND b.created_at <= ? || ' 23:59:59'
          ${isViewAll() ? '' : 'AND o.created_by = ?'}
        GROUP BY b.payment_method
        ORDER BY amount DESC
      `).all(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, ...scope]));

      return ok({ products, summary, payment_split });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:supplier-payables', () => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT s.id, s.name,
          COALESCE(p.total_purchases, 0) - COALESCE(r.total_returns, 0) - COALESCE(pay.total_payments, 0) AS balance,
          CASE WHEN julianday('now') - julianday(latest.purchase_date) <= 30
            THEN COALESCE(p.total_purchases, 0) - COALESCE(r.total_returns, 0) - COALESCE(pay.total_payments, 0) ELSE 0 END AS current_amount,
          CASE WHEN julianday('now') - julianday(latest.purchase_date) > 30 AND julianday('now') - julianday(latest.purchase_date) <= 60
            THEN COALESCE(p.total_purchases, 0) - COALESCE(r.total_returns, 0) - COALESCE(pay.total_payments, 0) ELSE 0 END AS days_30,
          CASE WHEN julianday('now') - julianday(latest.purchase_date) > 60 AND julianday('now') - julianday(latest.purchase_date) <= 90
            THEN COALESCE(p.total_purchases, 0) - COALESCE(r.total_returns, 0) - COALESCE(pay.total_payments, 0) ELSE 0 END AS days_60,
          CASE WHEN julianday('now') - julianday(latest.purchase_date) > 90
            THEN COALESCE(p.total_purchases, 0) - COALESCE(r.total_returns, 0) - COALESCE(pay.total_payments, 0) ELSE 0 END AS days_90
        FROM suppliers s
        LEFT JOIN (SELECT supplier_id, SUM(total_amount) AS total_purchases FROM purchases GROUP BY supplier_id) p ON p.supplier_id = s.id
        LEFT JOIN (SELECT supplier_id, SUM(returned_amount) AS total_returns FROM purchases GROUP BY supplier_id) r ON r.supplier_id = s.id
        LEFT JOIN (SELECT supplier_id, SUM(amount) AS total_payments FROM supplier_payments GROUP BY supplier_id) pay ON pay.supplier_id = s.id
        LEFT JOIN (SELECT supplier_id, MAX(purchase_date) AS purchase_date FROM purchases GROUP BY supplier_id) latest ON latest.supplier_id = s.id
        WHERE s.active = 1 AND (COALESCE(p.total_purchases, 0) - COALESCE(r.total_returns, 0) - COALESCE(pay.total_payments, 0)) > 0
        ORDER BY balance DESC
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:customer-receivables', () => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT c.id, c.name, c.phone,
          COALESCE(cred.total_credit, 0) - COALESCE(pay.total_payment, 0) AS balance,
          CASE WHEN julianday('now') - julianday(latest.entry_date) <= 30
            THEN COALESCE(cred.total_credit, 0) - COALESCE(pay.total_payment, 0) ELSE 0 END AS current_amount,
          CASE WHEN julianday('now') - julianday(latest.entry_date) > 30 AND julianday('now') - julianday(latest.entry_date) <= 60
            THEN COALESCE(cred.total_credit, 0) - COALESCE(pay.total_payment, 0) ELSE 0 END AS days_30,
          CASE WHEN julianday('now') - julianday(latest.entry_date) > 60 AND julianday('now') - julianday(latest.entry_date) <= 90
            THEN COALESCE(cred.total_credit, 0) - COALESCE(pay.total_payment, 0) ELSE 0 END AS days_60,
          CASE WHEN julianday('now') - julianday(latest.entry_date) > 90
            THEN COALESCE(cred.total_credit, 0) - COALESCE(pay.total_payment, 0) ELSE 0 END AS days_90
        FROM customers c
        LEFT JOIN (SELECT customer_id, SUM(amount) AS total_credit FROM customer_ledger WHERE type = 'credit' GROUP BY customer_id) cred ON cred.customer_id = c.id
        LEFT JOIN (SELECT customer_id, SUM(amount) AS total_payment FROM customer_ledger WHERE type = 'payment' GROUP BY customer_id) pay ON pay.customer_id = c.id
        LEFT JOIN (SELECT customer_id, MAX(entry_date) AS entry_date FROM customer_ledger GROUP BY customer_id) latest ON latest.customer_id = c.id
        WHERE c.active = 1 AND (COALESCE(cred.total_credit, 0) - COALESCE(pay.total_payment, 0)) > 0
        ORDER BY balance DESC
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:expense-summary', (_e, dateFrom: string, dateTo: string) => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT ec.name AS category, SUM(e.amount) AS total_expenses
        FROM expenses e
        JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.expense_date >= ? AND e.expense_date <= ?
        GROUP BY ec.id
        ORDER BY total_expenses DESC
      `).all(dateFrom, dateTo);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:profit-loss', (_e, dateFrom: string, dateTo: string) => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const sales = db.prepare(`
        SELECT COALESCE(SUM(total), 0) AS revenue FROM bills WHERE created_at >= ? AND created_at <= ? || ' 23:59:59'
        ${isViewAll() ? '' : 'AND cashier_id = ?'}
      `).get(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, getCurrentSession()?.userId ?? 0])) as { revenue: number };

      const cogsFromMenu = db.prepare(`
        SELECT COALESCE(SUM(oi.qty * COALESCE(mi.cost_price, 0)), 0) AS cogs
        FROM order_items oi
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        JOIN orders o ON o.id = oi.order_id
        JOIN bills b ON b.order_id = o.id
        WHERE b.created_at >= ? AND b.created_at <= ? || ' 23:59:59'
          ${isViewAll() ? '' : 'AND o.created_by = ?'}
      `).get(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, getCurrentSession()?.userId ?? 0])) as { cogs: number };

      const expenses = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM expenses WHERE expense_date >= ? AND expense_date <= ?
        ${isViewAll() ? '' : 'AND paid_by = ?'}
      `).get(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, getCurrentSession()?.userId ?? 0])) as { total_expenses: number };

      const cogs = cogsFromMenu.cogs;
      return ok({
        revenue: sales.revenue,
        cogs,
        expenses: expenses.total_expenses,
        gross_profit: sales.revenue - cogs,
        net_profit: sales.revenue - cogs - expenses.total_expenses,
      });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:today', () => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const sales = db.prepare(`
        SELECT COALESCE(SUM(total), 0) AS total_sales, COUNT(*) AS order_count
        FROM bills WHERE DATE(created_at) = DATE('now', 'localtime')
        ${isViewAll() ? '' : 'AND cashier_id = ?'}
      `).get(...(isViewAll() ? [] : [getCurrentSession()?.userId ?? 0])) as { total_sales: number; order_count: number };

      return ok({
        total_sales: sales.total_sales,
        order_count: sales.order_count,
      });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── DASHBOARD ────────────────────────────────────────────────────────

  ipcMain.handle('dashboard:activity', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT al.*, u.name AS user_name
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.user_id
        ${isViewAll() ? '' : 'WHERE al.user_id = ?'}
        ORDER BY al.timestamp DESC
        LIMIT 20
      `).all(...(isViewAll() ? [] : [getCurrentSession()?.userId ?? 0]));
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('dashboard:daily-sales', (_e, dateFrom: string, dateTo: string) => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT DATE(created_at) AS date, SUM(total) AS total_sales, COUNT(*) AS order_count
        FROM bills
        WHERE created_at >= ? AND created_at <= ? || ' 23:59:59'
        ${isViewAll() ? '' : 'AND cashier_id = ?'}
        GROUP BY DATE(created_at)
        ORDER BY date
      `).all(...(isViewAll() ? [dateFrom, dateTo] : [dateFrom, dateTo, getCurrentSession()?.userId ?? 0]));
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('dashboard:kpi', () => {
    try {
      const db = getDatabase();
      const viewAll = isViewAll();
      const userId = getCurrentSession()?.userId ?? 0;

      const sales = db.prepare(`
        SELECT COALESCE(SUM(total), 0) AS today_sales, COUNT(*) AS today_orders
        FROM bills WHERE DATE(created_at) = DATE('now', 'localtime')
        ${viewAll ? '' : 'AND cashier_id = ?'}
      `).get(...(viewAll ? [] : [userId])) as { today_sales: number; today_orders: number };

      const yesterday = db.prepare(`
        SELECT COALESCE(SUM(total), 0) AS yesterday_sales, COUNT(*) AS yesterday_orders
        FROM bills WHERE DATE(created_at) = DATE('now', 'localtime', '-1 day')
        ${viewAll ? '' : 'AND cashier_id = ?'}
      `).get(...(viewAll ? [] : [userId])) as { yesterday_sales: number; yesterday_orders: number };

      const payables = viewAll
        ? db.prepare(`
          SELECT COALESCE(SUM(
            COALESCE(p.total_amount, 0) - COALESCE(pay.total_payments, 0)
          ), 0) AS total_payables
          FROM (
            SELECT s.id, s.name,
              COALESCE(pu.total_amount, 0) AS total_amount
            FROM suppliers s
            LEFT JOIN (SELECT supplier_id, SUM(total_amount) AS total_amount FROM purchases GROUP BY supplier_id) pu ON pu.supplier_id = s.id
            WHERE s.active = 1
          ) p
          LEFT JOIN (SELECT supplier_id, SUM(amount) AS total_payments FROM supplier_payments GROUP BY supplier_id) pay ON pay.supplier_id = p.id
        `).get() as { total_payables: number }
        : { total_payables: 0 };

      const receivables = viewAll
        ? db.prepare(`
          SELECT COALESCE(SUM(balance), 0) AS total_receivables
          FROM (
            SELECT c.id,
              COALESCE(cred.total_credit, 0) - COALESCE(pay.total_payment, 0) AS balance
            FROM customers c
            LEFT JOIN (SELECT customer_id, SUM(amount) AS total_credit FROM customer_ledger WHERE type = 'credit' GROUP BY customer_id) cred ON cred.customer_id = c.id
            LEFT JOIN (SELECT customer_id, SUM(amount) AS total_payment FROM customer_ledger WHERE type = 'payment' GROUP BY customer_id) pay ON pay.customer_id = c.id
            WHERE c.active = 1
          )
        `).get() as { total_receivables: number }
        : { total_receivables: 0 };

      const salesTrend = yesterday.yesterday_sales > 0
        ? Math.round(((sales.today_sales - yesterday.yesterday_sales) / yesterday.yesterday_sales) * 100)
        : sales.today_sales > 0 ? 100 : 0;

      const orderTrend = yesterday.yesterday_orders > 0
        ? Math.round(((sales.today_orders - yesterday.yesterday_orders) / yesterday.yesterday_orders) * 100)
        : sales.today_orders > 0 ? 100 : 0;

      return ok({
        todaySales: sales.today_sales,
        orderCount: sales.today_orders,
        totalPayables: payables.total_payables,
        totalReceivables: receivables.total_receivables,
        salesTrend,
        orderTrend,
      });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('dashboard:hourly-sales', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour,
               COALESCE(SUM(total), 0) AS sales,
               COUNT(*) AS order_count
        FROM bills
        WHERE DATE(created_at) = DATE('now', 'localtime')
          ${isViewAll() ? '' : 'AND cashier_id = ?'}
        GROUP BY hour ORDER BY hour
      `).all(...(isViewAll() ? [] : [getCurrentSession()?.userId ?? 0]));
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── APP SETTINGS / BUSINESS PROFILE ──────────────────────────────────

  ipcMain.handle('prefs:get', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT key, value FROM app_preferences').all() as Array<{ key: string; value: string }>;
      const prefs: Record<string, string> = {};
      for (const r of rows) prefs[r.key] = r.value;
      return ok(prefs);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('prefs:set', (_e, key: string, value: string) => {
    try {
      const db = getDatabase();
      db.prepare(
        'INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(key, String(value ?? ''));
      return ok({ key });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('settings:get', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>;
      const settings: Record<string, string> = {};
      for (const r of rows) settings[r.key] = r.value;
      return ok(settings);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    try {
      if (!hasPermission('manage_settings')) return fail('Insufficient permissions to manage settings');
      const db = getDatabase();
      db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(key, String(value ?? ''));
      return ok({ key });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('settings:update-many', (_e, values: Record<string, string>) => {
    try {
      if (!hasPermission('manage_settings')) return fail('Insufficient permissions to manage settings');
      const db = getDatabase();
      const upsert = db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      const tx = db.transaction((v: Record<string, string>) => {
        for (const [k, val] of Object.entries(v)) upsert.run(k, String(val ?? ''));
      });
      tx(values);
      return ok({ updated: Object.keys(values).length });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── MENU CATEGORIES (CRUD entities) ──────────────────────────────────

  ipcMain.handle('menu:categories:list', () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT mc.*, COUNT(mi.id) AS item_count
        FROM menu_categories mc
        LEFT JOIN menu_items mi ON mi.category = mc.name AND mi.active = 1
        GROUP BY mc.id
        ORDER BY mc.sort_order, mc.name
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:categories:create', (_e, name: string) => {
    try {
      if (!hasPermission('edit_menu')) return fail('Insufficient permissions to edit menu');
      const db = getDatabase();
      const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM menu_categories').get() as { n: number };
      db.prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)').run(name.trim(), max.n);
      return ok({});
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:categories:sync', () => {
    try {
      const db = getDatabase();
      const distinct = db.prepare(
        "SELECT DISTINCT category FROM menu_items WHERE category IS NOT NULL AND category <> ''"
      ).all() as Array<{ category: string }>;
      let added = 0;
      for (const row of distinct) {
        const existing = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(row.category);
        if (!existing) {
          const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM menu_categories').get() as { n: number };
          db.prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)').run(row.category, max.n);
          added++;
        }
      }
      return ok({ added });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:categories:update', (_e, id: number, data: { name?: string; sort_order?: number; active?: number }) => {
    try {
      const db = getDatabase();
      const fields: string[] = [];
      const values: any[] = [];
      if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
      if (data.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(data.sort_order); }
      if (data.active !== undefined) { fields.push('active = ?'); values.push(data.active); }
      if (fields.length === 0) return fail('No fields to update');
      values.push(id);
      db.prepare(`UPDATE menu_categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:categories:delete', (_e, id: number) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM menu_categories WHERE id = ?').run(id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:reorder', (_e, ordered: Array<{ id: number; sort_order: number }>) => {
    try {
      if (!hasPermission('edit_menu')) return fail('Insufficient permissions to edit menu');
      const db = getDatabase();
      const upd = db.prepare('UPDATE menu_items SET sort_order = ? WHERE id = ?');
      const tx = db.transaction((items: Array<{ id: number; sort_order: number }>) => {
        for (const it of items) upd.run(it.sort_order, it.id);
      });
      tx(ordered);
      return ok({ updated: ordered.length });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── MENU ITEM VARIANTS ───────────────────────────────────────────────

  ipcMain.handle('menu:item-variants:list', (_e, menuItemId: number) => {
    try {
      const db = getDatabase();
      const rows = db.prepare(
        'SELECT * FROM menu_item_variants WHERE menu_item_id = ? ORDER BY sort_order'
      ).all(menuItemId);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:item-variants:save', (_e, menuItemId: number, variants: Array<{ name: string; price: number }>) => {
    try {
      const db = getDatabase();
      const del = db.prepare('DELETE FROM menu_item_variants WHERE menu_item_id = ?');
      const ins = db.prepare('INSERT INTO menu_item_variants (menu_item_id, name, price, sort_order) VALUES (?, ?, ?, ?)');
      const tx = db.transaction((menuItemIdN: number, vs: Array<{ name: string; price: number }>) => {
        del.run(menuItemIdN);
        vs.forEach((v, i) => ins.run(menuItemIdN, v.name, v.price, i));
      });
      tx(menuItemId, variants);
      return ok({ count: variants.length });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── MODIFIER GROUPS ──────────────────────────────────────────────────

  ipcMain.handle('modifier-groups:list', () => {
    try {
      const db = getDatabase();
      const groups = db.prepare('SELECT * FROM modifier_groups ORDER BY id').all() as Array<Record<string, any>>;
      const opts = db.prepare('SELECT * FROM modifier_options').all() as Array<{ group_id: number; name: string; price: number }>;
      const byGroup: Record<number, any[]> = {};
      for (const o of opts) (byGroup[o.group_id] = byGroup[o.group_id] || []).push(o);
      return ok(groups.map((g) => ({ ...g, options: byGroup[g.id] || [] })));
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('modifier-groups:save', (_e, data: {
    id?: number; name: string; min_select: number; max_select: number; required: number;
    options: Array<{ name: string; price: number }>;
  }) => {
    try {
      const db = getDatabase();
      let groupId: number;
      if (data.id) {
        db.prepare('UPDATE modifier_groups SET name = ?, min_select = ?, max_select = ?, required = ? WHERE id = ?')
          .run(data.name, data.min_select, data.max_select, data.required, data.id);
        groupId = data.id;
        db.prepare('DELETE FROM modifier_options WHERE group_id = ?').run(groupId);
      } else {
        const r = db.prepare('INSERT INTO modifier_groups (name, min_select, max_select, required) VALUES (?, ?, ?, ?)')
          .run(data.name, data.min_select, data.max_select, data.required);
        groupId = Number(r.lastInsertRowid);
      }
      const ins = db.prepare('INSERT INTO modifier_options (group_id, name, price) VALUES (?, ?, ?)');
      for (const o of data.options) ins.run(groupId, o.name, o.price);
      return ok({ id: groupId });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('modifier-groups:delete', (_e, id: number) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM modifier_groups WHERE id = ?').run(id);
      return ok({ id });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:item-modifiers:set', (_e, menuItemId: number, groupIds: number[]) => {
    try {
      const db = getDatabase();
      const del = db.prepare('DELETE FROM menu_item_modifiers WHERE menu_item_id = ?');
      const ins = db.prepare('INSERT OR IGNORE INTO menu_item_modifiers (menu_item_id, group_id) VALUES (?, ?)');
      const tx = db.transaction((mid: number, ids: number[]) => {
        del.run(mid);
        for (const gid of ids) ins.run(mid, gid);
      });
      tx(menuItemId, groupIds);
      return ok({ count: groupIds.length });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:item-ingredients:save', (_e, menuItemId: number, ingredients: Array<{ item_name: string; quantity: number; unit: string }>) => {
    try {
      const db = getDatabase();
      const del = db.prepare('DELETE FROM menu_item_ingredients WHERE menu_item_id = ?');
      const ins = db.prepare('INSERT INTO menu_item_ingredients (menu_item_id, item_name, quantity, unit) VALUES (?, ?, ?, ?)');
      const tx = db.transaction((mid: number, ing: Array<{ item_name: string; quantity: number; unit: string }>) => {
        del.run(mid);
        for (const i of ing) ins.run(mid, i.item_name, i.quantity, i.unit);
      });
      tx(menuItemId, ingredients);
      return ok({ count: ingredients.length });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:item-ingredients:list', (_e, menuItemId: number) => {
    try {
      const db = getDatabase();
      const rows = db.prepare(
        'SELECT * FROM menu_item_ingredients WHERE menu_item_id = ?'
      ).all(menuItemId);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('menu:item-modifiers:get', (_e, menuItemId: number) => {
    try {
      const db = getDatabase();
      const rows = db.prepare(
        'SELECT group_id AS id FROM menu_item_modifiers WHERE menu_item_id = ?'
      ).all(menuItemId);
      return ok(rows.map((r: any) => r.id));
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── STOCK: adjustment, reorder, valuation ────────────────────────────

  ipcMain.handle('stock:adjust', (_e, entry: {
    item_name: string; menu_item_id?: number; quantity: number; unit: string; source: string;
    direction?: 'in' | 'out'; received_date: string; notes?: string; created_by: number;
  }) => {
    try {
      if (!hasPermission('add_stock_entries')) return fail('Insufficient permissions to adjust stock');
      const db = getDatabase();
      const qty = Math.abs(Number(entry.quantity) || 0);
      if (qty <= 0) return fail('Adjustment quantity must be greater than zero');
      let menuItemId: number | null = entry.menu_item_id ?? null;
      if (menuItemId === null) {
        const match = db.prepare('SELECT id FROM menu_items WHERE name = ? AND active = 1').get(entry.item_name) as { id: number } | undefined;
        if (match) menuItemId = match.id;
      }
      if (menuItemId === null) {
        throw new Error(`"${entry.item_name}" is not in the catalog — it must be added as a product before stock adjustments can be recorded for it.`);
      }
      // Direction decides the sign. Fall back to the reason when the caller
      // does not send an explicit direction (older clients sent source only).
      const OUT_REASONS = ['waste', 'damage', 'theft', 'lost', 'expiry', 'correction_out'];
      const direction: 'in' | 'out' = entry.direction ?? (OUT_REASONS.includes(entry.source) ? 'out' : 'in');
      const signedQty = direction === 'out' ? -qty : qty;
      const result = insertStockEntry(db, {
        menu_item_id: menuItemId,
        item_name: entry.item_name,
        quantity: signedQty,
        unit: entry.unit,
        received_date: entry.received_date,
        source: entry.source || (direction === 'out' ? 'waste' : 'adjust'),
        notes: entry.notes ?? null,
        created_by: entry.created_by,
      });
      writeAudit(db, 'Adjust', 'Stock', Number(result.lastInsertRowid), `${entry.item_name} ${direction === 'out' ? '−' : '+'}${qty} ${entry.unit} (${entry.source})`, entry.created_by);
      return ok({ id: result.lastInsertRowid });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:stock-valuation', () => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT
          COALESCE(mi.name, se.item_name) AS item,
          COALESCE(mi.unit, se.unit) AS unit,
          mi.id AS menu_item_id,
          SUM(se.quantity) AS on_hand,
          COALESCE(c.unit_cost, 0) AS unit_cost,
          ROUND(SUM(se.quantity) * COALESCE(c.unit_cost, 0), 2) AS value
        FROM stock_entries se
        LEFT JOIN menu_items mi ON mi.id = se.menu_item_id
        LEFT JOIN (
          SELECT pi.menu_item_id, pi.item_name, pi.unit, pi.rate AS unit_cost
          FROM purchase_items pi
          INNER JOIN purchases p ON p.id = pi.purchase_id
          WHERE pi.id = (
            SELECT MAX(pi2.id) FROM purchase_items pi2 WHERE pi2.menu_item_id = pi.menu_item_id
          )
        ) c ON c.menu_item_id IS NOT NULL AND c.menu_item_id = se.menu_item_id
        GROUP BY mi.id, se.item_name, se.unit
        ORDER BY COALESCE(mi.name, se.item_name)
      `).all();
      const totalValue = rows.reduce((sum: number, r: any) => sum + (Number(r.value) || 0), 0);
      return ok({ items: rows, totalValue });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('reports:low-stock', () => {
    try {
      if (!hasPermission('view_reports')) return fail('Insufficient permissions to view reports');
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT COALESCE(mi.name, se.item_name) AS item_name,
          COALESCE(mi.unit, se.unit) AS unit,
          mi.category,
          SUM(se.quantity) AS current_stock,
          COALESCE((
            SELECT sr.reorder_level FROM stock_reorder sr
            WHERE sr.menu_item_id = mi.id
               OR (sr.menu_item_id IS NULL AND sr.item_name = COALESCE(mi.name, se.item_name) AND sr.unit = COALESCE(mi.unit, se.unit))
            ORDER BY (sr.menu_item_id IS NULL) ASC
            LIMIT 1
          ), 0) AS reorder_level,
          MAX(se.received_date) AS last_received
        FROM stock_entries se
        LEFT JOIN menu_items mi ON mi.id = se.menu_item_id
        GROUP BY mi.id, se.item_name, se.unit
        HAVING SUM(se.quantity) < COALESCE((
            SELECT sr.reorder_level FROM stock_reorder sr
            WHERE sr.menu_item_id = mi.id
               OR (sr.menu_item_id IS NULL AND sr.item_name = COALESCE(mi.name, se.item_name) AND sr.unit = COALESCE(mi.unit, se.unit))
            ORDER BY (sr.menu_item_id IS NULL) ASC
            LIMIT 1
          ), 1)
        ORDER BY current_stock ASC
      `).all();
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });

  // ─── STAFF: toggle active ────────────────────────────────────────────

  ipcMain.handle('staff:toggle-active', (_e, id: number) => {
    try {
      if (!hasPermission('manage_staff')) return fail('Insufficient permissions to manage staff');
      const db = getDatabase();
      const row = db.prepare('SELECT active FROM users WHERE id = ?').get(id) as { active: number } | undefined;
      if (!row) return fail('User not found');
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(row.active ? 0 : 1, id);
      writeAudit(db, row.active ? 'Deactivate' : 'Activate', 'Staff', id);
      return ok({ id, active: row.active ? 0 : 1 });
    } catch (err: any) {
      return fail(err.message);
    }
  });

  ipcMain.handle('staff:get-activity', (_e, userId: number) => {
    try {
      if (!hasPermission('manage_staff')) return fail('Insufficient permissions to manage staff');
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT al.*, u.name AS user_name
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.user_id = ?
        ORDER BY al.timestamp DESC
        LIMIT 100
      `).all(userId);
      return ok(rows);
    } catch (err: any) {
      return fail(err.message);
    }
  });
}
