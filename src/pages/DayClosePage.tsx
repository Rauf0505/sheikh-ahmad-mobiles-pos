import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useIpcQuery } from '../hooks/useDB';
import { useToast } from '../components/ui/Toast';
import { formatCurrency, toLocalYMD, cn } from '../lib/utils';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import type { RetailConsolidated } from '../types';

type DatePreset = 'today' | 'yesterday' | '7days' | 'custom';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  jazzcash: 'JazzCash',
  easypaisa: 'EasyPaisa',
  credit: 'Credit',
};

export function DayClosePage() {
  const toast = useToast();
  const { data: settings } = useIpcQuery<Record<string, string>>('settings:get', 'settings:get');
  const [preset, setPreset] = useState<DatePreset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const getRange = (): { dateFrom: string; dateTo: string } => {
    const now = new Date();
    if (preset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const d = toLocalYMD(y);
      return { dateFrom: d, dateTo: d };
    }
    if (preset === '7days') {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { dateFrom: toLocalYMD(from), dateTo: toLocalYMD(now) };
    }
    if (preset === 'custom') {
      return { dateFrom: customFrom || toLocalYMD(now), dateTo: customTo || toLocalYMD(now) };
    }
    const today = toLocalYMD(now);
    return { dateFrom: today, dateTo: today };
  };

  const range = getRange();

  const { data, isLoading } = useIpcQuery<RetailConsolidated>(
    'sales:retail-consolidated', 'sales:retail-consolidated', range.dateFrom, range.dateTo
  );

  const printMutation = useMutation({
    mutationFn: async () => {
      const result = await window.electronAPI.invoke('printer:print-consolidated-receipts', {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        products: data?.products ?? [],
        summary: data?.summary,
        payment_split: data?.payment_split ?? [],
        businessName: settings?.business_name,
        businessPhone: settings?.business_phone,
        businessAddress: settings?.business_address,
        businessNTN: settings?.business_ntn,
        receiptHeader: settings?.receipt_header,
        receiptFooter: settings?.receipt_footer,
      }) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      toast.success(`Consolidated retail receipt printed for ${range.dateFrom}${range.dateTo !== range.dateFrom ? ` - ${range.dateTo}` : ''}`);
    },
    onError: (e: any) => toast.error(e.message || 'Print failed'),
  });

  const handlePrint = () => {
    if (!data || data.summary.sales_count === 0) return;
    const ok = window.confirm(
      `Print the consolidated retail receipt for ${range.dateFrom}${range.dateTo !== range.dateFrom ? ` to ${range.dateTo}` : ''}?\n\n${data.summary.sales_count} sale(s) — ${formatCurrency(data.summary.total)}`
    );
    if (ok) printMutation.mutate();
  };

  const presets: { key: DatePreset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7days', label: 'Last 7 Days' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] leading-[36px] font-bold text-on-surface">Day Close</h1>
          <p className="text-[14px] text-on-surface-variant mt-1">
            Print one consolidated receipt covering everything sold in retail for a period
          </p>
        </div>
        <Button
          variant="primary"
          icon="local_printshop"
          loading={printMutation.isPending}
          disabled={!data || data.summary.sales_count === 0}
          onClick={handlePrint}
        >
          Print Retail Receipt
        </Button>
      </div>

      {/* Period picker */}
      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={cn(
                'h-8 px-3 rounded-full text-[13px] font-medium transition-all',
                preset === p.key
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
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

      {isLoading ? (
        <div className="py-20 text-center text-on-surface-variant text-[14px]">Loading day's retail sales...</div>
      ) : !data || data.summary.sales_count === 0 ? (
        <Card className="py-16 flex flex-col items-center gap-2 text-center">
          <span className="material-symbols-outlined text-[40px] text-on-surface-variant">receipt_long</span>
          <p className="text-[15px] font-semibold text-on-surface">No retail sales in this period</p>
          <p className="text-[13px] text-on-surface-variant">Wholesale sales are not included in the consolidated retail receipt.</p>
        </Card>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <p className="text-[12px] text-on-surface-variant font-medium">Retail Sales</p>
              <p className="text-[28px] font-bold text-on-surface mt-1">{data.summary.sales_count}</p>
            </Card>
            <Card>
              <p className="text-[12px] text-on-surface-variant font-medium">Items Sold</p>
              <p className="text-[28px] font-bold text-on-surface mt-1">
                {data.products.reduce((n, p) => n + p.qty, 0)}
              </p>
            </Card>
            <Card>
              <p className="text-[12px] text-on-surface-variant font-medium">Subtotal</p>
              <p className="text-[28px] font-bold text-on-surface mt-1">{formatCurrency(data.summary.subtotal)}</p>
            </Card>
            <Card>
              <p className="text-[12px] text-on-surface-variant font-medium">Total</p>
              <p className="text-[28px] font-bold text-primary mt-1">{formatCurrency(data.summary.total)}</p>
            </Card>
          </div>

          {/* Payment split */}
          <div className="flex flex-wrap gap-2">
            {data.payment_split.map((p) => (
              <Badge key={p.method} variant="info">
                {PAYMENT_LABELS[p.method] || p.method}: {p.count} sale(s) — {formatCurrency(p.amount)}
              </Badge>
            ))}
            {data.summary.discount_amount > 0 && (
              <Badge variant="neutral">Discounts: {formatCurrency(data.summary.discount_amount)}</Badge>
            )}
          </div>

          {/* Product list */}
          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-outline-variant flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-on-surface">Everything Sold</h2>
              <span className="text-[12px] text-on-surface-variant">{data.products.length} product(s)</span>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface-container text-[11px] font-semibold text-on-surface-variant uppercase tracking-wide">
                  <th className="px-5 py-2.5">Product</th>
                  <th className="px-5 py-2.5 w-[96px]">Qty</th>
                  <th className="px-5 py-2.5 w-[140px] text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {data.products.map((p) => (
                  <tr key={p.name} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-5 py-2.5 text-[13px] font-medium text-on-surface">{p.name}</td>
                    <td className="px-5 py-2.5 text-[13px] text-on-surface-variant">{p.qty}</td>
                    <td className="px-5 py-2.5 text-[13px] font-semibold text-on-surface text-right">{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}