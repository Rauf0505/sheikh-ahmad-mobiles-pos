# Chaudary Broast POS — Deep Improvement Plan

**Created:** 2026-08-27
**Status:** Active
**Current Phase:** Phase 0 (Critical Bug Fixes)

---

## Overview

User feedback: the system was built too shallowly in one pass. Every page matches the plan structurally but lacks depth. This plan deepens each module phase by phase, starting with critical bug fixes.

## Phase 0: Critical Bug Fixes (Foundation)
**Status:** ✅ COMPLETE
**Est. Time:** 3-4h

### 0A. Field Name Mismsatches (Reports, Dashboard)
All Reports tabs and Dashboard chart show zeros because backend returns `snake_case` but frontend reads `camelCase`.

| Fix | File | Change |
|-----|------|--------|
| Sales summary | `ReportsPage.tsx:154-166` | `totalSales` → `total_sales`, `orderCount` → `order_count`, `avgOrderValue` → `average_order_value` |
| Daily sales chart | `ReportsPage.tsx:180` + `DashboardPage.tsx:163` | `dataKey="total"` → `dataKey="total_sales"` |
| Top items | `ReportsPage.tsx:196-197` | `totalQty` → `total_qty`, `totalRevenue` → `total_revenue` |
| Tax summary | `ReportsPage.tsx:227-229` | `category` → `tax_category`, `tax_amount` → `tax_collected`, add `taxable_amount` to SQL |
| Expense summary | `ReportsPage.tsx:325,339` | `dataKey="total"` → `dataKey="total_expenses"` |
| P&L statement | `ReportsPage.tsx:374,403` | `salesRevenue` → `revenue`, `netProfit` → `net_profit` |

### 0B. Broken IPC Calls
| Fix | File | Change |
|-----|------|--------|
| Menu edit broken | `MenuPage.tsx:63` | Change from `invoke('menu:update', {id, ...})` to `invoke('menu:update', id, {...})` (2 args) |
| Order detail no bill | `db/index.ts:128-143` | Add `bills` table query to `orders:get` handler |
| Item name fallback | `OrdersPage.tsx:186` | `item.name` → `item.item_name` |

### 0C. Hardcoded User IDs
| Fix | File | Change |
|-----|------|--------|
| Expenses paid_by | `ExpensesPage.tsx:242` | `paid_by: 1` → `paid_by: user?.id` |
| Inventory created_by | `InventoryPage.tsx:304` | `created_by: 1` → `created_by: user?.id` |

### 0D. Other Bugs
| Fix | File | Change |
|-----|------|--------|
| Staff role name | `StaffPage.tsx:134,158` | `roleName` → `role_name` |
| Supplier YTD/last payment | `SuppliersPage.tsx:151,157` | Compute from `payments[]` array, not missing fields |
| Customer search not wired | `CustomersPage.tsx:87` | Add `searchTerm` state + filter logic |
| POS tableNo cleared before receipt | `POSPage.tsx` | Save tableNo in receipt data before clearing state |
| Menu delete no confirm | `MenuPage.tsx:212` | Add `confirm()` dialog |
| Debug console.logs | `LoginPage.tsx:20,25,36` | Remove debug logs |

---

## Phase 1: POS Page Deep Improvement
**Status:** ✅ COMPLETE
**Est. Time:** 6-8h

### 1A. Search & Customer Assignment
- Add item search bar above menu grid (filters by name)
- Add "Assign Customer" button → modal with customer list + search + "New Customer" quick-add
- Store `customer_id` on the order

### 1B. Discount System
- Discount button opens modal: % discount, fixed amount, or promo code
- Show discount line on receipt
- Store `discount` on the bill

### 1C. Order Notes & Modifiers
- Per-item "Special Instructions" input (long press or note icon)
- Item modifier groups: e.g., "Spice Level" (Mild/Medium/Hot), "Extras" (Cheese +Rs.50)
- Show modifiers on receipt

### 1D. Hold/Recall Orders
- "Hold" button stores current cart to `localStorage` keyed by table number
- "Recall" button loads held order
- Visual indicator when orders are on hold

### 1E. Void Order
- "Void" button with reason selection (damaged, wrong order, customer left)
- Requires manager override (owner PIN)
- Logs void in audit trail

### 1F. Split Bill
- Split equally (N ways) or split by item
- Create separate bills for each split
- Show split indicator on receipts

### 1G. Delivery Mode
- Add "Delivery" as third dining option
- Show delivery address input
- Show driver assignment

---

## Phase 2: Orders Page Deep Improvement
**Status:** ✅ COMPLETE
**Est. Time:** 4-5h

### 2A. Order Status Flow
- Status progression: `open → preparing → ready → billed → cancelled`
- Status change buttons with confirmation
- Color-coded status badges
- Cancel requires reason + manager override

### 2B. Active Orders Board
- Default view shows only "open" and "preparing" orders
- Visual cards instead of table rows (kitchen-display style)
- Auto-refresh every 10 seconds
- Sort by time (oldest first)

### 2C. Order Search & Filtering
- Search by order ID, table number, or customer name
- Date range filter
- Dining mode filter (dine-in/takeaway/delivery)

### 2D. Order Modification
- Add/remove items from open orders
- Void individual items with reason
- Recalculate bill automatically

### 2E. Kitchen Display View
- Large cards showing order number, table, items, time elapsed
- "Bump" button to advance status
- Audio alert for new orders

---

## Phase 3: Dashboard & Reports Deep Improvement
**Status:** ✅ COMPLETE
**Est. Time:** 5-7h

**Completed:** 3A (trends, hourly chart, PRA indicator, pending orders, backup status, low-stock alerts, auto-refresh 30s), 3B (summary cards, daily chart, top items, compare-to-previous, CSV), 3C (taxable_amount, per-category breakdown, CSV), 3D/3E (aging buckets with totals, CSV), 3F (cost_price+COGS via menu, report), 3G (CSV on all tabs, print report, date presets).

### 3A. Dashboard
- Replace hardcoded trends with real period-over-period comparison
- Add hourly breakdown chart (busiest hours)
- Add PRA sync status indicator (online/offline)
- Add backup status (last backup time)
- Add low-stock alerts panel
- Add pending orders count
- Auto-refresh every 30 seconds

### 3B. Reports - Sales Tab
- Real summary cards with actual data
- Daily sales chart (actually works after Phase 0 fix)
- Top items table with revenue + quantity
- Add "Compare to Previous Period" toggle
- Add export to CSV

### 3C. Reports - Tax Tab
- Fix field names (Phase 0)
- Add taxable_amount to SQL query
- Show per-category breakdown
- Add tax filing summary (for PRA submission)

### 3D. Reports - Supplier Aging
- Implement actual aging buckets (Current, 30, 60, 90+ days)
- Query purchase dates vs today for bucketing
- Show per-supplier aging with totals

### 3E. Reports - Customer Aging
- Same as supplier aging but for customer receivables
- Query credit sale dates for bucketing

### 3F. Reports - P&L
- Fix field names (Phase 0)
- Calculate COGS from menu item cost (add `cost_price` to menu items)
- Show gross profit, operating expenses, net profit
- Add comparison period

### 3G. Reports - Export
- Add CSV export for all report tabs
- Add print report functionality
- Add date range presets (Today, This Week, This Month, This Year, Custom)

---

## Phase 4: Suppliers & Customers Deep Improvement
**Status:** ✅ COMPLETE
**Est. Time:** 5-6h

**Completed:** 4A (CRUD modal, itemized purchase entry w/ multi-line + units, purchase date selector, ledger view, payment recording, search/filter, active toggle, statement display), 4B (CRUD, search, order history, credit limit mgmt w/ warnings, notes).

### 4A. Suppliers
- Add Create/Edit/Delete supplier UI (CRUD modal)
- Itemized purchase entry (multiple line items per purchase)
- Purchase date selector (not always "today")
- Supplier ledger (khata) view with running balance
- Payment allocation to specific purchases
- Supplier statement export/print
- Search and filter supplier list
- Active/inactive toggle

### 4B. Customers
- Add Edit/Delete customer functionality
- Fix search (wire the input field)
- Customer order history tab
- Credit limit management (set max credit, warn when exceeded)
- Customer statement export/print
- Customer loyalty points (optional)
- Customer notes field

---

## Phase 5: Shift Management (New Module)
**Status:** ✅ COMPLETE
**Est. Time:** 5-6h

**Completed:** 5A (open/close flow, denomination calculator, expected vs actual, shortage/surplus, shift timer), 5B (denomination calculator for notes/coins), 5C (shift summary: total sales, payment breakdown, expenses during shift, expected/actual cash, variance), 5D (shift_id column on orders+bills via migration, auto-attached; POS does NOT require active shift; per-shift sales in list/summary).

### 5A. Shift Open/Close Flow
- "Start Shift" button → enter opening cash float (denomination calculator)
- Shift timer showing duration
- "End Shift" button → enter closing cash float (denomination calculator)
- Expected vs actual cash comparison
- Shortage/surplus calculation

### 5B. Denomination Calculator
- Input fields for each note/coin: 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1
- Auto-calculate total
- Show on both open and close

### 5C. Shift Summary Report
- Total sales during shift
- Payment method breakdown (cash/card)
- Expenses during shift
- Expected cash in drawer
- Actual cash counted
- Variance report

### 5D. Integration
- POS requires active shift to process orders
- Shift ID attached to every order/bill
- Dashboard shows current shift status
- Reports filter by shift

---

## Phase 6: Inventory & Menu Deep Improvement
**Status:** COMPLETE
**Est. Time:** 6-7h

**Completed:** 6A (reorder levels per stock item, low-stock alerts with reorder badges, stock valuation report), 6B (category CRUD entities with sort_order, drag-drop-ready sort_order column, bulk price update modal, menu item variants/sizes, modifier groups with options, recipe/ingredient linking per menu item).

### 6A. Inventory
- Add current stock level view (running balance from entries - consumption)
- Stock adjustment (waste, spoilage, theft, correction)
- Min/max stock levels with low-stock alerts
- Stock valuation report (quantity × cost)
- Unit of measure (kg, pack, litre, etc.)
- Daily consumption tracking
- Reorder point alerts on dashboard

### 6B. Menu
- Category management (CRUD for categories as entities)
- Drag-drop reorder for menu items
- Bulk price update (increase all by X%)
- Menu item variants/sizes (Small/Medium/Large)
- Image upload (not just URL)
- Item availability toggle per shift
- Recipe/ingredient linking to inventory
- Modifier groups (spice level, extras)

---

## Phase 7: Expenses, Settings & Polish
**Status:** COMPLETE
**Est. Time:** 5-6h

**Completed:** 7A (edit/delete expenses, category CRUD incl. delete, date presets, category summary, receipt photo input field), 7B (business profile settings, tax rate config, PRA credentials entry, receipt customization, terminal settings section, audit log viewer, cloud backup section), 7C (staff PIN change routed to staff:update-pin, staff deactivation/reactivation toggle, staff activity log viewer), 7D (toast notification system, Esc-to-close shortcut, audit logging for key CRUD operations).

**Remaining (optional/lower priority):** receipt photo capture via native file dialog, PRA sync integration with real API, responsive design pass, keyboard shortcuts Ctrl+N/Ctrl+S, loading skeleton components, empty state illustrations.

### 7A. Expenses
- Edit/Delete expenses
- Receipt photo capture
- Expense category CRUD UI (add/edit/delete categories)
- Running expense summary by category
- Expense approval workflow (optional)

### 7B. Settings
- Business profile (name, address, logo, NTN)
- Tax rate configuration (not hardcoded 8%)
- Receipt printer configuration
- Receipt header/footer customization
- PRA credentials entry
- Backup schedule configuration
- Cloud backup activation UI
- Audit log viewer
- Terminal ID configuration

### 7C. Staff Polish
- Fix PIN change on edit (send to `staff:update-pin`)
- Deactivation/reactivation flow
- Staff activity log viewer
- Shift assignment

### 7D. Cross-cutting Polish
- Remove all debug `console.log` statements
- Add loading skeletons to all list pages
- Add empty state illustrations
- Add toast notifications for all CRUD operations
- Keyboard shortcuts (Ctrl+N = new, Ctrl+S = save, Esc = close)
- Responsive design pass for different screen sizes

---

## Progress Log

| Date | Phase | Status | Notes |
|------|-------|--------|-------|
| 2026-08-27 | Plan Created | Done | Full plan documented |
| 2026-08-27 | Phase 0 | Done | Critical bug fixes |
| 2026-08-27 | Phase 1 | Done | POS page improvements |
| 2026-08-27 | Phase 2 | Done | Order modification + kitchen display |
| 2026-08-27 | Phase 3 | Done | Dashboard & reports (hourly, CSV, COGS, backup, low-stock, compare, print) |
| 2026-08-27 | Phase 4 | Done | Itemized purchases, date selector, order history |
| 2026-08-27 | Phase 5 | Done | Shift timer, expenses, shift_id on orders/bills |
| 2026-08-27 | Phase 6 | Done | reorder levels, valuation, category CRUD, variants, modifiers, recipe linking |
| 2026-08-27 | Phase 7 | Done | business/tax/PRA/receipt settings, audit log, staff deactivation, toasts |
