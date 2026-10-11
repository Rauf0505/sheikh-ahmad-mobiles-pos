export interface Role {
  id: number;
  name: string;
  is_system: number;
}

export interface User {
  id: number;
  name: string;
  role_id: number;
  phone?: string;
  active: number;
  roleName?: string;
}

export interface Permission {
  id: number;
  key: string;
  label: string;
  category: string;
}

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  wholesale_price: number;
  cost_price: number;
  brand?: string;
  model?: string;
  sku?: string;
  unit: string;
  description?: string;
  image_url?: string;
  active: number;
  shortcut?: string;
  supplier_id?: number;
  supplier_name?: string;
  current_stock?: number;
  reorder_level?: number;
  unit_cost?: number;
}

export interface Order {
  id: number;
  sale_type: string;
  status: string;
  customer_id?: number;
  created_by: number;
  created_by_name?: string;
  bill_total?: number;
  payment_method?: string;
  created_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  menu_item_id: number;
  qty: number;
  price: number;
  discount: number;
  notes?: string;
  name?: string;
}

export interface Bill {
  id: number;
  order_id: number;
  subtotal: number;
  discount_amount: number;
  total: number;
  payment_method: string;
  cashier_id: number;
  created_at: string;
  sale_type?: string;
  customer_id?: number;
  order?: Order;
  items?: OrderItem[];
}

export interface Supplier {
  id: number;
  name: string;
  contact_phone?: string;
  address?: string;
  email?: string;
  gstin?: string;
  notes?: string;
  active: number;
  outstanding_balance?: number;
  product_count?: number;
  products?: SupplierProduct[];
  stats?: {
    purchase_count: number;
    total_purchased: number;
    total_units: number;
    last_purchase_date?: string;
    unpaid_purchases?: number;
  };
}

export interface SupplierProduct {
  menu_item_id: number;
  name: string;
  unit: string;
  retail_price?: number;
  wholesale_price?: number;
  cost_price?: number;
  on_hand?: number;
  reorder_level?: number;
  last_received?: string;
  last_purchase_rate?: number;
  price_history_count?: number;
}

export interface ProductPriceHistory {
  id: number;
  menu_item_id: number;
  cost_price: number;
  retail_price: number;
  wholesale_price: number;
  source: string;
  purchase_id?: number;
  notes?: string;
  created_by?: number;
  created_at: string;
  created_by_name?: string;
  supplier_name?: string;
}

export interface PurchaseReturn {
  id: number;
  purchase_id: number;
  supplier_id: number;
  return_date: string;
  total_amount: number;
  notes?: string;
  created_by?: number;
  supplier_name?: string;
}

export interface SupplierDashboardRow {
  id: number;
  name: string;
  product_count: number;
  products_to_reorder: number;
  total_units: number;
  total_purchased: number;
}

export interface Purchase {
  id: number;
  supplier_id: number;
  invoice_no?: string;
  purchase_date: string;
  gross_amount?: number;
  discount_type?: 'amount' | 'percent';
  discount_value?: number;
  discount_amount?: number;
  total_amount: number;
  paid_amount: number;
  status: string;
  notes?: string;
  supplier_name?: string;
  returned_amount?: number;
  items?: PurchaseItem[];
  returns?: PurchaseReturn[];
}

export interface PurchaseProductStat {
  product_name: string;
  menu_item_id: number | null;
  unit: string;
  total_quantity: number;
  total_gross: number;
  total_net: number;
  avg_cost: number;
  last_rate?: number;
  last_purchase_date?: string;
}

export interface PurchaseItem {
  id: number;
  purchase_id: number;
  menu_item_id?: number;
  item_name: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  product_name?: string;
}

export interface SupplierPayment {
  id: number;
  supplier_id: number;
  purchase_id?: number;
  amount: number;
  payment_date: string;
  method: string;
  notes?: string;
}

export interface StockEntry {
  id: number;
  menu_item_id?: number;
  item_name: string;
  quantity: number;
  unit: string;
  received_date: string;
  supplier_id?: number;
  purchase_id?: number;
  order_id?: number;
  source: string;
  notes?: string;
  created_by: number;
  created_at: string;
  supplier_name?: string;
  logged_by_name?: string;
}

export interface StockSummaryRow {
  menu_item_id: number | null;
  item_name: string;
  unit: string;
  category?: string;
  retail_price?: number;
  wholesale_price?: number;
  total_in: number;
  total_sold: number;
  total_used: number;
  current_stock: number;
  last_received?: string;
  reorder_level: number;
  supplier_id?: number;
  supplier_name?: string;
  last_purchase_rate?: number;
}

export interface Customer {
  id: number;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  credit_limit: number;
  notes?: string;
  active: number;
  outstanding_balance?: number;
}

export interface CustomerLedgerEntry {
  id: number;
  customer_id: number;
  order_id?: number;
  type: string;
  amount: number;
  entry_date: string;
  notes?: string;
  running_balance?: number;
}

export interface ExpenseCategory {
  id: number;
  name: string;
}

export interface Expense {
  id: number;
  category_id: number;
  description: string;
  amount: number;
  expense_date: string;
  paid_by: number;
  notes?: string;
  category_name?: string;
  paid_by_name?: string;
}

export interface AuditEntry {
  id: number;
  user_id: number;
  action: string;
  entity?: string;
  entity_id?: number;
  timestamp: string;
  details?: string;
  user_name?: string;
}

export interface DashboardKPI {
  todaySales: number;
  orderCount: number;
  totalPayables: number;
  totalReceivables: number;
  salesTrend: number;
  orderTrend: number;
}

export interface SalesSummary {
  total_sales: number;
  order_count: number;
  average_order_value: number;
}

export interface DailySales {
  date: string;
  total_sales: number;
  order_count: number;
}

export interface TopItem {
  name: string;
  total_qty: number;
  total_revenue: number;
}

export interface ProfitLoss {
  revenue: number;
  cogs: number;
  expenses: number;
  gross_profit: number;
  net_profit: number;
}

export type SaleType = 'retail' | 'wholesale';
export type OrderStatus = 'open' | 'billed' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'credit' | 'bank_transfer' | 'jazzcash' | 'easypaisa';

export interface RetailConsolidatedProduct {
  name: string;
  qty: number;
  amount: number;
}

export interface RetailConsolidatedSummary {
  sales_count: number;
  subtotal: number;
  discount_amount: number;
  total: number;
}

export interface RetailConsolidatedPaymentSplit {
  method: string;
  count: number;
  amount: number;
}

export interface RetailConsolidated {
  products: RetailConsolidatedProduct[];
  summary: RetailConsolidatedSummary;
  payment_split: RetailConsolidatedPaymentSplit[];
}

export const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'jazzcash', label: 'JazzCash' },
  { value: 'easypaisa', label: 'EasyPaisa' },
  { value: 'credit', label: 'Credit' },
];