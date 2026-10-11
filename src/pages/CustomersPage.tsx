import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpcQuery } from '../hooks/useDB';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ui/Toast';
import { formatCurrency, formatDateTime, toLocalYMD, cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import type { Customer, CustomerLedgerEntry, MenuItem } from '../types';

export function CustomersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<any>(null);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [search, setSearch] = useState('');

  const { data: customers } = useIpcQuery<Customer[]>('customers:list', 'customers:list');
  const { data: selectedCustomer } = useQuery({
    queryKey: ['customers:get', selectedId],
    queryFn: async () => {
      if (!selectedId) return null;
      const result = await window.electronAPI.invoke('customers:get', selectedId) as {
        success: boolean;
        data?: Customer & { ledger: Array<CustomerLedgerEntry & { running_balance: number }> };
      };
      return result.data || null;
    },
    enabled: !!selectedId,
  });

  const { data: ordersData } = useIpcQuery<{ rows: any[]; total: number }>('orders:list', 'orders:list');
  const allOrders = ordersData?.rows || [];
  const customerOrders = allOrders.filter((o) => o.customer_id === selectedId);

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('customers:create', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers:list'] });
      toast.success('Customer added');
      setShowAddModal(false);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add customer'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const result = await window.electronAPI.invoke('customers:update', id, data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers:list'] });
      if (selectedId) queryClient.invalidateQueries({ queryKey: ['customers:get', selectedId] });
      toast.success('Customer updated');
      setEditingCustomer(null);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update customer'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await window.electronAPI.invoke('customers:delete', id) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers:list'] });
      if (deletingCustomer?.id === selectedId) setSelectedId(null);
      toast.success('Customer deactivated');
      setShowDeleteModal(false);
      setDeletingCustomer(null);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to delete customer'),
  });

  const creditMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('pos:checkout', data) as { success: boolean; data?: { billId: number; orderId: number }; error?: string };
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers:get', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['customers:list'] });
      queryClient.invalidateQueries({ queryKey: ['orders:list'] });
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
      toast.success('Credit sale recorded');
      setShowCreditModal(false);
    },
    onError: (e: any) => toast.error(e.message || 'Credit sale failed'),
  });

  const paymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('customer-ledger:create', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers:get', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['customers:list'] });
      toast.success('Payment received');
      setShowPaymentModal(false);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to record payment'),
  });

  const filtered = (customers || []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search));

  const creditUsed = selectedCustomer?.ledger
    ?.filter((e) => e.type === 'credit')
    .reduce((s, e) => s + e.amount, 0) || 0;
  const creditPaid = selectedCustomer?.ledger
    ?.filter((e) => e.type === 'payment')
    .reduce((s, e) => s + e.amount, 0) || 0;
  const outstanding = selectedCustomer?.outstanding_balance ?? (creditUsed - creditPaid);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Customer List */}
      <div className="w-[340px] shrink-0 bg-surface border-r border-outline-variant flex flex-col">
        <div className="px-4 py-4 border-b border-outline-variant">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[18px] font-semibold text-on-surface">Customers</h2>
            <Button variant="primary" size="sm" icon="person_add" onClick={() => setShowAddModal(true)}>Add</Button>
          </div>
          <Input icon="search" placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((customer) => (
            <button
              key={customer.id}
              onClick={() => setSelectedId(customer.id)}
              className={cn(
                'w-full text-left px-4 py-3 border-b border-outline-variant transition-colors',
                selectedId === customer.id
                  ? 'bg-surface-container-low border-l-4 border-l-primary'
                  : 'hover:bg-surface-container-low border-l-4 border-l-transparent'
              )}
            >
              <p className="text-[14px] font-semibold text-on-surface">{customer.name}</p>
              <p className="text-[12px] text-on-surface-variant mt-0.5">{customer.phone || 'No phone'}</p>
              {customer.outstanding_balance != null && customer.outstanding_balance !== 0 && (
                <p className={cn('text-[12px] font-semibold mt-1', customer.outstanding_balance > 0 ? 'text-error' : 'text-primary')}>
                  Balance: {formatCurrency(customer.outstanding_balance)}
                </p>
              )}
            </button>
          ))}
          {(!customers || customers.length === 0) && (
            <div className="px-4 py-8 text-center text-[14px] text-on-surface-variant">No customers found</div>
          )}
        </div>
      </div>

      {/* Right: Customer Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedCustomer ? (
          <div className="flex flex-col items-center justify-center h-full text-on-surface-variant gap-3">
            <span className="material-symbols-outlined text-[48px]">groups</span>
            <p className="text-[16px]">Select a customer to view details</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-[24px] font-bold text-on-surface">{selectedCustomer.name}</h1>
                <div className="text-[14px] text-on-surface-variant mt-1 space-y-0.5">
                  {selectedCustomer.phone && <p>{selectedCustomer.phone}</p>}
                  {selectedCustomer.email && <p>{selectedCustomer.email}</p>}
                  {selectedCustomer.address && <p>{selectedCustomer.address}</p>}
                  {selectedCustomer.credit_limit > 0 && (
                    <p className="text-[12px] text-on-surface-variant">Credit Limit: <span className="font-semibold text-on-surface">{formatCurrency(selectedCustomer.credit_limit)}</span></p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" icon="edit" onClick={() => setEditingCustomer(selectedCustomer)}>Edit</Button>
                <Button variant="secondary" icon="delete" onClick={() => { setDeletingCustomer(selectedCustomer); setShowDeleteModal(true); }}>Delete</Button>
                <Button variant="secondary" icon="payments" onClick={() => setShowPaymentModal(true)}>Record Payment</Button>
                <Button variant="primary" icon="add_card" onClick={() => setShowCreditModal(true)}>Record Credit Sale</Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Card>
                <p className="text-[12px] font-medium text-on-surface-variant uppercase">Outstanding Balance</p>
                <p className={cn('text-[24px] font-bold mt-1', outstanding > 0 ? 'text-error' : 'text-primary')}>
                  {formatCurrency(outstanding)}
                </p>
              </Card>
              <Card>
                <p className="text-[12px] font-medium text-on-surface-variant uppercase">Total Credit Sales</p>
                <p className="text-[24px] font-bold text-on-surface mt-1">{formatCurrency(creditUsed)}</p>
              </Card>
              <Card>
                <p className="text-[12px] font-medium text-on-surface-variant uppercase">Payments Received</p>
                <p className="text-[24px] font-bold text-primary mt-1">{formatCurrency(creditPaid)}</p>
              </Card>
            </div>

            <div>
              <h3 className="text-[16px] font-semibold text-on-surface mb-3">Ledger</h3>
              <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                <div className="grid grid-cols-[140px_1fr_100px_90px_120px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
                  <span>Date</span><span>Description</span><span className="text-right">Amount</span><span>Type</span><span className="text-right">Balance</span>
                </div>
                {selectedCustomer.ledger?.length === 0 ? (
                  <div className="px-5 py-6 text-center text-[13px] text-on-surface-variant">No ledger entries</div>
                ) : (
                  selectedCustomer.ledger?.map((entry) => (
                    <div key={entry.id} className="grid grid-cols-[140px_1fr_100px_90px_120px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
                      <span className="text-[13px] text-on-surface">{formatDateTime(entry.entry_date)}</span>
                      <span className="text-[13px] text-on-surface-variant truncate">{entry.notes || (entry.type === 'credit' ? 'Credit Sale' : 'Payment')}</span>
                      <span className={cn('text-[13px] font-semibold text-right', entry.type === 'credit' ? 'text-error' : 'text-primary')}>
                        {entry.type === 'credit' ? '+' : '-'}{formatCurrency(entry.amount)}
                      </span>
                      <span className="text-[12px] text-on-surface-variant capitalize">{entry.type}</span>
                      <span className="text-[13px] text-right text-on-surface-variant">{formatCurrency(entry.running_balance ?? outstanding)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-[16px] font-semibold text-on-surface mb-3">Order History</h3>
              <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                <div className="grid grid-cols-[80px_120px_100px_90px_120px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
                  <span>Order</span><span>Date</span><span>Sale Type</span><span className="text-right">Status</span><span className="text-right">Total</span>
                </div>
                {customerOrders.length === 0 ? (
                  <div className="px-5 py-6 text-center text-[13px] text-on-surface-variant">No sales for this customer</div>
                ) : (
                  customerOrders.map((o) => (
                    <div key={o.id} className="grid grid-cols-[80px_120px_100px_90px_120px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
                      <span className="text-[13px] font-semibold text-on-surface">#{o.id}</span>
                      <span className="text-[13px] text-on-surface-variant">{formatDateTime(o.created_at)}</span>
                      <span><Badge size="sm" variant={o.sale_type === 'wholesale' ? 'secondary' : 'neutral'}>{o.sale_type === 'wholesale' ? 'Wholesale' : 'Retail'}</Badge></span>
                      <div className="text-right"><Badge size="sm" variant={o.status === 'cancelled' ? 'error' : o.status === 'open' ? 'info' : 'success'}>{o.status}</Badge></div>
                      <span className="text-[13px] font-semibold text-on-surface text-right">{formatCurrency(o.bill_total || 0)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Customer Modal */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add Customer">
        <CustomerForm onSubmit={(data) => addMutation.mutate(data)} loading={addMutation.isPending} />
      </Modal>

      {/* Edit Customer Modal */}
      <Modal open={!!editingCustomer} onClose={() => setEditingCustomer(null)} title="Edit Customer">
        {editingCustomer && (
          <CustomerForm
            initial={editingCustomer}
            onSubmit={(data) => updateMutation.mutate({ id: editingCustomer.id, ...data })}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      {/* Delete Customer Modal */}
      <Modal open={showDeleteModal} onClose={() => { setShowDeleteModal(false); setDeletingCustomer(null); }} title="Delete Customer">
        <div className="space-y-4">
          <p className="text-[14px] text-on-surface">
            Are you sure you want to delete <strong>{deletingCustomer?.name}</strong>? This will deactivate the customer. Existing ledger entries will be preserved.
          </p>
          {outstanding > 0 && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/30">
              <p className="text-[13px] text-error font-semibold">
                Warning: This customer has an outstanding balance of {formatCurrency(outstanding)}.
              </p>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setDeletingCustomer(null); }}>Cancel</Button>
            <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deletingCustomer && deleteMutation.mutate(deletingCustomer.id)}>Delete</Button>
          </div>
        </div>
      </Modal>

      {/* Credit Sale Modal — a real sale with products, stock and ledger entry */}
      <Modal open={showCreditModal} onClose={() => setShowCreditModal(false)} title="Record Credit Sale" size="lg">
        <CreditSaleForm customerId={selectedId!} creditLimit={selectedCustomer?.credit_limit || 0} balance={outstanding}
          onSubmit={(data) => creditMutation.mutate(data)} loading={creditMutation.isPending} />
      </Modal>

      {/* Payment Modal */}
      <Modal open={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Record Payment">
        <PaymentForm customerId={selectedId!} balance={outstanding}
          onSubmit={(data) => paymentMutation.mutate(data)} loading={paymentMutation.isPending} />
      </Modal>
    </div>
  );
}

function CustomerForm({
  initial,
  onSubmit,
  loading,
}: {
  initial?: any;
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [creditLimit, setCreditLimit] = useState(String(initial?.credit_limit || ''));
  const [notes, setNotes] = useState(initial?.notes || '');

  return (
    <div className="space-y-4">
      <Input label="Customer Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
      <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300-1234567" />
      <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" />
      <Input label="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Customer address" />
      <Input label="Credit Limit (optional)" type="number" prefix="Rs." value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="0" />
      <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." />
      <Button
        variant="primary"
        className="w-full"
        loading={loading}
        disabled={!name}
        onClick={() => onSubmit({
          name,
          phone: phone || null,
          address: address || null,
          email: email || null,
          credit_limit: creditLimit ? Number(creditLimit) : 0,
          notes: notes || null,
        })}
      >
        {initial ? 'Save Changes' : 'Add Customer'}
      </Button>
    </div>
  );
}

function CreditSaleForm({ customerId, creditLimit, balance, onSubmit, loading }: { customerId: number; creditLimit: number; balance: number; onSubmit: (data: any) => void; loading: boolean }) {
  const { user } = useAuth();
  const { data: products } = useIpcQuery<MenuItem[]>('menu:list', 'menu:list');
  const [lines, setLines] = useState<Array<{ menu_item_id: number; name: string; price: number; qty: number }>>([]);
  const [search, setSearch] = useState('');

  const filtered = (products || []).filter((p) =>
    p.active !== 0 &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()))
  );

  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const total = subtotal;
  const overLimit = creditLimit > 0 && (balance + total) > creditLimit;

  const addProduct = (p: MenuItem) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.menu_item_id === p.id);
      if (existing) return prev.map((l) => (l.menu_item_id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { menu_item_id: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  };

  const setQty = (id: number, qty: number) => {
    setLines((prev) => qty <= 0 ? prev.filter((l) => l.menu_item_id !== id) : prev.map((l) => (l.menu_item_id === id ? { ...l, qty } : l)));
  };

  const setPrice = (id: number, price: number) => {
    setLines((prev) => prev.map((l) => (l.menu_item_id === id ? { ...l, price: Number(price) || 0 } : l)));
  };

  return (
    <div className="space-y-4">
      {creditLimit > 0 && (
        <div className="flex justify-between text-[12px] text-on-surface-variant">
          <span>Credit Limit: {formatCurrency(creditLimit)}</span>
          <span>Current Balance: {formatCurrency(balance)}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Product picker */}
        <div className="space-y-2">
          <Input icon="search" placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-[260px] overflow-y-auto space-y-1 border border-outline-variant rounded-lg p-2">
            {filtered.map((p) => (
              <button key={p.id} onClick={() => addProduct(p)} disabled={loading}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-container-low transition-colors text-left">
                <div>
                  <p className="text-[13px] font-medium text-on-surface">{p.name}</p>
                  <p className="text-[11px] text-on-surface-variant">Stock: {p.current_stock ?? 0} · Cost {formatCurrency(p.cost_price || 0)}</p>
                </div>
                <span className="text-[13px] font-semibold text-primary">{formatCurrency(p.price)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-[12px] text-on-surface-variant text-center py-6">No products found</p>
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="space-y-2">
          <div className="max-h-[260px] overflow-y-auto space-y-1.5">
            {lines.length === 0 ? (
              <p className="text-[13px] text-on-surface-variant text-center py-10">Add products from the left to build this credit sale.</p>
            ) : (
              lines.map((l) => (
                <div key={l.menu_item_id} className="flex items-center gap-2 bg-surface-container rounded-lg p-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-on-surface truncate">{l.name}</p>
                    <p className="text-[11px] text-on-surface-variant">{formatCurrency(l.price * l.qty)}</p>
                  </div>
                  <input type="number" min={1} value={l.qty}
                    onChange={(e) => setQty(l.menu_item_id, Number(e.target.value) || 0)}
                    className="w-16 h-8 px-2 rounded-md border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
                  <input type="number" value={l.price}
                    onChange={(e) => setPrice(l.menu_item_id, Number(e.target.value))}
                    className="w-24 h-8 px-2 rounded-md border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
                  <button onClick={() => setQty(l.menu_item_id, 0)} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-error-container hover:text-error transition-colors">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-between text-[14px] py-2 border-t border-outline-variant">
            <span className="text-on-surface-variant">Total</span>
            <span className="font-bold text-on-surface">{formatCurrency(total)}</span>
          </div>
          {overLimit && (
            <div className="p-2 rounded-lg bg-error/10 border border-error/30">
              <p className="text-[12px] text-error font-semibold">This will exceed the customer's credit limit by {formatCurrency((balance + total) - creditLimit)}</p>
            </div>
          )}
        </div>
      </div>

      <Button variant="primary" className="w-full" loading={loading} disabled={lines.length === 0 || total <= 0}
        onClick={() => onSubmit({
          sale_type: 'retail',
          created_by: user?.id || 0,
          customer_id: customerId,
          items: lines.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty, price: l.price, discount: 0 })),
          subtotal: Math.round(subtotal * 100) / 100,
          discount_amount: 0,
          total: Math.round(total * 100) / 100,
          payment_method: 'credit',
          cashier_id: user?.id || 0,
        })}
      >
        Record Credit Sale
      </Button>
    </div>
  );
}

function PaymentForm({ customerId, balance, onSubmit, loading }: { customerId: number; balance: number; onSubmit: (data: any) => void; loading: boolean }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-4">
      {balance > 0 && (
        <div className="text-[13px] text-on-surface-variant">
          Outstanding balance: <span className="font-semibold text-error">{formatCurrency(balance)}</span>
        </div>
      )}
      <Input label="Amount" type="number" prefix="Rs." value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment reference..." />
      <Button variant="primary" className="w-full" loading={loading} disabled={!amount || Number(amount) <= 0}
        onClick={() => onSubmit({ customer_id: customerId, type: 'payment', amount: Number(amount), entry_date: toLocalYMD(), notes: notes || undefined })}
      >
        Record Payment
      </Button>
    </div>
  );
}