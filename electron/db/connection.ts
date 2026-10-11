import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

let db: Database.Database | null = null;
let dbPath: string | null = null;

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function getDatabasePath(): string {
  if (!dbPath) throw new Error('Database not initialized');
  return dbPath;
}

export function initDatabase(customPath?: string): Database.Database {
  dbPath = customPath || path.join(app.getPath('userData'), 'sheikh-ahmed-mobile.db');
  seedFromBundle(dbPath, customPath === undefined);
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  seedDefaults(db);
  migrateSchema(db);

  return db;
}

// On a fresh production install, make the app match the data Snapshot bundled
// into the installer. If the local DB is missing, it is created from the bundle.
// If the local DB is stale (its data version differs from the zipped one), it is
// permanently replaced with the bundled snapshot so every installed build mirrors
// the machine that produced it. Skipped for tests (customPath).
function seedFromBundle(targetPath: string, useBundle: boolean) {
  if (!useBundle) return;

  let bundledPath: string | null = null;
  try {
    if (process.resourcesPath) {
      const candidate = path.join(process.resourcesPath, 'db', 'sheikh-ahmed-mobile.db');
      if (fs.existsSync(candidate)) bundledPath = candidate;
    }
  } catch {
    bundledPath = null;
  }
  if (!bundledPath) return;

  if (!fs.existsSync(targetPath)) {
    copyBundled(targetPath, bundledPath);
    return;
  }

  const bundledVersion = readDataVersion(bundledPath);
  if (bundledVersion === null) return;

  const localVersion = readDataVersion(targetPath);
  if (localVersion !== bundledVersion) {
    copyBundled(targetPath, bundledPath);
  }
}

function readDataVersion(dbFile: string): string | null {
  try {
    const probe = new Database(dbFile, { readonly: true });
    try {
      const row = probe.prepare('SELECT value FROM app_settings WHERE key = ?').get('bundled_data_version') as
        | { value: string }
        | undefined;
      return row ? row.value : null;
    } finally {
      probe.close();
    }
  } catch {
    return null;
  }
}

function copyBundled(targetPath: string, bundledPath: string) {
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(targetPath + suffix);
      } catch {
        /* ignore if not present */
      }
    }
    fs.copyFileSync(bundledPath, targetPath);
  } catch {
    // If the copy fails, fall through to a fresh seeded DB below.
  }
}

function createTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_system INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      pin TEXT NOT NULL,
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      category TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id),
      permission_id INTEGER NOT NULL REFERENCES permissions(id),
      allowed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS user_permission_overrides (
      user_id INTEGER NOT NULL REFERENCES users(id),
      permission_id INTEGER NOT NULL REFERENCES permissions(id),
      allowed INTEGER NOT NULL,
      PRIMARY KEY (user_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      wholesale_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      brand TEXT,
      model TEXT,
      sku TEXT,
      unit TEXT NOT NULL DEFAULT 'pcs',
      image_url TEXT,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      shortcut TEXT,
      supplier_id INTEGER REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_type TEXT NOT NULL DEFAULT 'retail',
      status TEXT NOT NULL DEFAULT 'open',
      customer_id INTEGER REFERENCES customers(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      qty INTEGER NOT NULL DEFAULT 1,
      price REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      cashier_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier_id INTEGER NOT NULL REFERENCES users(id),
      opened_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      closed_at TEXT,
      opening_cash REAL NOT NULL DEFAULT 0,
      closing_cash REAL,
      expected_cash REAL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS shift_denominations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('note', 'coin')),
      denomination REAL NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      counted_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_phone TEXT,
      address TEXT,
      email TEXT,
      gstin TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      invoice_no TEXT,
      purchase_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      -- gross_amount = sum of line amounts (qty × rate). total_amount is the
      -- NET payable to the supplier: gross_amount − discount_amount.
      gross_amount REAL NOT NULL DEFAULT 0,
      discount_type TEXT NOT NULL DEFAULT 'amount',
      discount_value REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      returned_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      menu_item_id INTEGER REFERENCES menu_items(id),
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      rate REAL NOT NULL,
      amount REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      purchase_id INTEGER REFERENCES purchases(id),
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      method TEXT NOT NULL DEFAULT 'cash',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER REFERENCES menu_items(id),
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      received_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      supplier_id INTEGER REFERENCES suppliers(id),
      purchase_id INTEGER REFERENCES purchases(id),
      order_id INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      email TEXT,
      credit_limit REAL NOT NULL DEFAULT 0,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS customer_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_id INTEGER REFERENCES orders(id),
      type TEXT NOT NULL CHECK(type IN ('credit', 'payment')),
      amount REAL NOT NULL,
      entry_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES expense_categories(id),
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      paid_by INTEGER NOT NULL REFERENCES users(id),
      notes TEXT,
      receipt_image TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS app_preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS menu_item_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS modifier_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      min_select INTEGER NOT NULL DEFAULT 0,
      max_select INTEGER NOT NULL DEFAULT 1,
      required INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS modifier_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_item_modifiers (
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (menu_item_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS menu_item_ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'kg'
    );

    CREATE TABLE IF NOT EXISTS stock_reorder (
      item_name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'kg',
      reorder_level REAL NOT NULL DEFAULT 0,
      menu_item_id INTEGER REFERENCES menu_items(id),
      PRIMARY KEY (item_name, unit)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_reorder_menu_item
      ON stock_reorder(menu_item_id) WHERE menu_item_id IS NOT NULL;

    -- Price history snapshots written on every purchase and manual price edit.
    CREATE TABLE IF NOT EXISTS product_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      cost_price REAL NOT NULL DEFAULT 0,
      retail_price REAL NOT NULL DEFAULT 0,
      wholesale_price REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'purchase' CHECK(source IN ('purchase', 'manual', 'auto_create')),
      purchase_id INTEGER REFERENCES purchases(id),
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_prices_menu ON product_prices(menu_item_id, created_at);

    -- Purchase returns (items sent back to the supplier).
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      return_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns(purchase_id);

    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
      purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id),
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      rate REAL NOT NULL,
      amount REAL NOT NULL
    );
  `);
}

function seedDefaults(db: Database.Database) {
  const hasRoles = db.prepare('SELECT COUNT(*) as count FROM roles').get() as { count: number };
  if (hasRoles.count > 0) return;

  const insertRole = db.prepare('INSERT INTO roles (name, is_system) VALUES (?, ?)');
  const ownerRole = insertRole.run('Owner', 1);
  const cashierRole = insertRole.run('Cashier', 0);
  const managerRole = insertRole.run('Manager', 0);
  const salespersonRole = insertRole.run('Salesperson', 0);

  const insertPermission = db.prepare('INSERT INTO permissions (key, label, category) VALUES (?, ?, ?)');
  const permissions = [
    ['create_bill', 'Create Sales', 'Billing'],
    ['apply_discount', 'Apply Discounts', 'Billing'],
    ['void_bill', 'Void/Refund Sales', 'Billing'],
    ['edit_menu', 'Edit Products & Prices', 'Billing'],

    ['manage_suppliers', 'Manage Suppliers', 'Suppliers'],
    ['manage_purchases', 'Manage Purchases', 'Suppliers'],
    ['record_supplier_payments', 'Record Supplier Payments', 'Suppliers'],
    ['add_customers', 'Add Customer Profiles', 'Customers'],
    ['record_customer_credit', 'Record Customer Credit', 'Customers'],
    ['record_customer_payments', 'Record Customer Payments', 'Customers'],
    ['add_stock_entries', 'Add Stock Entries', 'Stock'],
    ['manage_expenses', 'Add/View Expenses', 'Expenses'],
    ['manage_expense_categories', 'Manage Expense Categories', 'Expenses'],
    ['view_reports', 'View Reports/Analytics', 'Reports'],
    ['manage_staff', 'Manage Staff Accounts', 'Staff'],
    ['manage_roles', 'Manage Roles & Permissions', 'Staff'],
    ['view_audit_log', 'View Audit Log', 'Settings'],
    ['manage_settings', 'Manage Settings', 'Settings'],
    ['view_all_data', 'See All Users\' Data (Orders/Bills/Reports)', 'Data Access'],
  ] as const;

  const permIds: Record<string, number> = {};
  for (const [key, label, category] of permissions) {
    const result = insertPermission.run(key, label, category);
    permIds[key] = result.lastInsertRowid as number;
  }

  const insertRolePerm = db.prepare('INSERT INTO role_permissions (role_id, permission_id, allowed) VALUES (?, ?, ?)');

  for (const permKey of Object.keys(permIds)) {
    insertRolePerm.run(ownerRole.lastInsertRowid, permIds[permKey], 1);
  }

  const cashierPermissions = {
    create_bill: 1, apply_discount: 0, void_bill: 0, edit_menu: 0,
    manage_suppliers: 0, manage_purchases: 0,
    record_supplier_payments: 0, add_customers: 1, record_customer_credit: 0,
    record_customer_payments: 0, add_stock_entries: 1, manage_expenses: 0,
    manage_expense_categories: 0, view_reports: 0,
    manage_staff: 0, manage_roles: 0, view_audit_log: 0, manage_settings: 0,
    view_all_data: 0,
  };
  for (const [key, allowed] of Object.entries(cashierPermissions)) {
    insertRolePerm.run(cashierRole.lastInsertRowid, permIds[key], allowed);
  }

  const managerPermissions = {
    ...cashierPermissions,
    apply_discount: 1, void_bill: 1, edit_menu: 1,
    manage_suppliers: 1, manage_purchases: 1, record_supplier_payments: 1,
    record_customer_credit: 1, record_customer_payments: 1,
    manage_expenses: 1, view_reports: 1,
    manage_staff: 0, manage_roles: 0, view_audit_log: 1,
  };
  for (const [key, allowed] of Object.entries(managerPermissions)) {
    insertRolePerm.run(managerRole.lastInsertRowid, permIds[key], allowed);
  }

  const salespersonPermissions = { ...cashierPermissions, create_bill: 1, add_customers: 0, add_stock_entries: 0 };
  for (const [key, allowed] of Object.entries(salespersonPermissions)) {
    insertRolePerm.run(salespersonRole.lastInsertRowid, permIds[key], allowed);
  }

  const bcrypt = require('bcryptjs');
  const hashedPin = bcrypt.hashSync('123456', 10);
  db.prepare('INSERT INTO users (name, role_id, pin, phone) VALUES (?, ?, ?, ?)').run(
    'Owner', ownerRole.lastInsertRowid, hashedPin, '03000000000'
  );

  const insertCategory = db.prepare('INSERT INTO expense_categories (name) VALUES (?)');
  for (const cat of ['Rent', 'Electricity', 'Salaries', 'Taxes', 'Freight', 'Maintenance', 'Marketing', 'Other']) {
    insertCategory.run(cat);
  }

  const insertSupplier = db.prepare('INSERT INTO suppliers (name, notes, active) VALUES (?, ?, 1)');
  const defaultSuppliers = [
    'Apple Pakistan Distributor',
    'Samsung Pakistan Distributor',
    'Xiaomi Pakistan Distributor',
    'Oppo Pakistan Distributor',
    'Vivo Pakistan Distributor',
    'Tecno Mobile Pakistan',
    'Accessories & Gadgets Wholesale',
  ];
  const supplierIds: Record<string, number> = {};
  for (const s of defaultSuppliers) {
    supplierIds[s] = insertSupplier.run(s, 'Default supplier').lastInsertRowid as number;
  }
  const supplierByBrand: Record<string, string> = {
    Apple: 'Apple Pakistan Distributor',
    Samsung: 'Samsung Pakistan Distributor',
    Xiaomi: 'Xiaomi Pakistan Distributor',
    Oppo: 'Oppo Pakistan Distributor',
    Realme: 'Oppo Pakistan Distributor',
    Vivo: 'Vivo Pakistan Distributor',
    Tecno: 'Tecno Mobile Pakistan',
    Infinix: 'Tecno Mobile Pakistan',
    Itel: 'Tecno Mobile Pakistan',
    Generic: 'Accessories & Gadgets Wholesale',
    SanDisk: 'Accessories & Gadgets Wholesale',
    Anker: 'Accessories & Gadgets Wholesale',
    Huawei: 'Accessories & Gadgets Wholesale',
  };

  const insertProduct = db.prepare(
    'INSERT INTO menu_items (name, category, price, wholesale_price, cost_price, brand, model, unit, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
  );
  const products: Array<[string, string, number, number, number, string, string, string]> = [
    // Mobile Phones
    ['iPhone 16 Pro Max', 'Mobile Phones', 560000, 545000, 530000, 'Apple', '16 Pro Max 256GB', 'pcs'],
    ['iPhone 16', 'Mobile Phones', 425000, 412000, 400000, 'Apple', '16 128GB', 'pcs'],
    ['iPhone 15', 'Mobile Phones', 325000, 315000, 305000, 'Apple', '15 128GB', 'pcs'],
    ['Samsung Galaxy S24 Ultra', 'Mobile Phones', 450000, 438000, 425000, 'Samsung', 'S24 Ultra 256GB', 'pcs'],
    ['Samsung Galaxy A55', 'Mobile Phones', 145000, 140000, 133000, 'Samsung', 'A55 5G 128GB', 'pcs'],
    ['Samsung Galaxy A15', 'Mobile Phones', 62000, 59500, 57000, 'Samsung', 'A15 4G 128GB', 'pcs'],
    ['Redmi Note 13 Pro', 'Mobile Phones', 110000, 106000, 101000, 'Xiaomi', 'Note 13 Pro 8/256', 'pcs'],
    ['Redmi Note 13', 'Mobile Phones', 75000, 72000, 68000, 'Xiaomi', 'Note 13 8/128', 'pcs'],
    ['Redmi 13C', 'Mobile Phones', 56000, 54000, 51500, 'Xiaomi', '13C 4/128', 'pcs'],
    ['Oppo Reno 11 F', 'Mobile Phones', 108000, 104000, 99000, 'Oppo', 'Reno 11 F 8/256', 'pcs'],
    ['Oppo A38', 'Mobile Phones', 52000, 50000, 47500, 'Oppo', 'A38 4/128', 'pcs'],
    ['Vivo V30', 'Mobile Phones', 125000, 120000, 114000, 'Vivo', 'V30 8/256', 'pcs'],
    ['Vivo Y18', 'Mobile Phones', 48000, 46200, 44000, 'Vivo', 'Y18 4/64', 'pcs'],
    ['Tecno Camon 30', 'Mobile Phones', 70000, 67500, 64500, 'Tecno', 'Camon 30 8/256', 'pcs'],
    ['Tecno Spark 20 Pro', 'Mobile Phones', 52000, 50000, 47500, 'Tecno', 'Spark 20 Pro 8/256', 'pcs'],
    ['Infinix Hot 40 Pro', 'Mobile Phones', 56000, 54000, 51500, 'Infinix', 'Hot 40 Pro 8/256', 'pcs'],
    ['Infinix Note 40', 'Mobile Phones', 68000, 65500, 62500, 'Infinix', 'Note 40 8/256', 'pcs'],
    ['Itel A70', 'Mobile Phones', 43000, 41500, 39500, 'Itel', 'A70 4/128', 'pcs'],
    ['Realme C67', 'Mobile Phones', 64000, 61800, 59000, 'Realme', 'C67 8/128', 'pcs'],
    // Tablets
    ['iPad 10th Gen', 'Tablets', 165000, 159000, 150000, 'Apple', 'iPad 10th 10.9', 'pcs'],
    ['Samsung Galaxy Tab A9+', 'Tablets', 90000, 86500, 82000, 'Samsung', 'Tab A9+ 8/128', 'pcs'],
    ['Samsung Galaxy Tab S9 FE', 'Tablets', 160000, 154000, 146000, 'Samsung', 'Tab S9 FE 8/128', 'pcs'],
    ['Redmi Pad SE', 'Tablets', 72000, 69000, 65500, 'Xiaomi', 'Pad SE 6/128', 'pcs'],
    // Smart Watches
    ['Apple Watch Series 9', 'Smart Watches', 160000, 155000, 148000, 'Apple', 'Watch Series 9 45mm', 'pcs'],
    ['Samsung Galaxy Watch 6', 'Smart Watches', 110000, 106000, 101000, 'Samsung', 'Watch 6 44mm', 'pcs'],
    ['Redmi Watch 4', 'Smart Watches', 28000, 26800, 25400, 'Xiaomi', 'Watch 4', 'pcs'],
    ['Huawei Band 9', 'Smart Watches', 24000, 23000, 21800, 'Huawei', 'Band 9', 'pcs'],
    // Earbuds & Headphones
    ['AirPods Pro 2', 'Earbuds & Headphones', 105000, 101000, 96000, 'Apple', 'AirPods Pro 2', 'pcs'],
    ['Samsung Galaxy Buds 2 Pro', 'Earbuds & Headphones', 62000, 59500, 56500, 'Samsung', 'Buds 2 Pro', 'pcs'],
    ['Redmi Buds 5', 'Earbuds & Headphones', 18000, 17000, 16000, 'Xiaomi', 'Buds 5', 'pcs'],
    ['Tecno TW Earbuds', 'Earbuds & Headphones', 9000, 8500, 8000, 'Tecno', 'True Wireless Earbuds', 'pcs'],
    ['Over-Ear Bluetooth Headset', 'Earbuds & Headphones', 6500, 6000, 5500, 'Generic', 'Over-Ear Headset', 'pcs'],
    ['Wired Earphones', 'Earbuds & Headphones', 1200, 1000, 900, 'Generic', '3.5mm Earphones', 'pcs'],
    // Chargers & Cables
    ['Apple 20W USB-C Adapter', 'Chargers & Cables', 9000, 8500, 7900, 'Apple', '20W Adapter', 'pcs'],
    ['Type-C Fast Charger 33W', 'Chargers & Cables', 1800, 1600, 1400, 'Generic', '33W Fast Charger', 'pcs'],
    ['Lightning Cable 1m', 'Chargers & Cables', 1200, 1000, 850, 'Generic', 'Lightning 1m', 'pcs'],
    ['USB-C Cable 1.5m', 'Chargers & Cables', 900, 750, 600, 'Generic', 'USB-C 1.5m', 'pcs'],
    ['Car Charger Dual USB', 'Chargers & Cables', 2500, 2200, 1900, 'Generic', 'Car Charger', 'pcs'],
    // Cases & Covers
    ['iPhone 16 Silicone Case', 'Cases & Covers', 3500, 3100, 2600, 'Generic', 'Silicone Case', 'pcs'],
    ['Samsung A55 Back Cover', 'Cases & Covers', 2500, 2200, 1800, 'Generic', 'A55 Cover', 'pcs'],
    ['Shockproof Cover', 'Cases & Covers', 1500, 1300, 1050, 'Generic', 'Shockproof', 'pcs'],
    ['Flip Wallet Case', 'Cases & Covers', 2000, 1750, 1450, 'Generic', 'Wallet Case', 'pcs'],
    // Screen Protectors
    ['Tempered Glass 2.5D', 'Screen Protectors', 400, 300, 200, 'Generic', '2.5D Glass', 'pcs'],
    ['Tempered Glass 9D', 'Screen Protectors', 800, 650, 500, 'Generic', '9D Glass', 'pcs'],
    ['Hydrogel Film', 'Screen Protectors', 1000, 850, 700, 'Generic', 'Hydrogel', 'pcs'],
    // Power Banks
    ['Power Bank 10000mAh', 'Power Banks', 4500, 4150, 3700, 'Generic', '10000mAh', 'pcs'],
    ['Power Bank 20000mAh', 'Power Banks', 7500, 7000, 6300, 'Generic', '20000mAh', 'pcs'],
    ['Anker Power Bank 20000mAh', 'Power Banks', 14000, 13300, 12400, 'Anker', '20000mAh Premium', 'pcs'],
    // Memory Cards
    ['MicroSD 64GB Class 10', 'Memory Cards', 3800, 3500, 3100, 'SanDisk', '64GB', 'pcs'],
    ['MicroSD 128GB', 'Memory Cards', 6500, 6100, 5550, 'SanDisk', '128GB', 'pcs'],
    // Bluetooth Speakers
    ['Mini Bluetooth Speaker', 'Bluetooth Speakers', 4000, 3700, 3300, 'Generic', 'Mini Speaker', 'pcs'],
    ['Big Bluetooth Speaker', 'Bluetooth Speakers', 9000, 8500, 7800, 'Generic', 'Big Speaker', 'pcs'],
  ];
  for (const p of products) {
    insertProduct.run(...p);
  }

  const linkSupplier = db.prepare('UPDATE menu_items SET supplier_id = ? WHERE brand = ? AND supplier_id IS NULL');
  for (const [brand, supplierName] of Object.entries(supplierByBrand)) {
    const sid = supplierIds[supplierName];
    if (sid) linkSupplier.run(sid, brand);
  }
}

// Give each catalog product a starter stock level so a new shop can sell
// immediately. Only fills products that currently have zero stock, so it is
// safe to run on existing databases too. Runs on every boot from migrateSchema;
// fresh installs get seeded there right after seedDefaults.
function seedOpeningStock(db: Database.Database) {
  const getLevel = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS level FROM stock_entries WHERE menu_item_id = ?');
  const insert = db.prepare(`
    INSERT INTO stock_entries (menu_item_id, item_name, quantity, unit, received_date, source, notes, created_by)
    VALUES (?, ?, ?, ?, date('now', 'localtime'), 'manual', 'Opening stock', ?)
  `);
  const products = db.prepare('SELECT id, name, unit, category FROM menu_items WHERE active = 1').all() as Array<{ id: number; name: string; unit: string; category: string }>;
  if (products.length === 0) return 0;

  const owner = db.prepare(`
    SELECT u.id FROM users u
    INNER JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'Owner' AND u.active = 1
    ORDER BY u.id LIMIT 1
  `).get() as { id: number } | undefined;
  const ownerId = owner?.id ?? 0;

  const qtyByCategory: Record<string, number> = {
    'Mobile Phones': 5,
    'Tablets': 3,
    'Smart Watches': 4,
    'Earbuds & Headphones': 6,
    'Chargers & Cables': 25,
    'Cases & Covers': 30,
    'Screen Protectors': 50,
    'Power Banks': 12,
    'Memory Cards': 15,
    'Bluetooth Speakers': 8,
  };

  let inserted = 0;
  for (const p of products) {
    const level = getLevel.get(p.id) as { level: number };
    if (level.level > 0) continue;
    const qty = qtyByCategory[p.category] ?? 10;
    insert.run(p.id, p.name, qty, p.unit || 'pcs', ownerId);
    inserted++;
  }
  return inserted;
}

function migrateSchema(db: Database.Database) {
  const addColumnIfMissing = (table: string, column: string, type: string, defaultVal?: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      const defaultClause = defaultVal !== undefined ? ` DEFAULT ${defaultVal}` : '';
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`);
    }
  };

  addColumnIfMissing('suppliers', 'email', 'TEXT');
  addColumnIfMissing('suppliers', 'gstin', 'TEXT');
  addColumnIfMissing('suppliers', 'notes', 'TEXT');
  addColumnIfMissing('customers', 'email', 'TEXT');
  addColumnIfMissing('customers', 'credit_limit', 'REAL', '0');
  addColumnIfMissing('customers', 'notes', 'TEXT');
  addColumnIfMissing('shifts', 'notes', 'TEXT');
  addColumnIfMissing('menu_items', 'description', 'TEXT');
  addColumnIfMissing('menu_items', 'sort_order', 'INTEGER', '0');
  addColumnIfMissing('menu_items', 'wholesale_price', 'REAL', '0');
  addColumnIfMissing('menu_items', 'brand', 'TEXT');
  addColumnIfMissing('menu_items', 'model', 'TEXT');
  addColumnIfMissing('menu_items', 'sku', 'TEXT');
  addColumnIfMissing('menu_items', 'unit', 'TEXT', "'pcs'");
  addColumnIfMissing('orders', 'sale_type', 'TEXT', "'retail'");
  addColumnIfMissing('stock_entries', 'menu_item_id', 'INTEGER');
  addColumnIfMissing('stock_entries', 'order_id', 'INTEGER');
  addColumnIfMissing('purchase_items', 'menu_item_id', 'INTEGER');
  addColumnIfMissing('expenses', 'receipt_image', 'TEXT');
  addColumnIfMissing('orders', 'shift_id', 'INTEGER');
  addColumnIfMissing('bills', 'shift_id', 'INTEGER');
  addColumnIfMissing('menu_items', 'supplier_id', 'INTEGER');
  addColumnIfMissing('stock_reorder', 'menu_item_id', 'INTEGER');
  addColumnIfMissing('customer_ledger', 'created_at', 'TEXT', "(datetime('now', 'localtime'))");
  addColumnIfMissing('purchases', 'returned_amount', 'REAL', '0');
  addColumnIfMissing('purchases', 'gross_amount', 'REAL', '0');
  addColumnIfMissing('purchases', 'discount_type', 'TEXT', "'amount'");
  addColumnIfMissing('purchases', 'discount_value', 'REAL', '0');
  addColumnIfMissing('purchases', 'discount_amount', 'REAL', '0');

  // Backfill gross_amount for purchases created before supplier discounts were
  // tracked. total_amount already stored the gross payable in those rows.
  db.prepare('UPDATE purchases SET gross_amount = total_amount WHERE gross_amount = 0 AND total_amount > 0').run();

  // FK lookup indexes for the product <-> supplier <-> purchase <-> stock chain
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_menu_items_supplier ON menu_items(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_menu_item ON purchase_items(menu_item_id);
    CREATE INDEX IF NOT EXISTS idx_stock_entries_menu_item ON stock_entries(menu_item_id);
    CREATE INDEX IF NOT EXISTS idx_stock_entries_supplier ON stock_entries(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_stock_reorder_menu_item ON stock_reorder(menu_item_id) WHERE menu_item_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id, created_at);
  `);

  // Migrate any legacy preparing/ready orders to open
  db.prepare(`UPDATE orders SET status = 'open' WHERE status IN ('preparing', 'ready')`).run();

  // Legacy PRA cleanup — drop fiscal tables/columns/settings left by the old
  // restaurant build. Fresh installs never create them; existing DBs are cleaned.
  db.exec('DROP TABLE IF EXISTS pra_sync_queue');
  db.exec('DROP TABLE IF EXISTS pra_retry_queue');
  const dropColumn = (table: string, column: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((c) => c.name === column)) {
      try {
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      } catch {
        /* SQLite version may not support DROP COLUMN; leaving the column is harmless */
      }
    }
  };
  dropColumn('bills', 'pra_status');
  dropColumn('bills', 'pra_invoice_no');
  dropColumn('bills', 'qr_code_data');
  db.prepare("DELETE FROM app_settings WHERE key LIKE 'pra_%'").run();
  db.prepare("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE key = 'view_pra_status')").run();
  db.prepare("DELETE FROM user_permission_overrides WHERE permission_id IN (SELECT id FROM permissions WHERE key = 'view_pra_status')").run();

  seedCategories(db);
  seedSettings(db);
  migratePermissions(db);
  seedOpeningStock(db);
}

function migratePermissions(db: Database.Database) {
  const ensurePermission = db.prepare(
    'INSERT OR IGNORE INTO permissions (key, label, category) VALUES (?, ?, ?)'
  );
  ensurePermission.run('view_all_data', 'See All Users\' Data (Orders/Bills/Reports)', 'Data Access');

  const perm = db.prepare('SELECT id FROM permissions WHERE key = ?').get('view_all_data') as { id: number } | undefined;
  if (!perm) return;

  const insertRolePerm = db.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission_id, allowed) VALUES (?, ?, ?)'
  );

  const systemRoles = db.prepare('SELECT id FROM roles WHERE is_system = 1').all() as { id: number }[];
  for (const role of systemRoles) {
    insertRolePerm.run(role.id, perm.id, 1);
  }

  const nonSystemRoles = db.prepare('SELECT id FROM roles WHERE is_system = 0').all() as { id: number }[];
  for (const role of nonSystemRoles) {
    insertRolePerm.run(role.id, perm.id, 0);
  }
}

function seedCategories(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as count FROM menu_categories').get() as { count: number };
  if (count.count > 0) return;
  const distinct = db.prepare('SELECT DISTINCT category FROM menu_items WHERE category IS NOT NULL AND category <> ?').all('') as { category: string }[];
  const insert = db.prepare('INSERT OR IGNORE INTO menu_categories (name, sort_order) VALUES (?, ?)');
  distinct.forEach((d, i) => insert.run(d.category, i));
  const defs = ['Mobile Phones', 'Tablets', 'Accessories'];
  defs.forEach((d, i) => insert.run(d, distinct.length + i));
}

function seedSettings(db: Database.Database) {
  const defaults: Record<string, string> = {
    business_name: 'Sheikh Ahmad Mobiles',
    business_address: '',
    business_phone: '',
    business_ntn: '',
    receipt_header: 'Thank you for shopping at Sheikh Ahmad Mobiles',
    receipt_footer: 'Powered by Sheikh Ahmed Mobile POS',
    stock_allow_negative: '0',
    default_sale_type: 'retail',
    printer_type: 'blackcopper',
    printer_interface: 'usb',
    printer_name: 'Black Copper 80',
    terminal_id: '',
  };
  const insert = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) insert.run(k, v);
}
