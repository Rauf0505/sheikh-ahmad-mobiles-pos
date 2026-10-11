import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIpcQuery } from '../hooks/useDB';
import { useToast } from '../components/ui/Toast';
import { formatCurrency, formatDateTime, toLocalYMD, cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { PriceHistory } from '../components/PriceHistory';
import type { Supplier, Purchase } from '../types';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info'> = {
  paid: 'success',
  partial: 'warning',
  partially_returned: 'warning',
  unpaid: 'info',
  returned: 'info',
};

function openInvoicesOf(purchases?: Purchase[]) {
  return (purchases || []).filter((p) => {
    const due = (p.total_amount || 0) - (p.paid_amount || 0) - ((p as any).returned_amount || 0);
    return p.status !== 'paid' && p.status !== 'returned' && due > 0;
  });
}

export function SuppliersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingSupplier, setDeletingSupplier] = useState<any>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [returnPurchase, setReturnPurchase] = useState<any>(null);
  const [historyProduct, setHistoryProduct] = useState<any>(null);

  const { data: suppliers } = useIpcQuery<Supplier[]>('suppliers:list', 'suppliers:list');
  const { data: selectedSupplier } = useIpcQuery<any>('suppliers:get', 'suppliers:get', selectedId);

  const filtered = (suppliers || []).filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.contact_phone?.includes(search)
  );

  const refreshSupplier = () => {
    queryClient.invalidateQueries({ queryKey: ['suppliers:list'] });
    if (selectedId) queryClient.invalidateQueries({ queryKey: ['suppliers:get', selectedId] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('suppliers:create', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers:list'] });
      setShowAddModal(false);
      toast.success('Supplier added');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add supplier'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const result = await window.electronAPI.invoke('suppliers:update', id, data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      refreshSupplier();
      setEditingSupplier(null);
      toast.success('Supplier updated');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update supplier'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await window.electronAPI.invoke('suppliers:delete', id) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers:list'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers:get', selectedId] });
      if (deletingSupplier?.id === selectedId) setSelectedId(null);
      setShowDeleteModal(false);
      setDeletingSupplier(null);
      toast.success('Supplier deactivated');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to delete supplier'),
  });

  const purchaseMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('purchases:create', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      refreshSupplier();
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
      queryClient.invalidateQueries({ queryKey: ['stock:list'] });
      queryClient.invalidateQueries({ queryKey: ['menu:list'] });
      queryClient.invalidateQueries({ queryKey: ['reports:supplier-payables'] });
      setShowPurchaseModal(false);
      toast.success('Purchase recorded');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to record purchase'),
  });

  const paymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('supplier-payments:create', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      refreshSupplier();
      queryClient.invalidateQueries({ queryKey: ['reports:supplier-payables'] });
      setShowPaymentModal(false);
      toast.success('Payment recorded');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to record payment'),
  });

  const returnMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('purchases:return', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      refreshSupplier();
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
      queryClient.invalidateQueries({ queryKey: ['stock:list'] });
      queryClient.invalidateQueries({ queryKey: ['reports:supplier-payables'] });
      setReturnPurchase(null);
      toast.success('Purchase return recorded');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to record return'),
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Supplier List */}
      <div className="w-[340px] shrink-0 bg-surface border-r border-outline-variant flex flex-col">
        <div className="px-4 py-4 border-b border-outline-variant">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[18px] font-semibold text-on-surface">Suppliers</h2>
            <Button variant="primary" size="sm" icon="add" onClick={() => setShowAddModal(true)}>Add</Button>
          </div>
          <Input icon="search" placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((supplier) => (
            <button
              key={supplier.id}
              onClick={() => setSelectedId(supplier.id)}
              className={cn(
                'w-full text-left px-4 py-3 border-b border-outline-variant transition-colors',
                selectedId === supplier.id
                  ? 'bg-surface-container-low border-l-4 border-l-primary'
                  : 'hover:bg-surface-container-low border-l-4 border-l-transparent'
              )}
            >
              <p className="text-[14px] font-semibold text-on-surface">{supplier.name}</p>
              <p className="text-[12px] text-on-surface-variant mt-0.5">{supplier.contact_phone || 'No phone'}</p>
              {supplier.outstanding_balance != null && supplier.outstanding_balance !== 0 && (
                <p className="text-[12px] font-semibold text-error mt-1">
                  Outstanding: {formatCurrency(supplier.outstanding_balance)}
                </p>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-[14px] text-on-surface-variant">No suppliers found</div>
          )}
        </div>
      </div>

      {/* Right: Supplier Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedSupplier ? (
          <div className="flex flex-col items-center justify-center h-full text-on-surface-variant gap-3">
            <span className="material-symbols-outlined text-[48px]">local_shipping</span>
            <p className="text-[16px]">Select a supplier to view details</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-[24px] font-bold text-on-surface">{selectedSupplier.name}</h1>
                <div className="text-[14px] text-on-surface-variant mt-1 space-y-0.5">
                  {selectedSupplier.contact_phone && <p>{selectedSupplier.contact_phone}</p>}
                  {selectedSupplier.email && <p>{selectedSupplier.email}</p>}
                  {selectedSupplier.address && <p>{selectedSupplier.address}</p>}
                  {selectedSupplier.gstin && <p className="text-[12px] font-mono">NTN: {selectedSupplier.gstin}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" icon="edit" onClick={() => setEditingSupplier(selectedSupplier)}>Edit</Button>
                <Button variant="secondary" icon="payments" onClick={() => setShowPaymentModal(true)}>Record Payment</Button>
                <Button variant="primary" icon="add_shopping_cart" onClick={() => setShowPurchaseModal(true)}>Record Purchase</Button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <Card>
                <p className="text-[12px] font-medium text-on-surface-variant uppercase">Outstanding</p>
                <p className="text-[22px] font-bold text-error mt-1">{formatCurrency(selectedSupplier.outstanding_balance || 0)}</p>
              </Card>
              <Card>
                <p className="text-[12px] font-medium text-on-surface-variant uppercase">Products Supplied</p>
                <p className="text-[22px] font-bold text-on-surface mt-1">{selectedSupplier.product_count ?? selectedSupplier.products?.length ?? 0}</p>
              </Card>
              <Card>
                <p className="text-[12px] font-medium text-on-surface-variant uppercase">Units Received</p>
                <p className="text-[22px] font-bold text-on-surface mt-1">{selectedSupplier.stats?.total_units ?? 0}</p>
                <p className="text-[11px] text-on-surface-variant mt-1">{selectedSupplier.stats?.purchase_count ?? 0} purchase(s)</p>
              </Card>
              <Card>
                <p className="text-[12px] font-medium text-on-surface-variant uppercase">Last Purchase</p>
                {selectedSupplier.stats?.last_purchase_date ? (
                  <p className="text-[22px] font-bold text-on-surface mt-1">{formatDateTime(selectedSupplier.stats.last_purchase_date)}</p>
                ) : (
                  <p className="text-[22px] font-bold text-on-surface-variant mt-1">—</p>
                )}
              </Card>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[16px] font-semibold text-on-surface">Products Supplied</h3>
                <span className="text-[12px] text-on-surface-variant">Cost = latest purchase rate · click price icon for history</span>
              </div>
              <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px_70px_70px_70px_110px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
                  <span>Product</span><span className="text-right">Retail</span><span className="text-right">Wholesale</span><span className="text-right">Cost</span><span className="text-right">On Hand</span><span className="text-right">Reorder</span><span className="text-right">Status</span>
                </div>
                {selectedSupplier.products?.length === 0 || !selectedSupplier.products ? (
                  <div className="px-5 py-6 text-center text-[13px] text-on-surface-variant">No products linked to this supplier yet</div>
                ) : (
                  selectedSupplier.products.map((prod: any) => {
                    const low = !!prod.reorder_level && (prod.on_hand || 0) <= prod.reorder_level;
                    return (
                      <div key={prod.menu_item_id} className="grid grid-cols-[1fr_80px_80px_70px_70px_70px_110px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-on-surface truncate">{prod.name}</p>
                          <p className="text-[12px] text-on-surface-variant">{prod.unit || 'pcs'}{prod.last_received ? ` · Received ${formatDateTime(prod.last_received)}` : ''}</p>
                        </div>
                        <span className="text-[13px] text-on-surface text-right">{formatCurrency(prod.retail_price ?? prod.retail ?? 0)}</span>
                        <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(prod.wholesale_price ?? prod.wholesale ?? 0)}</span>
                        <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(prod.cost_price || prod.last_purchase_rate || 0)}</span>
                        <span className="text-[13px] font-semibold text-right">{prod.on_hand ?? '—'}</span>
                        <span className="text-[13px] text-on-surface-variant text-right">{prod.reorder_level ?? '—'}</span>
                        <div className="flex items-center justify-end gap-1">
                          {low ? <Badge variant="warning" size="sm">Reorder</Badge> : <Badge variant="success" size="sm">OK</Badge>}
                          <button
                            onClick={() => setHistoryProduct(prod)}
                            title="Price history"
                            className="w-7 h-7 rounded-lg hover:bg-surface-container flex items-center justify-center">
                            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">history</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <h3 className="text-[16px] font-semibold text-on-surface mb-3">Purchase Ledger</h3>
              <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                <div className="grid grid-cols-[110px_1fr_110px_110px_140px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
                  <span>Date</span><span>Invoice Ref</span><span className="text-right">Amount</span><span className="text-right">Paid</span><span className="text-right">Status</span>
                </div>
                {selectedSupplier.purchases?.length === 0 ? (
                  <div className="px-5 py-6 text-center text-[13px] text-on-surface-variant">No purchases recorded</div>
                ) : (
                  selectedSupplier.purchases?.map((purchase: any) => {
                    const status = STATUS_VARIANT[purchase.status] || 'info';
                    return (
                      <div key={purchase.id} className="grid grid-cols-[110px_1fr_110px_110px_140px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
                        <span className="text-[13px] text-on-surface">{formatDateTime(purchase.purchase_date)}</span>
                        <span className="text-[13px] text-on-surface-variant">
                          {purchase.invoice_no || `Purchase #${purchase.id}`}
                          {(purchase.discount_amount || 0) > 0 && (
                            <span className="text-[11px] text-primary ml-2">− discount {formatCurrency(purchase.discount_amount)}</span>
                          )}
                          {(purchase.returned_amount || 0) > 0 && (
                            <span className="text-[11px] text-error ml-2">Returned {formatCurrency(purchase.returned_amount)}</span>
                          )}
                        </span>
                        <span className="text-[13px] font-semibold text-on-surface text-right">
                          {formatCurrency(purchase.total_amount)}
                          {(purchase.discount_amount || 0) > 0 && purchase.gross_amount ? (
                            <span className="block text-[11px] font-normal text-on-surface-variant line-through">{formatCurrency(purchase.gross_amount)}</span>
                          ) : null}
                        </span>
                        <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(purchase.paid_amount || 0)}</span>
                        <div className="flex items-center justify-end gap-1">
                          <Badge variant={status}>{purchase.status.replace(/_/g, ' ')}</Badge>
                          {purchase.status !== 'returned' && (
                            <button
                              onClick={() => setReturnPurchase(purchase)}
                              title="Return items from this purchase"
                              className="w-7 h-7 rounded-lg hover:bg-error-container flex items-center justify-center">
                              <span className="material-symbols-outlined text-[16px] text-error">undo</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {selectedSupplier.returns?.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-[14px] font-semibold text-on-surface mb-2">Returns</h3>
                  <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[110px_1fr_110px_1fr] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
                      <span>Date</span><span>Reference</span><span className="text-right">Amount</span><span>Notes</span>
                    </div>
                    {selectedSupplier.returns.map((r: any) => (
                      <div key={r.id} className="grid grid-cols-[110px_1fr_110px_1fr] gap-2 px-5 py-3 border-t border-outline-variant items-center">
                        <span className="text-[13px] text-on-surface">{formatDateTime(r.return_date)}</span>
                        <span className="text-[13px] text-on-surface-variant">Purchase #{r.purchase_id}</span>
                        <span className="text-[13px] font-semibold text-error text-right">{formatCurrency(r.total_amount)}</span>
                        <span className="text-[13px] text-on-surface-variant truncate">{r.notes || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Supplier Modal */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add Supplier">
        <SupplierForm
          onSubmit={(data) => createMutation.mutate(data)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit Supplier Modal */}
      <Modal open={!!editingSupplier} onClose={() => setEditingSupplier(null)} title="Edit Supplier">
        {editingSupplier && (
          <SupplierForm
            initial={editingSupplier}
            onSubmit={(data) => updateMutation.mutate({ id: editingSupplier.id, ...data })}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      {/* Delete Supplier Modal */}
      <Modal open={showDeleteModal} onClose={() => { setShowDeleteModal(false); setDeletingSupplier(null); }} title="Delete Supplier">
        <div className="space-y-4 min-w-[980px]">
          <p className="text-[14px] text-on-surface">
            Are you sure you want to delete <strong>{deletingSupplier?.name}</strong>? This will deactivate the supplier. Existing purchase records will be preserved.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setDeletingSupplier(null); }}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deletingSupplier && deleteMutation.mutate(deletingSupplier.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal open={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Record Payment">
        <RecordPaymentForm
          supplier={selectedSupplier}
          onSubmit={(data) => paymentMutation.mutate(data)}
          loading={paymentMutation.isPending}
        />
      </Modal>

      {/* Record Purchase Modal */}
      <Modal open={showPurchaseModal} onClose={() => setShowPurchaseModal(false)} title="Record Purchase" size="lg">
        <RecordPurchaseForm
          supplierId={selectedId!}
          onSubmit={(data) => purchaseMutation.mutate(data)}
          loading={purchaseMutation.isPending}
        />
      </Modal>

      {/* Purchase Return Modal */}
      <Modal open={!!returnPurchase} onClose={() => setReturnPurchase(null)} title={`Return Items — ${returnPurchase?.invoice_no || `Purchase #${returnPurchase?.id}`}`} size="lg">
        {returnPurchase && (
          <PurchaseReturnForm
            purchase={returnPurchase}
            onSubmit={(data) => returnMutation.mutate(data)}
            loading={returnMutation.isPending}
            onClose={() => setReturnPurchase(null)}
          />
        )}
      </Modal>

      {/* Price History Modal */}
      <Modal open={!!historyProduct} onClose={() => setHistoryProduct(null)} title={historyProduct ? `Price History — ${historyProduct.name}` : 'Price History'}>
        {historyProduct && <PriceHistory menuItemId={historyProduct.menu_item_id} />}
      </Modal>
    </div>
  );
}

function SupplierForm({
  initial,
  onSubmit,
  loading,
}: {
  initial?: any;
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.contact_phone || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [gstin, setGstin] = useState(initial?.gstin || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  return (
    <div className="space-y-4 w-full max-w-full">
      <Input label="Supplier Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" />
      <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300-1234567" />
      <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="supplier@example.com" />
      <Input label="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Supplier address" />
      <Input label="NTN (optional)" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="NTN Registration Number" />
      <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." />
      <Button
        variant="primary"
        className="w-full"
        loading={loading}
        disabled={!name}
        onClick={() => onSubmit({
          name,
          contact_phone: phone || null,
          address: address || null,
          email: email || null,
          gstin: gstin || null,
          notes: notes || null,
        })}
      >
        {initial ? 'Save Changes' : 'Add Supplier'}
      </Button>
    </div>
  );
}

function RecordPaymentForm({ supplier, onSubmit, loading }: { supplier: any; onSubmit: (data: any) => void; loading: boolean }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [purchaseId, setPurchaseId] = useState('');
  const [notes, setNotes] = useState('');

  const open = openInvoicesOf(supplier?.purchases);

  return (
    <div className="space-y-4 w-full max-w-full">
      <Input label="Amount" type="number" prefix="Rs." value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Apply To</label>
        <select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}
          className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">Oldest unpaid invoice (auto)</option>
          {open.map((p) => {
            const due = (p.total_amount || 0) - (p.paid_amount || 0) - ((p as any).returned_amount || 0);
            return (
              <option key={p.id} value={p.id}>
                {p.invoice_no || `Purchase #${p.id}`} — due {formatCurrency(due)}
              </option>
            );
          })}
        </select>
        {open.length === 0 && (
          <p className="text-[12px] text-on-surface-variant mt-1">No open invoices — this supplier has no outstanding balance</p>
        )}
      </div>
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Payment Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="cheque">Cheque</option>
        </select>
      </div>
      <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference note..." />
      <Button variant="primary" className="w-full" loading={loading} disabled={!amount || Number(amount) <= 0}
        onClick={() => onSubmit({ supplier_id: supplier.id, purchase_id: purchaseId ? Number(purchaseId) : null, amount: Number(amount), payment_date: toLocalYMD(), method, notes: notes || undefined })}
      >
        Record Payment
      </Button>
    </div>
  );
}

function RecordPurchaseForm({ supplierId, onSubmit, loading }: { supplierId: number; onSubmit: (data: any) => void; loading: boolean }) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(toLocalYMD());
  const [notes, setNotes] = useState('');
  const [updateCost, setUpdateCost] = useState(true);
  const [applyPrices, setApplyPrices] = useState(false);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [items, setItems] = useState([{ menu_item_id: undefined as number | undefined, item_name: '', quantity: 1, unit: 'pcs', rate: 0 }]);

  interface MenuProduct {
    id: number;
    name: string;
    unit: string;
    active: number;
    unit_cost?: number;
    wholesale_price?: number;
  }

  const { data: products } = useIpcQuery<MenuProduct[]>('menu:list', 'menu:list');

  const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
  const gross = Math.round(total * 100) / 100;
  const discountAmount = discountType === 'percent'
    ? Math.round(gross * (Math.max(0, Number(discountValue) || 0) / 100) * 100) / 100
    : Math.round(Math.max(0, Number(discountValue) || 0) * 100) / 100;
  const appliedDiscount = Math.min(discountAmount, gross);
  const net = Math.round((gross - appliedDiscount) * 100) / 100;

  const updateItem = (i: number, field: string, value: any) => {
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it));
  };

  const selectProduct = (i: number, id: string) => {
    const p = (products || []).find((x) => String(x.id) === id);
    setItems((prev) => prev.map((it, idx) => idx === i
      ? { ...it, menu_item_id: p?.id, item_name: p?.name || '', unit: p?.unit || 'pcs', rate: it.rate || p?.unit_cost || p?.wholesale_price || 0 }
      : it));
  };

  const clearProduct = (i: number) => {
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, menu_item_id: undefined, item_name: '', unit: 'pcs' } : it));
  };

  const addItem = () => setItems((prev) => [...prev, { menu_item_id: undefined, item_name: '', quantity: 1, unit: 'pcs', rate: 0 }]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const validItems = items.filter((it) => it.item_name.trim() && Number(it.quantity) > 0 && Number(it.rate) >= 0);

  return (
    <div className="space-y-4 w-full max-w-full">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Invoice/Ref No. (optional)</label>
          <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-001"
            className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Purchase Date</label>
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)}
            className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[14px] font-semibold text-on-surface-variant">Line Items</label>
          <button onClick={addItem} className="text-[12px] font-medium text-primary flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">add_circle</span> Add Item
          </button>
        </div>
        <div className="bg-surface rounded-lg border border-outline-variant overflow-hidden w-full">
          <div className="grid grid-cols-[2fr_110px_100px_150px_170px_48px] gap-2 px-3 py-2 bg-surface-container text-[11px] font-semibold text-on-surface-variant uppercase whitespace-nowrap">
            <span>Product</span>
            <span>Quantity</span>
            <span>Unit</span>
            <span>Buying Rate (Rs./unit)</span>
            <span className="text-right w-full">Line Amount (Rs.)</span>
            <span></span>
          </div>
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-[2fr_110px_100px_150px_170px_48px] gap-2 px-3 py-2 border-t border-outline-variant items-start">
              <div className="flex flex-col">
                <label className="text-[11px] font-medium text-on-surface-variant mb-1">Product</label>
                <select
                  value={String(item.menu_item_id ?? '')}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id === '') clearProduct(i);
                    else selectProduct(i, id);
                  }}
                  className="h-9 px-2 rounded-md border border-outline-variant bg-surface text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select product...</option>
                  {(products || []).filter((p) => p.active !== 0).map((p) => (
                    <option key={p.id} value={String(p.id)}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-[11px] font-medium text-on-surface-variant mb-1">Quantity</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))}
                  className="h-9 px-2 rounded-md border border-outline-variant bg-surface text-[13px] text-right focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[11px] font-medium text-on-surface-variant mb-1">Unit</label>
                <select
                  value={item.unit}
                  onChange={(e) => updateItem(i, 'unit', e.target.value)}
                  className="h-9 px-2 rounded-md border border-outline-variant bg-surface text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {['pcs', 'kg', 'g', 'ltr', 'dozen', 'pack', 'box', 'bag'].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-[11px] font-medium text-on-surface-variant mb-1">Buying Rate (Rs./unit)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.rate}
                  onChange={(e) => updateItem(i, 'rate', Number(e.target.value))}
                  className="h-9 px-2 rounded-md border border-outline-variant bg-surface text-[13px] text-right focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col items-end justify-center">
                <label className="text-[11px] font-medium text-on-surface-variant mb-1">Line Amount (Rs.)</label>
                <span className="text-[13px] font-medium text-on-surface pr-1">
                  {formatCurrency(Math.round((Number(item.quantity) || 0) * (Number(item.rate) || 0) * 100) / 100)}
                </span>
              </div>
              <button
                onClick={() => removeItem(i)}
                disabled={items.length === 1}
                className="w-9 h-9 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-error-container hover:text-error disabled:opacity-30 transition-colors mt-5"
                title="Remove item"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 bg-surface-container rounded-xl p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="w-4 h-4 accent-primary" />
          <span className="text-[13px] text-on-surface">Update product cost to the new rate</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={applyPrices} onChange={(e) => setApplyPrices(e.target.checked)} className="w-4 h-4 accent-primary" />
          <span className="text-[13px] text-on-surface">Also set retail &amp; wholesale price to the new rate</span>
        </label>
        <p className="text-[11px] text-on-surface-variant pl-6">
          When enabled, the new buying rate will update the product's cost price. Applying to retail/wholesale overrides those prices to match the rate.
        </p>
      </div>

      <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Purchase details..." />

      <div className="space-y-2 bg-surface-container rounded-xl p-3">
        <label className="text-[13px] font-semibold text-on-surface-variant block">
          Supplier Discount (given to us)
          <span className="block text-[11px] font-normal text-on-surface-variant mt-0.5">
            This reduces the amount payable to the supplier. Product cost price stays unchanged.
          </span>
        </label>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-outline-variant overflow-hidden">
            {(['amount', 'percent'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setDiscountType(t)}
                className={cn('px-3 h-9 text-[13px] font-medium transition-colors',
                  discountType === t ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant hover:bg-surface-container-high')}>
                {t === 'amount' ? 'Rs' : '%'}
              </button>
            ))}
          </div>
          <input type="number" min="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
            placeholder={discountType === 'percent' ? 'e.g. 5' : 'e.g. 500'}
            className="flex-1 h-9 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Discount value" />
        </div>
        <p className="text-[11px] text-on-surface-variant">The supplier gives this discount to us. It lowers the amount we owe them — product cost stays at the line rate.</p>
      </div>

      <div className="space-y-1 py-2 border-t border-outline-variant">
        <div className="flex justify-between text-[13px]">
          <span className="text-on-surface-variant">Gross total (sum of line amounts)</span>
          <span className="text-on-surface">{formatCurrency(gross)}</span>
        </div>
        {appliedDiscount > 0 && (
          <div className="flex justify-between text-[13px]">
            <span className="text-on-surface-variant">Less: Supplier discount (−)</span>
            <span className="text-error">− {formatCurrency(appliedDiscount)}</span>
          </div>
        )}
        <div className="flex justify-between text-[15px] pt-1">
          <span className="font-semibold text-on-surface">Net payable to supplier</span>
          <span className="font-bold text-on-surface">{formatCurrency(net)}</span>
        </div>
      </div>

      <Button variant="primary" className="w-full" loading={loading} disabled={validItems.length === 0 || gross <= 0}
        onClick={() => onSubmit({
          supplier_id: supplierId,
          invoice_no: invoiceNo || undefined,
          purchase_date: purchaseDate,
          notes: notes || undefined,
          update_cost: updateCost,
          apply_prices: applyPrices,
          discount_type: discountType,
          discount_value: Math.max(0, Number(discountValue) || 0),
          items: validItems.map((it) => ({ menu_item_id: it.menu_item_id, item_name: it.item_name, quantity: Number(it.quantity), unit: it.unit, rate: Number(it.rate) })),
        })}
      >
        Save Purchase
      </Button>
    </div>
  );
}

function PurchaseReturnForm({ purchase, onSubmit, loading, onClose }: { purchase: any; onSubmit: (data: any) => void; loading: boolean; onClose: () => void }) {
  const [returnDate, setReturnDate] = useState(toLocalYMD());
  const [notes, setNotes] = useState('');
  const [qtyMap, setQtyMap] = useState<Record<number, number>>({});

  const { data } = useQuery({
    queryKey: ['purchases:get', purchase.id],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('purchases:get', purchase.id) as { success: boolean; data?: any };
      return result.data;
    },
  });

  const items = data?.items || [];

  const setReturnQty = (id: number, qty: number) => {
    const it = items.find((x: any) => x.id === id);
    if (!it) return;
    const max = it.quantity - it.returned_qty;
    const clamped = Math.max(0, Math.min(Math.floor(qty), max));
    setQtyMap((prev) => ({ ...prev, [id]: clamped }));
  };

  const returnable = items.filter((it: any) => it.quantity - it.returned_qty > 0);
  const selected = returnable.filter((it: any) => (qtyMap[it.id] || 0) > 0);
  const total = selected.reduce((sum: number, it: any) => sum + (qtyMap[it.id] || 0) * it.rate, 0);

  return (
    <div className="space-y-4 w-full max-w-full">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Return Date</label>
          <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)}
            className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Purchase</label>
          <div className="h-[44px] rounded-lg border border-outline-variant bg-surface-container px-4 flex items-center text-[14px] text-on-surface">
            {purchase.invoice_no || `Purchase #${purchase.id}`}
          </div>
        </div>
      </div>

      {returnable.length === 0 ? (
        <p className="text-[13px] text-on-surface-variant py-4 text-center">No returnable quantities left on this purchase.</p>
      ) : (
        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_80px_80px_90px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
            <span>Item</span><span className="text-right">Rate</span><span className="text-right">Remaining</span><span className="text-right">Qty to Return</span>
          </div>
          {returnable.map((it: any) => {
            const remaining = it.quantity - it.returned_qty;
            return (
              <div key={it.id} className="grid grid-cols-[1fr_80px_80px_90px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
                <span className="text-[13px] font-medium text-on-surface">{it.product_name || it.item_name}</span>
                <span className="text-[13px] text-on-surface-variant text-right">{formatCurrency(it.rate)}</span>
                <span className="text-[13px] text-on-surface-variant text-right">{remaining} {it.unit || 'pcs'}</span>
                <input type="number" min={0} max={remaining} value={qtyMap[it.id] || 0}
                  onChange={(e) => setReturnQty(it.id, Number(e.target.value))}
                  className="w-full h-8 px-3 rounded-md border border-outline-variant bg-surface text-[13px] text-right focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            );
          })}
        </div>
      )}

      <Input label="Reason / Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Damaged stock returned" />

      <div className="flex justify-between text-[14px] py-2 border-t border-outline-variant">
        <span className="text-on-surface-variant">Return Total</span>
        <span className="font-bold text-error">{formatCurrency(total)}</span>
      </div>

      <div className="flex gap-3">
        <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
        <Button variant="danger" className="flex-1" loading={loading} disabled={selected.length === 0 || total <= 0}
          onClick={() => onSubmit({
            purchase_id: purchase.id,
            return_date: returnDate,
            notes: notes || undefined,
            items: selected.map((it: any) => ({ purchase_item_id: it.id, menu_item_id: it.menu_item_id, item_name: it.product_name || it.item_name, quantity: qtyMap[it.id] || 0, rate: it.rate })),
          })}
        >
          Record Return
        </Button>
      </div>
    </div>
  );
}
