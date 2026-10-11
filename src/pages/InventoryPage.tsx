import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, formatDateTime, toLocalYMD, cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import type { StockEntry } from '../types';

type View = 'stock' | 'orders' | 'history' | 'valuation';
type DatePreset = 'today' | '2days' | '3days' | '7days' | 'custom';

const DATE_PRESETS: { key: DatePreset; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '2days', label: 'Last 2 Days', days: 2 },
  { key: '3days', label: 'Last 3 Days', days: 3 },
  { key: '7days', label: 'Last 7 Days', days: 7 },
];

export function InventoryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('stock');
  const [datePreset, setDatePreset] = useState<DatePreset>('7days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showWasteModal, setShowWasteModal] = useState(false);

  const getDateRange = () => {
    if (datePreset === 'custom') {
      return { dateFrom: customFrom || undefined, dateTo: customTo || undefined };
    }
    const preset = DATE_PRESETS.find((p) => p.key === datePreset);
    const days = preset?.days ?? 0;
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    return {
      dateFrom: toLocalYMD(from),
      dateTo: toLocalYMD(to),
    };
  };

  const { data: stockEntries, isLoading } = useQuery({
    queryKey: ['stock:list', datePreset, customFrom, customTo, search],
    queryFn: async () => {
      const range = getDateRange();
      const result = await window.electronAPI.invoke('stock:list', {
        ...range,
        item_name: search || undefined,
      }) as { success: boolean; data?: StockEntry[] };
      return result.data || [];
    },
  });

  const { data: stockSummary } = useQuery({
    queryKey: ['stock:summary'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('stock:summary') as { success: boolean; data?: any[] };
      return result.data || [];
    },
  });

  const filteredSummary = (stockSummary || []).filter(
    (s) => !search || s.item_name.toLowerCase().includes(search.toLowerCase())
  );

  const suggestedOrders = (filteredSummary as any[])
    .filter((s) => s.reorder_level > 0 && Number(s.current_stock || 0) <= s.reorder_level);

  const orderCount = suggestedOrders.length;

  const { data: valuation } = useQuery({
    queryKey: ['reports:stock-valuation'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('reports:stock-valuation') as { success: boolean; data?: { items: any[]; totalValue: number } };
      return result.data || { items: [], totalValue: 0 };
    },
  });

  const setReorder = async (menu_item_id: number, item_name: string, unit: string) => {
    const val = prompt(`Set reorder level for "${item_name}" (${unit}):`);
    if (val === null || val === '') return;
    await window.electronAPI.invoke('stock:reorder:set', { menu_item_id, item_name, unit, reorder_level: Number(val) || 0 });
    queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
  };

  const wasteMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('stock:adjust', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock:list'] });
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
      setShowWasteModal(false);
    },
    onError: (e: any) => alert(e.message || 'Failed to record waste'),
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('stock:create', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock:list'] });
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
      setShowModal(false);
    },
  });

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] leading-[36px] font-bold text-on-surface">Stock</h1>
          <p className="text-[14px] text-on-surface-variant mt-1">Live stock levels, sales usage, and adjustments</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon="tune" onClick={() => setShowWasteModal(true)}>Stock Adjustment</Button>
          <Button variant="primary" icon="add" onClick={() => setShowModal(true)}>Add Stock Entry</Button>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-1 bg-surface-container rounded-xl p-1 w-fit">
        {([
          { key: 'stock' as View, label: 'Stock Levels', icon: 'inventory_2' },
          { key: 'orders' as View, label: orderCount > 0 ? `Suggested Orders (${orderCount})` : 'Suggested Orders', icon: 'shopping_cart_checkout' },
          { key: 'history' as View, label: 'Stock History', icon: 'history' },
          { key: 'valuation' as View, label: 'Valuation', icon: 'payments' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all',
              view === tab.key ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'
            )}
          >
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-2">
            {DATE_PRESETS.map((preset) => (
              <button key={preset.key} onClick={() => setDatePreset(preset.key)}
                className={cn('h-8 px-3 rounded-full text-[13px] font-medium transition-all',
                  datePreset === preset.key ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                )}>
                {preset.label}
              </button>
            ))}
            <button onClick={() => setDatePreset('custom')}
              className={cn('h-8 px-3 rounded-full text-[13px] font-medium transition-all',
                datePreset === 'custom' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              )}>
              Custom
            </button>
          </div>
        {datePreset === 'custom' && (
          <div className="flex gap-2 items-center">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
            <span className="text-[13px] text-on-surface-variant">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        )}
        <div className="flex-1 max-w-xs ml-auto">
          <Input icon="search" placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Stock Levels View */}
      {view === 'stock' && (
        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_150px_70px_80px_80px_80px_80px_90px_130px_60px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
            <span>Product</span><span>Supplier</span><span>Unit</span><span className="text-right">Received</span><span className="text-right">Sold</span><span className="text-right">Adjusted</span><span className="text-right">Current</span><span className="text-right">Reorder</span><span>Last Received</span><span></span>
          </div>
          {filteredSummary.length === 0 ? (
            <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">No stock data available</div>
          ) : (
            filteredSummary.map((item: any, i: number) => {
              const isLow = item.current_stock <= item.reorder_level;
              return (
                <div key={i} className="grid grid-cols-[1fr_150px_70px_80px_80px_80px_80px_90px_130px_60px] gap-2 px-5 py-3 border-t border-outline-variant items-center hover:bg-surface-container-low transition-colors">
                  <span className="text-[14px] font-medium text-on-surface flex items-center gap-2">
                    {isLow && <span className="material-symbols-outlined text-[16px] text-error">warning</span>}
                    {item.item_name}
                  </span>
                  <span className="text-[13px] text-on-surface-variant truncate">{item.supplier_name || '—'}</span>
                  <span className="text-[13px] text-on-surface-variant">{item.unit}</span>
                  <span className="text-[13px] text-on-surface text-right">{item.total_in || 0}</span>
                  <span className="text-[13px] text-primary text-right">{item.total_sold || 0}</span>
                  <span className="text-[13px] text-on-surface-variant text-right">{item.total_used || 0}</span>
                  <span className={cn('text-[13px] font-semibold text-right', isLow ? 'text-error' : 'text-primary')}>
                    {item.current_stock || 0}
                  </span>
                  <span className="text-[12px] text-on-surface-variant text-right">{item.reorder_level || '—'}</span>
                  <span className="text-[12px] text-on-surface-variant">{item.last_received ? formatDateTime(item.last_received) : '—'}</span>
                  <button onClick={() => setReorder(item.menu_item_id, item.item_name, item.unit)} title="Set reorder level"
                    className="w-7 h-7 rounded-lg hover:bg-surface-container flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">settings</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Suggested Orders View */}
      {view === 'orders' && (
        <div className="space-y-4">
          <p className="text-[13px] text-on-surface-variant">Products at or below their reorder level. Place a purchase to restock from the linked supplier.</p>
          <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_150px_80px_80px_90px_130px_140px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
              <span>Product</span><span>Supplier</span><span className="text-right">On Hand</span><span className="text-right">Reorder At</span><span className="text-right">Suggested Qty</span><span>Last Received</span><span className="text-right">Action</span>
            </div>
            {suggestedOrders.length === 0 ? (
              <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">
                {search ? 'No products match your search' : 'All products are above their reorder level — nothing to order right now'}
              </div>
            ) : (
              suggestedOrders.map((item: any, i: number) => {
                const qtyNeeded = Math.max(0, Number(item.reorder_level || 0) - Number(item.current_stock || 0));
                return (
                  <div key={i} className="grid grid-cols-[1fr_150px_80px_80px_90px_130px_140px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
                    <span className="text-[14px] font-medium text-on-surface">{item.item_name}</span>
                    <span className="text-[13px] text-on-surface-variant truncate">{item.supplier_name || '—'}</span>
                    <span className="text-[13px] font-semibold text-error text-right">{item.current_stock || 0}</span>
                    <span className="text-[13px] text-on-surface-variant text-right">{item.reorder_level}</span>
                    <span className="text-[13px] font-semibold text-on-surface text-right">{qtyNeeded} {item.unit}</span>
                    <span className="text-[12px] text-on-surface-variant">{item.last_received ? formatDateTime(item.last_received) : '—'}</span>
                    <div className="text-right">
                      <Button size="sm" variant="primary" icon="add_shopping_cart"
                        disabled={!item.supplier_id}
                        title={item.supplier_id ? 'Record a purchase with this supplier' : 'No supplier linked'}
                        onClick={() => navigate('/suppliers')}>
                        Order
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Stock Valuation View */}
      {view === 'valuation' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[14px] text-on-surface-variant">Stock valuation = on-hand quantity × last purchase unit cost</p>
            <div className="px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold">
              Total: {formatCurrency(valuation?.totalValue || 0)}
            </div>
          </div>
          <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_100px_120px_140px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
              <span>Item</span><span>Unit</span><span className="text-right">On Hand</span><span className="text-right">Unit Cost</span><span className="text-right">Value</span>
            </div>
            {(valuation?.items || []).length === 0 ? (
              <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">No stock data available</div>
            ) : (
              (valuation?.items || []).map((item: any, i: number) => (
                <div key={i} className="grid grid-cols-[1fr_80px_100px_120px_140px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
                  <span className="text-[14px] font-medium text-on-surface">{item.item}</span>
                  <span className="text-[13px] text-on-surface-variant">{item.unit}</span>
                  <span className="text-[13px] text-on-surface text-right">{item.on_hand || 0}</span>
                  <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(item.unit_cost || 0)}</span>
                  <span className="text-[13px] font-semibold text-primary text-right">{formatCurrency(item.value || 0)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Stock History View */}
      {view === 'history' && (
        <>
          <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
            <div className="grid grid-cols-[160px_1fr_100px_1fr_120px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
              <span>Date & Time</span><span>Item Details</span><span className="text-right">Qty</span><span>Source / Supplier</span><span>Logged By</span>
            </div>
            {isLoading ? (
              <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">Loading...</div>
            ) : !stockEntries?.length ? (
              <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">No stock entries found</div>
            ) : (
              stockEntries.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[160px_1fr_100px_1fr_120px] gap-2 px-5 py-3 border-t border-outline-variant items-center hover:bg-surface-container-low transition-colors">
                  <span className="text-[13px] text-on-surface">{formatDateTime(entry.received_date)}</span>
                  <div>
                    <p className="text-[13px] font-medium text-on-surface">{entry.item_name}</p>
                    <p className="text-[11px] text-on-surface-variant">{entry.source}</p>
                  </div>
                  <span className={cn('text-[13px] font-semibold text-right', Number(entry.quantity) < 0 ? 'text-error' : 'text-on-surface')}>
                    {Number(entry.quantity) < 0 ? '' : '+'}{entry.quantity} {entry.unit}
                  </span>
                  <span className="text-[13px] text-on-surface-variant">{entry.supplier_name || '—'}</span>
                  <span className="text-[12px] text-on-surface-variant">{entry.logged_by_name || '—'}</span>
                </div>
              ))
            )}
          </div>
          <p className="text-[13px] text-on-surface-variant">{stockEntries?.length || 0} entries</p>
        </>
      )}

      {/* Add Stock Entry Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Stock Entry">
        <AddStockForm
          onSubmit={(data) => createMutation.mutate(data)}
          loading={createMutation.isPending}
          onClose={() => setShowModal(false)}
        />
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal open={showWasteModal} onClose={() => setShowWasteModal(false)} title="Stock Adjustment">
        <AdjustmentForm
          onSubmit={(data) => wasteMutation.mutate(data)}
          loading={wasteMutation.isPending}
          onClose={() => setShowWasteModal(false)}
        />
      </Modal>
    </div>
  );
}

function AddStockForm({ onSubmit, loading, onClose }: { onSubmit: (data: any) => void; loading: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: products } = useQuery({
    queryKey: ['menu:list'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('menu:list') as { success: boolean; data?: { id: number; name: string; unit: string; active: number; supplier_id?: number | null }[] };
      return (result.data || []).filter((p) => p.active !== 0);
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers:list'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('suppliers:list') as { success: boolean; data?: { id: number; name: string }[] };
      return result.data || [];
    },
  });

  const selectedProduct = products?.find((p) => String(p.id) === productId);

  const selectProduct = (id: string) => {
    setProductId(id);
    const p = products?.find((x) => String(x.id) === id);
    setUnit(p?.unit || 'pcs');
    if (p?.supplier_id) setSupplierId(String(p.supplier_id));
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Product</label>
        <select value={productId} onChange={(e) => selectProduct(e.target.value)}
          className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">Select a product...</option>
          {products?.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
        <div>
          <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Unit</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}
            className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="pcs">pcs</option><option value="kg">kg</option><option value="liters">liters</option><option value="boxes">boxes</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Supplier (optional)</label>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
          className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">None</option>
          {suppliers?.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
      </div>
      <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional details..." />
      <div className="flex gap-3 pt-2">
        <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
        <Button variant="primary" className="flex-1" loading={loading} disabled={!productId || !quantity}
          onClick={() => onSubmit({ item_name: selectedProduct?.name, menu_item_id: Number(productId), quantity: Number(quantity), unit, received_date: toLocalYMD(), supplier_id: supplierId ? Number(supplierId) : undefined, notes: notes || undefined, created_by: user?.id || 1 })}>
          Add Entry
        </Button>
      </div>
    </div>
  );
}

function AdjustmentForm({ onSubmit, loading, onClose }: { onSubmit: (data: any) => void; loading: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [reason, setReason] = useState('waste');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [notes, setNotes] = useState('');

  const OUT_REASONS = [
    { value: 'waste', label: 'Waste / Spoilage' },
    { value: 'damage', label: 'Damaged' },
    { value: 'theft', label: 'Theft / Lost' },
    { value: 'correction_out', label: 'Correction (reduce)' },
  ];
  const IN_REASONS = [
    { value: 'found', label: 'Found stock' },
    { value: 'adjust', label: 'Correction (increase)' },
  ];

  const { data: products } = useQuery({
    queryKey: ['menu:list'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('menu:list') as { success: boolean; data?: { id: number; name: string; unit: string; active: number }[] };
      return (result.data || []).filter((p) => p.active !== 0);
    },
  });

  const selectedProduct = products?.find((p) => String(p.id) === productId);

  const selectProduct = (id: string) => {
    setProductId(id);
    const p = products?.find((x) => String(x.id) === id);
    setUnit(p?.unit || 'pcs');
  };

  const changeDirection = (dir: 'out' | 'in') => {
    setDirection(dir);
    setReason(dir === 'out' ? 'waste' : 'adjust');
  };

  const submit = () => {
    const qty = Math.abs(Number(quantity) || 0);
    if (qty <= 0) return;
    onSubmit({
      item_name: selectedProduct?.name,
      menu_item_id: Number(productId),
      quantity: qty,
      unit,
      direction,
      received_date: toLocalYMD(),
      source: reason,
      notes: notes || undefined,
      created_by: user?.id || 1,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Direction</label>
        <div className="flex gap-2">
          <button
            onClick={() => changeDirection('out')}
            className={cn('flex-1 h-[44px] rounded-lg border text-[14px] font-medium transition-all',
              direction === 'out' ? 'bg-error-container border-error text-error' : 'bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-container')}
          >
            Stock Out (damaged / lost)
          </button>
          <button
            onClick={() => changeDirection('in')}
            className={cn('flex-1 h-[44px] rounded-lg border text-[14px] font-medium transition-all',
              direction === 'in' ? 'bg-primary-container border-primary text-primary' : 'bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-container')}
          >
            Stock In (surplus / found)
          </button>
        </div>
      </div>
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Reason</label>
        <select value={reason} onChange={(e) => setReason(e.target.value)}
          className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
          {(direction === 'out' ? OUT_REASONS : IN_REASONS).map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Product</label>
        <select value={productId} onChange={(e) => selectProduct(e.target.value)}
          className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">Select a product...</option>
          {products?.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
        <div>
          <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Unit</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}
            className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="pcs">pcs</option><option value="kg">kg</option><option value="liters">liters</option><option value="boxes">boxes</option>
          </select>
        </div>
      </div>
      <Input label="Reason (required)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Damaged in transit, missing stock found" />
      <div className="flex gap-3 pt-2">
        <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
        <Button variant={direction === 'out' ? 'danger' : 'primary'} className="flex-1" loading={loading} disabled={!productId || !quantity || !notes}
          onClick={submit}>
          {direction === 'out' ? 'Record Stock Out' : 'Record Stock In'}
        </Button>
      </div>
    </div>
  );
}
