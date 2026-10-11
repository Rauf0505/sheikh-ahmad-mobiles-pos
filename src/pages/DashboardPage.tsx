import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useIpcQuery } from '../hooks/useDB';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, getTimeAgo, toLocalYMD, cn } from '../lib/utils';
import { Card } from '../components/ui/Card';
import type { DashboardKPI, AuditEntry, DailySales } from '../types';

export function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const viewAll = hasPermission('view_all_data');
  const { data: kpi, isLoading: kpiLoading } = useIpcQuery<DashboardKPI>('dashboard:kpi', 'dashboard:kpi');
  const { data: activity } = useIpcQuery<AuditEntry[]>('dashboard:activity', 'dashboard:activity');
  const { data: stockSummary } = useIpcQuery<any[]>('stock:summary', 'stock:summary');

  const queryClient = useQueryClient();

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['dashboard:kpi'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard:activity'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard:hourly-sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard:daily-sales'] });
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
    }, 30000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const today = toLocalYMD();
  const weekAgo = toLocalYMD(new Date(Date.now() - 7 * 86400000));
  const { data: dailySales } = useIpcQuery<DailySales[]>('dashboard:daily-sales', 'dashboard:daily-sales', weekAgo, today);

  const { data: hourlySales } = useIpcQuery<{ hour: number; sales: number; order_count: number }[]>(
    'dashboard:hourly-sales', 'dashboard:hourly-sales'
  );

  const { data: backupStatus } = useQuery({
    queryKey: ['backup:status'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('backup:status') as { success?: boolean; lastBackupTime?: string; isDriveConnected?: boolean; localBackupCount?: number };
      return result;
    },
  });

  const lowStockItems = (stockSummary || []).filter(
    (s: any) => (s.current_stock ?? 0) <= (s.reorder_level || 0)
  );

  const supplierCounts = new Map<string, number>();
  for (const s of lowStockItems as any[]) {
    const name = s.supplier_name || 'Unlinked Products';
    supplierCounts.set(name, (supplierCounts.get(name) || 0) + 1);
  }
  const [topSupplier, topSupplierCount] = [...supplierCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0] || ['', 0];

  const formatTrend = (pct: number) => {
    if (pct === 0) return null;
    const sign = pct > 0 ? '+' : '';
    return { text: `${sign}${pct}%`, up: pct > 0 };
  };

  const kpiCards = kpi
    ? [
        {
          label: "Today's Sales",
          value: formatCurrency(kpi.todaySales),
          icon: 'payments',
          trend: formatTrend((kpi as any).salesTrend || 0),
          hero: true,
        },
        {
          label: 'Order Count',
          value: String(kpi.orderCount),
          icon: 'receipt_long',
          trend: formatTrend((kpi as any).orderTrend || 0),
        },
        ...(viewAll || lowStockItems.length > 0
          ? [
              {
                label: 'Low Stock Items',
                value: String(lowStockItems.length),
                icon: 'inventory_2',
                accent: lowStockItems.length > 0,
              },
            ]
          : []),
        ...(viewAll
          ? [
              {
                label: 'Supplier Payables',
                value: formatCurrency(kpi.totalPayables),
                icon: 'local_shipping',
              },
              {
                label: 'Customer Receivables',
                value: formatCurrency(kpi.totalReceivables),
                icon: 'groups',
              },
            ]
          : []),
      ]
    : [];

  const activityIcons: Record<string, string> = {
    order: 'receipt_long',
    payment: 'payments',
    stock: 'inventory_2',
    expense: 'payments',
    menu: 'storefront',
    staff: 'badge',
  };

  // Build full 24-hour chart data (fill missing hours with 0)
  const hourlyMap = new Map((hourlySales || []).map((h) => [h.hour, h.sales]));
  const hourlyData = Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, '0')}:00`,
    sales: hourlyMap.get(i) || 0,
  }));

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h1 className="text-[28px] leading-[36px] font-bold text-on-surface">
          {user ? `${user.name}'s Overview` : 'Dashboard'}
        </h1>
        <p className="text-[14px] text-on-surface-variant mt-1">
          {viewAll
            ? 'Real-time metrics and recent activity'
            : 'Your sales and order activity'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="animate-pulse h-[120px]" />
            ))
          : kpiCards.map((card) => (
              <Card
                key={card.label}
                className={cn(
                  card.hero && 'md:col-span-2'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-medium text-on-surface-variant uppercase tracking-wide">
                      {card.label}
                    </span>
                    <span
                      className={cn(
                        'font-bold text-on-surface',
                        card.hero
                          ? 'text-[32px] leading-[40px]'
                          : 'text-[24px] leading-[32px]'
                      )}
                    >
                      {card.value}
                    </span>
                    {card.trend && (
                      <span
                        className={cn(
                          'text-[12px] font-semibold flex items-center gap-1',
                          card.trend.up ? 'text-primary' : 'text-error'
                        )}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {card.trend.up ? 'trending_up' : 'trending_down'}
                        </span>
                        {card.trend.text} vs yesterday
                      </span>
                    )}
                    {(card as any).accent && (
                      <span className="text-[12px] font-semibold text-error flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">warning</span>
                        Needs attention
                      </span>
                    )}
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-secondary-container flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-on-secondary-container text-[22px]">
                      {card.icon}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <h2 className="text-[18px] leading-[28px] font-semibold text-on-surface mb-4">
            7-Day Revenue Trend
          </h2>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dailySales || []}
                margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#bfc9c4"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: '#3f4945' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#3f4945' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), 'Sales']}
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #bfc9c4',
                    fontSize: 13,
                  }}
                />
                <Bar
                  dataKey="total_sales"
                  fill="#00342b"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="flex flex-col">
          <h2 className="text-[18px] leading-[28px] font-semibold text-on-surface mb-4">
            Recent Activity
          </h2>
          <div className="flex-1 overflow-y-auto space-y-1">
            {activity?.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 py-3 border-b border-outline-variant last:border-0"
              >
                <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                    {activityIcons[entry.action] || 'info'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-on-surface leading-[18px] truncate">
                    {entry.details || entry.action}
                  </p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    {entry.user_name} &middot; {getTimeAgo(entry.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            {activity && activity.length === 0 && (
              <p className="text-[14px] text-on-surface-variant text-center py-8">
                No recent activity
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Hourly Sales Breakdown */}
      {hourlyData.some((h) => h.sales > 0) && (
        <Card>
          <h2 className="text-[18px] leading-[28px] font-semibold text-on-surface mb-4">
            Today's Hourly Sales
          </h2>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#bfc9c4" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10, fill: '#3f4945' }}
                  axisLine={false}
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#3f4945' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), 'Sales']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #bfc9c4', fontSize: 12 }}
                />
                <Bar dataKey="sales" fill="#004d40" radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Low Stock Alerts */}
      {lowStockItems.length > 0 && (
        <Card className="border-l-4 border-error">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-semibold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-error text-[20px]">inventory_2</span>
              Low Stock Alerts
            </h2>
            <span className="text-[12px] font-medium text-error">{lowStockItems.length} item(s) below reorder level</span>
          </div>
          {topSupplier && (
            <p className="text-[13px] text-on-surface mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">local_shipping</span>
              Restock priority: <strong className="text-on-surface">{topSupplier}</strong>
              <span className="text-on-surface-variant">({topSupplierCount} item(s))</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {lowStockItems.map((s: any, i: number) => (
              <span key={i} className="px-3 py-1.5 rounded-full bg-error-container text-[12px] font-medium text-on-error-container">
                {s.item_name}
                {s.supplier_name && <span className="opacity-70"> · {s.supplier_name}</span>}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Backup Status */}
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center',
              backupStatus?.isDriveConnected ? 'bg-success-container' : 'bg-warning-container')}>
              <span className={cn('material-symbols-outlined text-[20px]',
                backupStatus?.isDriveConnected ? 'text-on-success-container' : 'text-on-warning-container')}>
                cloud
              </span>
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-on-surface">Cloud Backup</h2>
              <p className="text-[12px] text-on-surface-variant">
                {backupStatus?.isDriveConnected
                  ? `Drive connected &middot; ${backupStatus.localBackupCount || 0} local backup(s)`
                  : 'Google Drive not connected'}
              </p>
            </div>
          </div>
          <div className="text-right">
            {backupStatus?.lastBackupTime ? (
              <>
                <p className="text-[12px] text-on-surface-variant">Last backup</p>
                <p className="text-[13px] font-semibold text-on-surface">{getTimeAgo(backupStatus.lastBackupTime)}</p>
              </>
            ) : (
              <p className="text-[12px] text-warning">No backup yet</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
