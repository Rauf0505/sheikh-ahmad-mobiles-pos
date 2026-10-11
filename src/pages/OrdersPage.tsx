import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useIpcQuery } from '../hooks/useDB';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ui/Toast';
import { formatCurrency, formatOrderDateTime, toLocalYMD, cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import logoUrl from '../assets/logo.png';
import type { Order, OrderItem, MenuItem } from '../types';

type StatusFilter = 'all' | 'open' | 'billed' | 'cancelled';
type ViewMode = 'board' | 'table';

const STATUS_OPTIONS: { key: StatusFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: 'list' },
  { key: 'open', label: 'Open', icon: 'receipt_long' },
  { key: 'billed', label: 'Billed', icon: 'payments' },
  { key: 'cancelled', label: 'Cancelled', icon: 'cancel' },
];

const STATUS_FLOW: Record<string, string[]> = {
  open: ['billed', 'cancelled'],
};

const STATUS_COLORS: Record<string, string> = {
  open: 'info',
  billed: 'success',
  cancelled: 'error',
};

const VOID_REASONS = ['Wrong sale', 'Customer cancelled', 'Damaged', 'Incorrect price', 'Other'];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  jazzcash: 'JazzCash',
  easypaisa: 'EasyPaisa',
  credit: 'Credit',
};

type DatePreset = 'today' | '7days' | '30days' | 'month' | 'all' | 'custom';

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7days', label: 'Last 7 Days' },
  { key: '30days', label: 'Last 30 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom' },
];


export function OrdersPage() {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: settings } = useIpcQuery<Record<string, string>>('settings:get', 'settings:get');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [receiptOrderId, setReceiptOrderId] = useState<number | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const getDateRange = () => {
    const now = new Date();
    if (datePreset === 'custom') {
      return { dateFrom: customFrom || undefined, dateTo: customTo || undefined };
    }
    if (datePreset === 'today') {
      const d = toLocalYMD(now);
      return { dateFrom: d, dateTo: d };
    }
    if (datePreset === 'month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: toLocalYMD(from), dateTo: toLocalYMD(now) };
    }
    if (datePreset === 'all') {
      return { dateFrom: undefined, dateTo: undefined };
    }
    const days = datePreset === '7days' ? 7 : 30;
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { dateFrom: toLocalYMD(from), dateTo: toLocalYMD(now) };
  };

  const range = getDateRange();
  const { data, isLoading } = useIpcQuery<{ rows: Order[]; total: number }>(
    'orders:list', 'orders:list',
    { status: statusFilter === 'all' ? undefined : statusFilter, dateFrom: range.dateFrom, dateTo: range.dateTo, limit: pageSize, offset: (page - 1) * pageSize }
  );

  const orders = data?.rows || [];
  const totalCount = data?.total || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  useEffect(() => { setPage(1); }, [statusFilter, datePreset, customFrom, customTo, pageSize]);

  const filtered = (orders || []).filter((o) => {
    const matchesSearch = !searchQuery || String(o.id).includes(searchQuery);
    return matchesSearch;
  });

  const historyOrders = filtered;

  const printOrderReceipt = async (orderId: number) => {
    try {
      const res = await window.electronAPI.invoke('orders:get', orderId) as { success: boolean; data?: any; error?: string };
      if (!res.success || !res.data) throw new Error(res.error || 'Could not load order');
      const { items, bill, ...order } = res.data;
      if (order.status !== 'billed') { toast.error('Only billed/paid sales can be reprinted'); return; }
      await window.electronAPI.invoke('printer:print-receipt', {
        orderId,
        billId: bill?.id,
        items: (items ?? []).map((it: any) => ({ name: it.item_name || `Item #${it.menu_item_id}`, qty: it.qty ?? it.quantity, price: it.price, notes: it.notes ?? '' })),
        subtotal: bill?.subtotal ?? 0,
        discountAmount: bill?.discount_amount ?? 0,
        total: bill?.total ?? order.bill_total ?? 0,
        paymentMethod: bill?.payment_method ?? 'cash',
        cashierName: order.created_by_name || user?.name || 'Cashier',
        saleType: order.sale_type || 'retail',
        timestamp: order.created_at,
        businessName: settings?.business_name || 'Sheikh Ahmad Mobiles',
        businessPhone: settings?.business_phone || '',
        businessAddress: settings?.business_address || '',
        businessNTN: settings?.business_ntn || '',
        receiptHeader: settings?.receipt_header || 'Thank you for shopping with us!',
        receiptFooter: settings?.receipt_footer || '',
      });
      toast.success(`Receipt for sale #${orderId} sent to printer`);
    } catch (e: any) {
      toast.error(e.message || 'Print failed');
    }
  };

  const deleteOrderMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await window.electronAPI.invoke('orders:delete', id) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders:list'] });
      toast.success('Unbilled order deleted');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to delete order'),
  });

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] leading-[36px] font-bold text-on-surface">
            {hasPermission('view_all_data') ? 'Orders' : 'My Orders'}
          </h1>
          <p className="text-[14px] text-on-surface-variant mt-1">
            {hasPermission('view_all_data') ? 'Manage and track all orders' : 'Orders created by you'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-surface-container rounded-lg p-0.5">
            {([
              { key: 'board' as ViewMode, label: 'Board', icon: 'view_kanban' },
              { key: 'table' as ViewMode, label: 'Table', icon: 'table_rows' },
            ]).map((mode) => (
              <button key={mode.key} onClick={() => setViewMode(mode.key)}
                className={cn('h-8 px-3 rounded-md text-[12px] font-medium transition-all flex items-center gap-1',
                  viewMode === mode.key ? 'bg-primary text-on-primary' : 'text-on-surface-variant')}>
                <span className="material-symbols-outlined text-[16px]">{mode.icon}</span> {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Date Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant">calendar_today</span>
        <div className="flex gap-1.5">
          {DATE_PRESETS.map((preset) => (
            <button key={preset.key} onClick={() => setDatePreset(preset.key)}
              className={cn('h-8 px-3 rounded-full text-[12px] font-medium transition-all',
                datePreset === preset.key ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high')}>
              {preset.label}
            </button>
          ))}
        </div>
        {datePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 px-3 rounded-lg border border-outline-variant bg-surface text-[12px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
            <span className="text-[12px] text-on-surface-variant">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 px-3 rounded-lg border border-outline-variant bg-surface text-[12px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        )}
      </div>

      {/* Status Filters + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {STATUS_OPTIONS.map((opt) => (
            <button key={opt.key} onClick={() => setStatusFilter(opt.key)}
              className={cn('h-8 px-3 rounded-full text-[12px] font-medium transition-all flex items-center gap-1',
                statusFilter === opt.key ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high')}>
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">search</span>
          <input type="text" placeholder="Search sale #..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-9 pr-3 w-48 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      {/* Board View */}
      {viewMode === 'board' && (
        <div className="space-y-6">
          {historyOrders.length === 0 ? (
            <div className="bg-surface border border-outline-variant rounded-xl p-8 text-center text-[14px] text-on-surface-variant">No orders found</div>
          ) : historyOrders.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold text-on-surface-variant uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant">history</span>
                Order History ({historyOrders.length})
              </h3>
              <div className="bg-surface border border-outline-variant rounded-xl">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-surface-container text-[11px] font-semibold text-on-surface-variant uppercase tracking-wide">
                      <th className="px-4 py-2.5 w-[56px]">Order</th>
                      <th className="px-4 py-2.5 w-[92px]">Sale Type</th>
                      <th className="px-4 py-2.5 w-[80px]">Status</th>
                      <th className="px-4 py-2.5 w-[96px]">Total</th>
                      <th className="px-4 py-2.5 w-[100px]">By</th>
                      <th className="px-4 py-2.5 whitespace-nowrap">Time</th>
                      <th className="px-4 py-2.5 w-[48px] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {historyOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-surface-container-low transition-colors">
                        <td className="px-4 py-2.5 text-[13px] font-semibold text-on-surface">#{order.id}</td>
                        <td className="px-4 py-2.5"><Badge variant={order.sale_type === 'wholesale' ? 'secondary' : 'neutral'} size="sm">{order.sale_type === 'wholesale' ? 'Wholesale' : 'Retail'}</Badge></td>
                        <td className="px-4 py-2.5"><Badge variant={(STATUS_COLORS[order.status] || 'neutral') as any} size="sm">{order.status}</Badge></td>
                        <td className="px-4 py-2.5 text-[13px] font-medium text-on-surface">{order.bill_total != null ? formatCurrency(order.bill_total) : '—'}</td>
                        <td className="px-4 py-2.5 text-[12px] text-on-surface-variant truncate">{order.created_by_name || 'Unknown'}</td>
                        <td className="px-4 py-2.5 text-[12px] text-on-surface-variant whitespace-nowrap">{formatOrderDateTime(order.created_at)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <OrderRowDropdown
                            order={order}
                            canVoid={hasPermission('void_bill')}
                            onView={() => setSelectedOrderId(order.id)}
                            onViewReceipt={() => setReceiptOrderId(order.id)}
                            onPrint={() => printOrderReceipt(order.id)}
                            onDelete={() => { if (confirm(`Delete unbilled order #${order.id}? This cannot be undone.`)) deleteOrderMutation.mutate(order.id); }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="bg-surface border border-outline-variant rounded-xl">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-container text-[11px] font-semibold text-on-surface-variant uppercase tracking-wide">
                <th className="px-4 py-2.5 w-[56px]">Order</th>
                <th className="px-4 py-2.5 w-[92px]">Sale Type</th>
                <th className="px-4 py-2.5 w-[80px]">Status</th>
                <th className="px-4 py-2.5 w-[96px]">Total</th>
                <th className="px-4 py-2.5 w-[100px]">By</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Time</th>
                <th className="px-4 py-2.5 w-[48px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[14px] text-on-surface-variant">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[14px] text-on-surface-variant">No orders found</td></tr>
              ) : (
                filtered.map((order) => (
                  <tr key={order.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-4 py-2.5 text-[13px] font-semibold text-on-surface">#{order.id}</td>
                    <td className="px-4 py-2.5"><Badge variant={order.sale_type === 'wholesale' ? 'secondary' : 'neutral'} size="sm">{order.sale_type === 'wholesale' ? 'Wholesale' : 'Retail'}</Badge></td>
                    <td className="px-4 py-2.5"><Badge variant={(STATUS_COLORS[order.status] || 'neutral') as any} size="sm">{order.status}</Badge></td>
                    <td className="px-4 py-2.5 text-[13px] font-medium text-on-surface">{order.bill_total != null ? formatCurrency(order.bill_total) : '—'}</td>
                    <td className="px-4 py-2.5 text-[12px] text-on-surface-variant truncate">{order.created_by_name || 'Unknown'}</td>
                    <td className="px-4 py-2.5 text-[12px] text-on-surface-variant whitespace-nowrap">{formatOrderDateTime(order.created_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <OrderRowDropdown
                        order={order}
                        canVoid={hasPermission('void_bill')}
                        onView={() => setSelectedOrderId(order.id)}
                        onViewReceipt={() => setReceiptOrderId(order.id)}
                        onPrint={() => printOrderReceipt(order.id)}
                        onDelete={() => { if (confirm(`Delete unbilled order #${order.id}? This cannot be undone.`)) deleteOrderMutation.mutate(order.id); }}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <p className="text-[12px] text-on-surface-variant">
              Showing {Math.min((page - 1) * pageSize + 1, totalCount)}–{Math.min(page * pageSize, totalCount)} of {totalCount}
            </p>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="h-7 px-2 rounded-lg border border-outline-variant bg-surface text-[12px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className={cn('h-8 px-3 rounded-lg text-[12px] font-medium transition-all flex items-center gap-1 border border-outline-variant',
                  page <= 1 ? 'opacity-40 cursor-not-allowed text-on-surface-variant' : 'text-on-surface hover:bg-surface-container')}>
                <span className="material-symbols-outlined text-[16px]">chevron_left</span> Prev
              </button>
              <span className="text-[12px] text-on-surface-variant font-medium">Page {page} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className={cn('h-8 px-3 rounded-lg text-[12px] font-medium transition-all flex items-center gap-1 border border-outline-variant',
                  page >= totalPages ? 'opacity-40 cursor-not-allowed text-on-surface-variant' : 'text-on-surface hover:bg-surface-container')}>
                Next <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Order Detail Modal */}
      <Modal open={!!selectedOrderId} onClose={() => setSelectedOrderId(null)} title={`Order #${selectedOrderId}`} size="lg">
        {selectedOrderId && <OrderDetail orderId={selectedOrderId} onStatusChange={() => queryClient.invalidateQueries({ queryKey: ['orders:list'] })} />}
      </Modal>

      {/* Receipt Preview Modal */}
      <Modal open={!!receiptOrderId} onClose={() => setReceiptOrderId(null)} title={`Receipt`}>
        {receiptOrderId && (
          <ReceiptPreview orderId={receiptOrderId} settings={settings} onPrint={() => printOrderReceipt(receiptOrderId)} />
        )}
      </Modal>
    </div>
  );
}


function OrderRowDropdown({ order, canVoid, onView, onViewReceipt, onPrint, onDelete }: { order: Order; canVoid: boolean; onView: () => void; onViewReceipt?: () => void; onPrint?: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 rounded-md hover:bg-surface-container-high transition-colors flex items-center justify-center text-on-surface-variant"
      >
        <span className="material-symbols-outlined text-[18px]">more_vert</span>
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 w-44 bg-surface border border-outline-variant rounded-xl shadow-xl z-50 py-1 animate-in fade-in slide-in-from-bottom-1 duration-100">
          <button
            onClick={() => { setOpen(false); onView(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-on-surface hover:bg-surface-container-low transition-colors text-left"
          >
            <span className="material-symbols-outlined text-[16px]">visibility</span>
            View Details
          </button>
          {order.status === 'billed' && (
            <button
              onClick={() => { setOpen(false); onViewReceipt?.(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-on-surface hover:bg-surface-container-low transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[16px]">receipt_long</span>
              View Receipt
            </button>
          )}
          {canVoid && order.status !== 'billed' && order.status !== 'cancelled' && (
            <button
              onClick={() => { setOpen(false); onView(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-error hover:bg-error-container/20 transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[16px]">cancel</span>
              Void
            </button>
          )}
          {order.status === 'open' && onDelete && (
            <button
              onClick={() => { setOpen(false); onDelete(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-error hover:bg-error-container/20 transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
              Delete Order
            </button>
          )}
          {order.status === 'billed' && (
            <button
              onClick={() => { setOpen(false); onPrint?.(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-on-surface hover:bg-surface-container-low transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              Print Receipt
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReceiptPreview({ orderId, settings, onPrint }: { orderId: number; settings?: Record<string, string>; onPrint: () => void }) {
  const { data: orderData, isLoading } = useQuery({
    queryKey: ['orders:get', orderId],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('orders:get', orderId) as { success: boolean; data?: any };
      return result.data;
    },
  });

  if (isLoading || !orderData) {
    return <div className="py-10 text-center text-on-surface-variant">Loading receipt...</div>;
  }

  const { items, bill, ...order } = orderData as { items: any[]; bill?: any; [key: string]: any };
  const subtotal = bill?.subtotal ?? 0;
  const discountAmount = bill?.discount_amount ?? 0;
  const total = bill?.total ?? order.bill_total ?? 0;
  const paymentMethod = bill?.payment_method ?? 'cash';

  return (
    <div className="space-y-3">
      <div className="w-full max-w-[340px] mx-auto bg-[#ffffff] text-black rounded-xl p-5 border border-outline-variant font-mono text-[12px] leading-relaxed">
        <div className="text-center">
          <div className="flex flex-col items-center gap-1 mb-1">
            <img src={logoUrl} alt="Sheikh Ahmad Mobiles" className="w-12 h-12 object-contain" draggable={false} />
            <p className="text-[15px] font-bold">{settings?.business_name || 'Sheikh Ahmad Mobiles'}</p>
          </div>
          <p>{settings?.business_phone || ''}{settings?.business_phone && settings?.business_address ? ' | ' : ''}{settings?.business_address || ''}</p>
          {settings?.business_ntn && <p>NTN: {settings?.business_ntn}</p>}
        </div>
        <div className="text-center mt-1">
          <p className="font-bold">~ Sale Invoice ~</p>
        </div>
        <div className="border-t border-black mt-1 pt-1">
          <div className="flex justify-between"><span>Order: #{order.id}</span>{bill && <span>Bill: #{bill.id}</span>}</div>
          <div className="flex justify-between"><span>Date:</span><span>{formatOrderDateTime(order.created_at)}</span></div>
          <div className="flex justify-between"><span>Cashier:</span><span>{order.created_by_name || 'Unknown'}</span></div>
          <div className="flex justify-between">
            <span>Sale Type:</span>
            <span className="font-bold">{order.sale_type === 'wholesale' ? 'Wholesale' : 'Retail'}</span>
          </div>
          {bill?.customer_id && order.customer_name && (
            <div className="flex justify-between">
              <span>Customer:</span>
              <span>{order.customer_name}</span>
            </div>
          )}
        </div>
        <div className="border-t border-black mt-1 pt-1">
          {items.map((item: any) => (
            <div key={item.id} className="flex justify-between">
              <span>{item.qty ?? item.quantity}x {item.item_name || `Item #${item.menu_item_id}`}</span>
              <span>{formatCurrency((item.price ?? 0) * (item.qty ?? item.quantity ?? 1) - (item.discount || 0))}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-black mt-1 pt-1 space-y-0.5">
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(subtotal)}</span></div>
          {discountAmount > 0 && <div className="flex justify-between"><span>Discount:</span><span>-{formatCurrency(discountAmount)}</span></div>}
          <div className="flex justify-between font-bold">
            <span>TOTAL:</span><span>{formatCurrency(total)}</span>
          </div>
        </div>
        <div className="border-t border-black mt-1 pt-1 flex justify-between">
          <span>Payment:</span>
          <span className="font-bold">{(PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod).toUpperCase()}</span>
        </div>
        <div className="text-center mt-2">{settings?.receipt_header || 'Thank you for shopping with us!'}</div>
        {settings?.receipt_footer && <div className="text-center">{settings?.receipt_footer}</div>}
      </div>

      <div className="flex gap-3 pt-1">
        <Button variant="secondary" icon="print" className="flex-1" onClick={onPrint}>Print Receipt</Button>
      </div>
    </div>
  );
}

function OrderDetail({ orderId, onStatusChange }: { orderId: number; onStatusChange: () => void }) {
  const queryClient = useQueryClient();
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidPin, setVoidPin] = useState('');
  const [voidError, setVoidError] = useState('');
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [editItemQty, setEditItemQty] = useState<{ id: number; qty: number } | null>(null);

  const { data: orderData, isLoading } = useQuery({
    queryKey: ['orders:get', orderId],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('orders:get', orderId) as { success: boolean; data?: any };
      return result.data;
    },
  });

  const { data: menuItems } = useIpcQuery<MenuItem[]>('menu:list', 'menu:list');

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const result = await window.electronAPI.invoke('orders:update-status', id, status) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders:get', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orders:list'] });
      queryClient.invalidateQueries({ queryKey: ['customers:list'] });
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
      onStatusChange();
    },
  });

  const voidMutation = useMutation({
    mutationFn: async ({ id, status, reason }: { id: number; status: string; reason?: string }) => {
      const result = await window.electronAPI.invoke('orders:update-status', id, status, reason) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders:get', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orders:list'] });
      queryClient.invalidateQueries({ queryKey: ['customers:list'] });
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
      onStatusChange();
      setVoidModalOpen(false);
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async (item: any) => {
      const result = await window.electronAPI.invoke('orders:add-item', item) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders:get', orderId] });
      setAddItemModalOpen(false);
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const result = await window.electronAPI.invoke('orders:remove-item', itemId) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders:get', orderId] });
    },
  });

  const updateQtyMutation = useMutation({
    mutationFn: async ({ id, qty }: { id: number; qty: number }) => {
      const result = await window.electronAPI.invoke('orders:update-item-qty', id, qty) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders:get', orderId] });
      setEditItemQty(null);
    },
  });

  const handleVoid = async () => {
    setVoidError('');
    if (!voidReason) { setVoidError('Select a reason'); return; }
    const pinResult = await window.electronAPI.invoke('auth:login', voidPin) as { success: boolean };
    if (!pinResult.success) { setVoidError('Invalid PIN'); return; }
    voidMutation.mutate({ id: orderId, status: 'cancelled', reason: voidReason });
  };

  if (isLoading || !orderData) {
    return <div className="py-4 text-center text-on-surface-variant">Loading...</div>;
  }

  const { items, bill, ...order } = orderData as { items: OrderItem[]; bill?: any; [key: string]: any };
  const nextStatuses = STATUS_FLOW[order.status] || [];
  const canModify = order.status === 'open';

  return (
    <div className="space-y-4">
      {/* Status Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {nextStatuses.map((nextStatus) => (
          <Button key={nextStatus}
            variant={nextStatus === 'cancelled' ? 'secondary' : 'primary'}
            size="sm"
            icon={nextStatus === 'cancelled' ? 'cancel' : 'payments'}
            onClick={() => {
              if (nextStatus === 'cancelled') { setVoidModalOpen(true); }
              else { statusMutation.mutate({ id: orderId, status: nextStatus }); }
            }}
            loading={statusMutation.isPending}
          >
            {nextStatus === 'cancelled' ? 'Void Sale' : 'Mark Billed'}
          </Button>
        ))}
        {canModify && (
          <Button variant="secondary" size="sm" icon="add" onClick={() => setAddItemModalOpen(true)}>
            Add Item
          </Button>
        )}
      </div>

      {/* Order Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[12px] text-on-surface-variant">Sale Type</p>
          <Badge variant={order.sale_type === 'wholesale' ? 'secondary' : 'neutral'}>{order.sale_type === 'wholesale' ? 'Wholesale' : 'Retail'}</Badge>
        </div>
        <div>
          <p className="text-[12px] text-on-surface-variant">Customer</p>
          <p className="text-[14px] font-medium text-on-surface">{order.customer_name || (order.customer_id ? `Customer #${order.customer_id}` : 'Walk-in')}</p>
        </div>
        <div>
          <p className="text-[12px] text-on-surface-variant">Status</p>
          <Badge variant={(STATUS_COLORS[order.status] || 'neutral') as any}>{order.status}</Badge>
        </div>
        <div>
          <p className="text-[12px] text-on-surface-variant">Created At</p>
          <p className="text-[14px] font-medium text-on-surface">{formatOrderDateTime(order.created_at)}</p>
        </div>
      </div>

      {/* Items */}
      <div>
        <h4 className="text-[14px] font-semibold text-on-surface mb-2">
          Items
          {canModify && <span className="text-[12px] font-normal text-on-surface-variant ml-2">(modifying enabled)</span>}
        </h4>
        <div className="bg-surface-container rounded-lg divide-y divide-outline-variant">
          {items.map((item: any) => (
            <div key={item.id} className="px-4 py-2">
              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <span className="text-[13px] text-on-surface">
                    {item.item_name || `Item #${item.menu_item_id}`}
                  </span>
                  {canModify && (
                    <div className="flex items-center gap-1 mt-1">
                      {editItemQty?.id === item.id ? (
                        <div className="flex items-center gap-1">
                          {(() => {
                            const qty = editItemQty!.qty;
                            return (
                              <>
                                <button onClick={() => {
                                  const newQty = qty - 1;
                                  if (newQty <= 0) { removeItemMutation.mutate(item.id); }
                                  else { updateQtyMutation.mutate({ id: item.id, qty: newQty }); }
                                }}
                                  className="w-6 h-6 rounded bg-surface border border-outline-variant flex items-center justify-center text-[12px] hover:bg-surface-container-high transition-colors">
                                  -
                                </button>
                                <span className="text-[13px] font-medium w-6 text-center">{qty}</span>
                                <button onClick={() => updateQtyMutation.mutate({ id: item.id, qty: qty + 1 })}
                                  className="w-6 h-6 rounded bg-surface border border-outline-variant flex items-center justify-center text-[12px] hover:bg-surface-container-high transition-colors">
                                  +
                                </button>
                                <button onClick={() => setEditItemQty(null)}
                                  className="ml-2 text-[11px] text-primary font-medium hover:underline">done</button>
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-[12px] text-on-surface-variant">x{item.qty}</span>
                          <button onClick={() => setEditItemQty({ id: item.id, qty: item.qty })}
                            className="text-[11px] text-primary font-medium hover:underline ml-2">edit</button>
                          <button onClick={() => { if (confirm('Remove this item?')) removeItemMutation.mutate(item.id); }}
                            className="text-[11px] text-error font-medium hover:underline ml-2">remove</button>
                        </div>
                      )}
                    </div>
                  )}
                  {!canModify && <span className="text-[12px] text-on-surface-variant ml-1">x{item.qty}</span>}
                </div>
                <span className="text-[13px] font-medium text-on-surface ml-3">{formatCurrency(item.price * item.qty)}</span>
              </div>
              {item.notes && <p className="text-[11px] text-tertiary italic mt-0.5">Note: {item.notes}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Bill */}
      {bill && (
        <div className="bg-surface-container rounded-lg p-4 space-y-2">
          <h4 className="text-[14px] font-semibold text-on-surface mb-2">Bill</h4>
          <div className="flex justify-between text-[13px]">
            <span className="text-on-surface-variant">Subtotal</span>
            <span className="text-on-surface">{formatCurrency(bill.subtotal)}</span>
          </div>
          {bill.discount_amount > 0 && (
            <div className="flex justify-between text-[13px]">
              <span className="text-on-surface-variant">Discount</span>
              <span className="text-primary font-medium">-{formatCurrency(bill.discount_amount)}</span>
            </div>
          )}
          <div className="flex justify-between text-[14px] font-bold border-t border-outline-variant pt-2">
            <span className="text-on-surface">Total</span>
            <span className="text-on-surface">{formatCurrency(bill.total)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-on-surface-variant">Payment</span>
            <span className="text-on-surface capitalize">{(PAYMENT_METHOD_LABELS[bill.payment_method] || bill.payment_method)}</span>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      <Modal open={addItemModalOpen} onClose={() => setAddItemModalOpen(false)} title="Add Item to Order" size="lg">
        <AddItemToOrder
          menuItems={menuItems || []}
          onAdd={(item) => addItemMutation.mutate({
            order_id: orderId,
            menu_item_id: item.id,
            qty: 1,
            price: item.price,
          })}
          loading={addItemMutation.isPending}
        />
      </Modal>

      {/* Void Modal */}
      <Modal open={voidModalOpen} onClose={() => { setVoidModalOpen(false); setVoidReason(''); setVoidPin(''); setVoidError(''); }} title="Void Sale">
        <div className="space-y-4">
          <div>
            <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Reason</label>
            <select value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
              className="w-full h-11 px-4 rounded-lg border border-outline-variant bg-surface text-[14px] focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Select reason...</option>
              {VOID_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Manager PIN</label>
            <input type="password" maxLength={6} value={voidPin} onChange={(e) => setVoidPin(e.target.value)}
              placeholder="6-digit PIN"
              className="w-full h-11 px-4 rounded-lg border border-outline-variant bg-surface text-[14px] focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          {voidError && <p className="text-[13px] text-error">{voidError}</p>}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setVoidModalOpen(false)} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={handleVoid} className="flex-1 bg-error">Void</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function AddItemToOrder({ menuItems, onAdd, loading }: { menuItems: MenuItem[]; onAdd: (item: MenuItem) => void; loading: boolean }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const categories = [...new Set(menuItems.map((m) => m.category))];

  const filtered = menuItems.filter((item) => {
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || String(item.shortcut || '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || item.category === categoryFilter;
    return matchesSearch && matchesCategory && item.active;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <Input icon="search" placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">All</option>
          {categories.map((cat) => (<option key={cat} value={cat}>{cat}</option>))}
        </select>
      </div>
      <div className="max-h-[400px] overflow-y-auto space-y-1">
        {filtered.map((item) => (
          <button key={item.id} onClick={() => onAdd(item)} disabled={loading}
            className="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-surface-container-low transition-colors text-left">
            <div>
              <p className="text-[14px] font-medium text-on-surface">{item.name}</p>
              <p className="text-[12px] text-on-surface-variant">{item.category}</p>
            </div>
            <span className="text-[14px] font-semibold text-primary">{formatCurrency(item.price)}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-[14px] text-on-surface-variant text-center py-8">No items found</p>
        )}
      </div>
    </div>
  );
}
