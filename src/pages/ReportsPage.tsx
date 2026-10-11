import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { useIpcQuery } from '../hooks/useDB';
import { formatCurrency, toLocalYMD, cn } from '../lib/utils';
import { Card } from '../components/ui/Card';
import type {
  SalesSummary, DailySales, TopItem, ProfitLoss, PurchaseProductStat,
} from '../types';

type Tab = 'sales' | 'purchases' | 'suppliers' | 'customers' | 'expenses' | 'pnl';
type DateRange = 'today' | 'week' | 'month' | 'custom';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'sales', label: 'Sales', icon: 'payments' },
  { key: 'purchases', label: 'Purchases', icon: 'shopping_bag' },
  { key: 'suppliers', label: 'Suppliers', icon: 'local_shipping' },
  { key: 'customers', label: 'Customers', icon: 'groups' },
  { key: 'expenses', label: 'Expenses', icon: 'receipt_long' },
  { key: 'pnl', label: 'P&L', icon: 'account_balance' },
];

const COLORS = ['#00342b', '#004d40', '#7ebdac', '#94d3c1', '#bfc9c4', '#d7e4ec'];

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csvContent = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('sales');
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const getDateParams = () => {
    const now = new Date();
    if (dateRange === 'today') {
      return { date_from: toLocalYMD(now), date_to: toLocalYMD(now) };
    }
    if (dateRange === 'week') {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { date_from: toLocalYMD(from), date_to: toLocalYMD(now) };
    }
    if (dateRange === 'month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { date_from: toLocalYMD(from), date_to: toLocalYMD(now) };
    }
    return { date_from: customFrom || undefined, date_to: customTo || undefined };
  };

  const params = getDateParams();

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] leading-[36px] font-bold text-on-surface">
            Reports & Analytics
          </h1>
          <p className="text-[14px] text-on-surface-variant mt-1">
            Business intelligence and financial summaries
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          <span className="material-symbols-outlined text-[18px]">print</span>
          Print Report
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-container rounded-xl p-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap',
              activeTab === tab.key
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            )}
          >
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date Range */}
      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          {(['today', 'week', 'month'] as DateRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={cn(
                'h-8 px-3 rounded-full text-[13px] font-medium transition-all',
                dateRange === r
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              )}
            >
              {r === 'today' ? 'Today' : r === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
          <button
            onClick={() => setDateRange('custom')}
            className={cn(
              'h-8 px-3 rounded-full text-[13px] font-medium transition-all',
              dateRange === 'custom'
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            )}
          >
            Custom
          </button>
        </div>
        {dateRange === 'custom' && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-[13px] text-on-surface-variant">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}
      </div>

      {activeTab === 'sales' && <SalesTab params={params} />}
      {activeTab === 'purchases' && <PurchasesTab params={params} />}
      {activeTab === 'suppliers' && <SuppliersTab />}
      {activeTab === 'customers' && <CustomersTab />}
      {activeTab === 'expenses' && <ExpensesTab params={params} />}
      {activeTab === 'pnl' && <PnLTab params={params} />}
    </div>
  );
}

function SalesTab({ params }: { params: { date_from?: string; date_to?: string } }) {
  const [compare, setCompare] = useState(false);
  const { data: summary } = useIpcQuery<SalesSummary>('reports:sales-summary', 'reports:sales-summary', params.date_from || '', params.date_to || '');
  const { data: daily } = useIpcQuery<DailySales[]>('reports:daily-sales', 'reports:daily-sales', params.date_from || '', params.date_to || '');
  const { data: topItems } = useIpcQuery<TopItem[]>('reports:top-items', 'reports:top-items', params.date_from || '', params.date_to || '');

  const { data: prevSummary } = useQuery({
    queryKey: ['reports:sales-summary-prev', params, compare],
    queryFn: async () => {
      if (!compare || !params.date_from || !params.date_to) return null;
      const from = new Date(params.date_from);
      const to = new Date(params.date_to);
      const rangeMs = to.getTime() - from.getTime() + 86400000;
      const prevFrom = new Date(from.getTime() - rangeMs).toISOString().split('T')[0];
      const prevTo = new Date(to.getTime() - rangeMs).toISOString().split('T')[0];
      const result = await window.electronAPI.invoke('reports:sales-summary', prevFrom, prevTo) as {
        success: boolean; data?: { total_sales: number; order_count: number; average_order_value: number };
      };
      return result.data || null;
    },
    enabled: compare,
  });

  const currentSales = summary?.total_sales || 0;
  const prevSales = prevSummary?.total_sales || 0;
  const changePct = prevSales > 0 ? Math.round(((currentSales - prevSales) / prevSales) * 100) : null;

  const handleExportCSV = () => {
    const rows = (topItems || []).map((item, i) => [
      i + 1,
      item.name,
      item.total_qty || 0,
      item.total_revenue || 0,
    ]);
    downloadCSV('top-products.csv', ['#', 'Product', 'Qty Sold', 'Revenue'], rows);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setCompare((c) => !c)}
          className={cn(
            'flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-medium transition-all',
            compare ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
          )}
        >
          <span className="material-symbols-outlined text-[16px]">compare_arrows</span>
          Compare to Previous Period
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-on-surface-variant uppercase">Total Sales</p>
            {compare && changePct !== null && (
              <span className={cn('text-[12px] font-semibold', changePct >= 0 ? 'text-primary' : 'text-error')}>
                {changePct >= 0 ? '+' : ''}{changePct}%
              </span>
            )}
          </div>
          <p className="text-[24px] font-bold text-on-surface mt-1">
            {formatCurrency(currentSales)}
          </p>
          {compare && prevSummary && (
            <p className="text-[11px] text-on-surface-variant mt-1">Prev: {formatCurrency(prevSales)}</p>
          )}
        </Card>
        <Card>
          <p className="text-[12px] font-medium text-on-surface-variant uppercase">Sale Count</p>
          <p className="text-[24px] font-bold text-on-surface mt-1">
            {summary?.order_count || 0}
          </p>
          {compare && prevSummary && (
            <p className="text-[11px] text-on-surface-variant mt-1">Prev: {prevSummary.order_count}</p>
          )}
        </Card>
        <Card>
          <p className="text-[12px] font-medium text-on-surface-variant uppercase">Avg Sale Value</p>
          <p className="text-[24px] font-bold text-on-surface mt-1">
            {formatCurrency(summary?.average_order_value || 0)}
          </p>
          {compare && prevSummary && (
            <p className="text-[11px] text-on-surface-variant mt-1">Prev: {formatCurrency(prevSummary.average_order_value)}</p>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="text-[16px] font-semibold text-on-surface mb-4">Daily Sales</h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily || []} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#bfc9c4" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#3f4945' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#3f4945' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => [formatCurrency(value), 'Sales']} contentStyle={{ borderRadius: 8, border: '1px solid #bfc9c4', fontSize: 12 }} />
               <Bar dataKey="total_sales" fill="#00342b" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-semibold text-on-surface">Top Products</h3>
          <button onClick={handleExportCSV}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-container text-[12px] font-medium text-on-surface-variant hover:bg-surface-container-high transition-colors">
            <span className="material-symbols-outlined text-[16px]">download</span> Export CSV
          </button>
        </div>
        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_100px_120px] gap-2 px-4 py-2 bg-surface-container text-[11px] font-semibold text-on-surface-variant uppercase">
            <span>#</span><span>Product</span><span className="text-right">Qty Sold</span><span className="text-right">Revenue</span>
          </div>
          {topItems?.map((item, i) => (
            <div key={i} className="grid grid-cols-[40px_1fr_100px_120px] gap-2 px-4 py-2 border-t border-outline-variant">
              <span className="text-[13px] font-medium text-on-surface-variant">{i + 1}</span>
              <span className="text-[13px] font-medium text-on-surface">{item.name}</span>
              <span className="text-[13px] text-on-surface-variant text-right">{item.total_qty}</span>
              <span className="text-[13px] font-semibold text-on-surface text-right">{formatCurrency(item.total_revenue)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function PurchasesTab({ params }: { params: { date_from?: string; date_to?: string } }) {
  const { data: listData } = useQuery({
    queryKey: ['purchases:list-all', params],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('purchases:list-all', {
        dateFrom: params.date_from, dateTo: params.date_to,
      }) as { success: boolean; data?: { rows: any[]; totals: any } };
      return result.data || { rows: [], totals: {} };
    },
  });

  const { data: productStats } = useQuery({
    queryKey: ['purchases:stats-by-product', params],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('purchases:stats-by-product', {
        dateFrom: params.date_from, dateTo: params.date_to,
      }) as { success: boolean; data?: PurchaseProductStat[] };
      return result.data || [];
    },
  });

  const totals = listData?.totals || {};
  const stats = productStats || [];

  const handleExportCSV = () => {
    const rows = stats.map((s) => [
      s.product_name,
      s.unit,
      s.total_quantity || 0,
      s.total_gross || 0,
      Math.round((s.total_net || 0) * 100) / 100,
      Math.round((s.avg_cost || 0) * 100) / 100,
      s.last_rate || 0,
      s.last_purchase_date || '',
    ]);
    downloadCSV('purchases-by-product.csv',
      ['Product', 'Unit', 'Qty Bought', 'Gross', 'Net (after discount)', 'Avg Cost', 'Last Rate', 'Last Purchase'], rows);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-[12px] font-medium text-on-surface-variant uppercase">Total Bought</p>
          <p className="text-[24px] font-bold text-on-surface mt-1">{formatCurrency(totals.total_gross || 0)}</p>
          <p className="text-[11px] text-on-surface-variant mt-1">{Number(totals.total_quantity || 0)} units · {totals.purchase_count || 0} invoices</p>
        </Card>
        <Card>
          <p className="text-[12px] font-medium text-on-surface-variant uppercase">Supplier Discount</p>
          <p className="text-[24px] font-bold text-primary mt-1">{formatCurrency(totals.total_discount || 0)}</p>
          <p className="text-[11px] text-on-surface-variant mt-1">Reduces what we owe</p>
        </Card>
        <Card>
          <p className="text-[12px] font-medium text-on-surface-variant uppercase">Net Payable</p>
          <p className="text-[24px] font-bold text-on-surface mt-1">{formatCurrency(totals.total_net || 0)}</p>
          <p className="text-[11px] text-on-surface-variant mt-1">Paid {formatCurrency(totals.total_paid || 0)} · Returned {formatCurrency(totals.total_returned || 0)}</p>
        </Card>
        <Card>
          <p className="text-[12px] font-medium text-on-surface-variant uppercase">Still Owed</p>
          <p className="text-[24px] font-bold text-error mt-1">{formatCurrency(totals.outstanding || 0)}</p>
          <p className="text-[11px] text-on-surface-variant mt-1">Across all suppliers</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[16px] font-semibold text-on-surface">Buying Price by Product</h3>
            <p className="text-[12px] text-on-surface-variant mt-0.5">What we paid per product (net of supplier discount)</p>
          </div>
          <button onClick={handleExportCSV}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-container text-[12px] font-medium text-on-surface-variant hover:bg-surface-container-high transition-colors">
            <span className="material-symbols-outlined text-[16px]">download</span> Export CSV
          </button>
        </div>
        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_70px_90px_110px_110px_100px_110px] gap-2 px-4 py-2 bg-surface-container text-[11px] font-semibold text-on-surface-variant uppercase">
            <span>Product</span><span>Unit</span><span className="text-right">Qty Bought</span><span className="text-right">Gross</span><span className="text-right">Net</span><span className="text-right">Avg Cost</span><span className="text-right">Last Rate</span>
          </div>
          {stats.length === 0 ? (
            <p className="text-[14px] text-on-surface-variant text-center py-8">No purchases in this period</p>
          ) : stats.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_90px_110px_110px_100px_110px] gap-2 px-4 py-2 border-t border-outline-variant items-center">
              <span className="text-[13px] font-medium text-on-surface truncate">{s.product_name}</span>
              <span className="text-[13px] text-on-surface-variant">{s.unit}</span>
              <span className="text-[13px] text-on-surface-variant text-right">{s.total_quantity || 0}</span>
              <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(s.total_gross || 0)}</span>
              <span className="text-[13px] text-on-surface text-right">{formatCurrency(s.total_net || 0)}</span>
              <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(s.avg_cost || 0)}</span>
              <span className="text-[13px] font-semibold text-primary text-right">{formatCurrency(s.last_rate || 0)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SuppliersTab() {
  const { data: payables } = useQuery({
    queryKey: ['reports:supplier-payables'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('reports:supplier-payables') as {
        success: boolean; data?: any[];
      };
      return result.data || [];
    },
  });

  const totalCurrent = (payables || []).reduce((s: number, r: any) => s + (r.current_amount || 0), 0);
  const total30 = (payables || []).reduce((s: number, r: any) => s + (r.days_30 || 0), 0);
  const total60 = (payables || []).reduce((s: number, r: any) => s + (r.days_60 || 0), 0);
  const total90 = (payables || []).reduce((s: number, r: any) => s + (r.days_90 || 0), 0);

  const handleExportCSV = () => {
    const rows = (payables || []).map((r: any) => [r.name, r.current_amount || 0, r.days_30 || 0, r.days_60 || 0, r.days_90 || 0]);
    rows.push(['Total', totalCurrent, total30, total60, total90]);
    downloadCSV('supplier-aging.csv', ['Supplier', 'Current', '30 Days', '60 Days', '90+ Days'], rows);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[16px] font-semibold text-on-surface">Supplier Payables Aging</h3>
        <button onClick={handleExportCSV}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-container text-[12px] font-medium text-on-surface-variant hover:bg-surface-container-high transition-colors">
          <span className="material-symbols-outlined text-[16px]">download</span> Export CSV
        </button>
      </div>
      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_120px_120px_120px] gap-2 px-4 py-2 bg-surface-container text-[11px] font-semibold text-on-surface-variant uppercase">
          <span>Supplier</span><span className="text-right">Current</span><span className="text-right">30 Days</span><span className="text-right">60 Days</span><span className="text-right">90+ Days</span>
        </div>
        {payables?.map((row: any, i: number) => (
          <div key={i} className="grid grid-cols-[1fr_120px_120px_120px_120px] gap-2 px-4 py-3 border-t border-outline-variant">
            <span className="text-[13px] font-medium text-on-surface">{row.name}</span>
            <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(row.current_amount || 0)}</span>
            <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(row.days_30 || 0)}</span>
            <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(row.days_60 || 0)}</span>
            <span className="text-[13px] font-semibold text-error text-right">{formatCurrency(row.days_90 || 0)}</span>
          </div>
        ))}
        {payables && payables.length > 0 && (
          <div className="grid grid-cols-[1fr_120px_120px_120px_120px] gap-2 px-4 py-2 bg-surface-container border-t border-outline-variant text-[12px] font-bold text-on-surface">
            <span>Total</span>
            <span className="text-right">{formatCurrency(totalCurrent)}</span>
            <span className="text-right">{formatCurrency(total30)}</span>
            <span className="text-right">{formatCurrency(total60)}</span>
            <span className="text-right text-error">{formatCurrency(total90)}</span>
          </div>
        )}
        {payables && payables.length === 0 && (
          <p className="text-[14px] text-on-surface-variant text-center py-8">No outstanding supplier balances</p>
        )}
      </div>
    </Card>
  );
}

function CustomersTab() {
  const { data: receivables } = useQuery({
    queryKey: ['reports:customer-receivables'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('reports:customer-receivables') as {
        success: boolean; data?: any[];
      };
      return result.data || [];
    },
  });

  const totalCurrent = (receivables || []).reduce((s: number, r: any) => s + (r.current_amount || 0), 0);
  const total30 = (receivables || []).reduce((s: number, r: any) => s + (r.days_30 || 0), 0);
  const total60 = (receivables || []).reduce((s: number, r: any) => s + (r.days_60 || 0), 0);
  const total90 = (receivables || []).reduce((s: number, r: any) => s + (r.days_90 || 0), 0);

  const handleExportCSV = () => {
    const rows = (receivables || []).map((r: any) => [r.name, r.phone || '', r.current_amount || 0, r.days_30 || 0, r.days_60 || 0, r.days_90 || 0]);
    rows.push(['Total', '', totalCurrent, total30, total60, total90]);
    downloadCSV('customer-aging.csv', ['Customer', 'Phone', 'Current', '30 Days', '60 Days', '90+ Days'], rows);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[16px] font-semibold text-on-surface">Customer Receivables Aging</h3>
        <button onClick={handleExportCSV}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-container text-[12px] font-medium text-on-surface-variant hover:bg-surface-container-high transition-colors">
          <span className="material-symbols-outlined text-[16px]">download</span> Export CSV
        </button>
      </div>
      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_120px_120px_120px] gap-2 px-4 py-2 bg-surface-container text-[11px] font-semibold text-on-surface-variant uppercase">
          <span>Customer</span><span className="text-right">Current</span><span className="text-right">30 Days</span><span className="text-right">60 Days</span><span className="text-right">90+ Days</span>
        </div>
        {receivables?.map((row: any, i: number) => (
          <div key={i} className="grid grid-cols-[1fr_120px_120px_120px_120px] gap-2 px-4 py-3 border-t border-outline-variant">
            <div className="min-w-0">
              <span className="text-[13px] font-medium text-on-surface block truncate">{row.name}</span>
              {row.phone && <span className="text-[11px] text-on-surface-variant">{row.phone}</span>}
            </div>
            <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(row.current_amount || 0)}</span>
            <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(row.days_30 || 0)}</span>
            <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(row.days_60 || 0)}</span>
            <span className="text-[13px] font-semibold text-error text-right">{formatCurrency(row.days_90 || 0)}</span>
          </div>
        ))}
        {receivables && receivables.length > 0 && (
          <div className="grid grid-cols-[1fr_120px_120px_120px_120px] gap-2 px-4 py-2 bg-surface-container border-t border-outline-variant text-[12px] font-bold text-on-surface">
            <span>Total</span>
            <span className="text-right">{formatCurrency(totalCurrent)}</span>
            <span className="text-right">{formatCurrency(total30)}</span>
            <span className="text-right">{formatCurrency(total60)}</span>
            <span className="text-right text-error">{formatCurrency(total90)}</span>
          </div>
        )}
        {receivables && receivables.length === 0 && (
          <p className="text-[14px] text-on-surface-variant text-center py-8">No outstanding customer balances</p>
        )}
      </div>
    </Card>
  );
}

function ExpensesTab({ params }: { params: { date_from?: string; date_to?: string } }) {
  const { data: expenseData } = useQuery({
    queryKey: ['reports:expense-summary', params],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('reports:expense-summary', params.date_from || '', params.date_to || '') as {
        success: boolean; data?: { category: string; total: number }[];
      };
      return result.data || [];
    },
  });

  const handleExportCSV = () => {
    const total = (expenseData || []).reduce((s, r) => s + r.total, 0);
    const rows = (expenseData || []).map((r) => [r.category, r.total]);
    rows.push(['Total', total]);
    downloadCSV('expenses.csv', ['Category', 'Amount'], rows);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={handleExportCSV}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-container text-[12px] font-medium text-on-surface-variant hover:bg-surface-container-high transition-colors">
          <span className="material-symbols-outlined text-[16px]">download</span> Export CSV
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-[16px] font-semibold text-on-surface mb-4">Expenses by Category</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={expenseData || []} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#bfc9c4" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#3f4945' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: '#3f4945' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={(value: number) => [formatCurrency(value), 'Amount']} contentStyle={{ borderRadius: 8, border: '1px solid #bfc9c4', fontSize: 12 }} />
                <Bar dataKey="total" fill="#00342b" radius={[0, 4, 4, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="text-[16px] font-semibold text-on-surface mb-4">Category Breakdown</h3>
          <div className="h-[300px] flex items-center justify-center">
            {expenseData && expenseData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expenseData}
                    dataKey="total"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ category, percent }) => `${category} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={{ strokeWidth: 1 }}
                  >
                    {expenseData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[14px] text-on-surface-variant">No expense data</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function PnLTab({ params }: { params: { date_from?: string; date_to?: string } }) {
  const { data: pnl } = useIpcQuery<ProfitLoss>('reports:profit-loss', 'reports:profit-loss', params.date_from || '', params.date_to || '');

  return (
    <Card>
      <h3 className="text-[16px] font-semibold text-on-surface mb-6">Profit & Loss Statement</h3>
      <div className="space-y-4 max-w-md">
        <div className="flex justify-between py-3 border-b border-outline-variant">
          <span className="text-[14px] text-on-surface">Sales Revenue</span>
          <span className="text-[14px] font-semibold text-on-surface">
            {formatCurrency(pnl?.revenue || 0)}
          </span>
        </div>
        <div className="flex justify-between py-3 border-b border-outline-variant">
          <span className="text-[14px] text-on-surface-variant">Cost of Goods Sold</span>
          <span className="text-[14px] font-semibold text-error">
            ({formatCurrency(pnl?.cogs || 0)})
          </span>
        </div>
        <div className="flex justify-between py-3 border-b border-outline-variant">
          <span className="text-[14px] text-on-surface">Gross Profit</span>
          <span className="text-[14px] font-semibold text-on-surface">
            {formatCurrency((pnl?.revenue || 0) - (pnl?.cogs || 0))}
          </span>
        </div>
        <div className="flex justify-between py-3 border-b border-outline-variant">
          <span className="text-[14px] text-on-surface-variant">Operating Expenses</span>
          <span className="text-[14px] font-semibold text-error">
            ({formatCurrency(pnl?.expenses || 0)})
          </span>
        </div>
        <div className="flex justify-between py-4 border-t-2 border-primary">
          <span className="text-[18px] font-bold text-on-surface">Net Profit</span>
          <span
            className={cn(
              'text-[18px] font-bold',
              (pnl?.net_profit || 0) >= 0 ? 'text-primary' : 'text-error'
            )}
          >
            {formatCurrency(pnl?.net_profit || 0)}
          </span>
        </div>
      </div>
    </Card>
  );
}
