import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useIpcQuery } from '../hooks/useDB';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ui/Toast';
import { formatCurrency, cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import logoUrl from '../assets/logo.png';
import type { MenuItem, SaleType, PaymentMethod } from '../types';

interface NavEntry {
  icon: string;
  label: string;
  path: string;
  permission?: string;
}

const NAV_ENTRIES: NavEntry[] = [
  { icon: 'dashboard', label: 'Dashboard', path: '/' },
  { icon: 'receipt_long', label: 'Sales', path: '/orders' },
  { icon: 'phone_android', label: 'Products', path: '/products', permission: 'edit_menu' },
  { icon: 'local_shipping', label: 'Purchases', path: '/suppliers', permission: 'manage_suppliers' },
  { icon: 'inventory_2', label: 'Stock', path: '/inventory', permission: 'add_stock_entries' },
  { icon: 'groups', label: 'Customers', path: '/customers', permission: 'add_customers' },
  { icon: 'payments', label: 'Expenses', path: '/expenses', permission: 'manage_expenses' },
  { icon: 'badge', label: 'Staff', path: '/staff', permission: 'manage_staff' },
  { icon: 'assessment', label: 'Reports', path: '/reports', permission: 'view_reports' },
  { icon: 'settings', label: 'Settings', path: '/settings', permission: 'manage_settings' },
];

type DiscountType = 'none' | 'percent' | 'fixed';

interface OrderLine {
  menuItem: MenuItem;
  qty: number;
  notes: string;
}

interface Discount {
  type: DiscountType;
  value: number;
}

interface HeldOrder {
  id: string;
  label: string;
  order: OrderLine[];
  saleType: SaleType;
  customerId?: number;
  discount: Discount;
  heldAt: string;
}

interface ReceiptData {
  billId: number;
  orderId: number;
  paymentMethod: string;
  saleType: SaleType;
  customerName?: string;
  discount: Discount;
  items: { name: string; qty: number; price: number; notes: string }[];
  subtotal: number;
  discountAmount: number;
  total: number;
  timestamp: string;
}

const PAYMENT_OPTIONS: { method: PaymentMethod; icon: string; label: string }[] = [
  { method: 'cash', icon: 'payments', label: 'Cash' },
  { method: 'card', icon: 'credit_card', label: 'Card' },
  { method: 'bank_transfer', icon: 'account_balance', label: 'Bank Transfer' },
  { method: 'jazzcash', icon: 'smartphone', label: 'JazzCash' },
  { method: 'easypaisa', icon: 'mobile_friendly', label: 'EasyPaisa' },
  { method: 'credit', icon: 'bookmark', label: 'Credit' },
];

const VOID_REASONS = ['Customer request', 'Incorrect price', 'Duplicate entry', 'Cashier mistake', 'Manager override', 'Other'];

export function POSPage() {
  const { user, hasPermission, logout } = useAuth();
  const queryClient = useQueryClient();

  const [activeCategory, setActiveCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [order, setOrder] = useState<OrderLine[]>([]);
  const [saleType, setSaleType] = useState<SaleType>('retail');
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customerName, setCustomerName] = useState('');
  const [discount, setDiscount] = useState<Discount>({ type: 'none', value: 0 });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentReceipt, setPaymentReceipt] = useState<ReceiptData | null>(null);

  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesLineIndex, setNotesLineIndex] = useState<number>(0);
  const [itemNotes, setItemNotes] = useState('');
  const [showNav, setShowNav] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setShowNav((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!showNav) return;
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setShowNav(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showNav]);

  const { data: categories } = useIpcQuery<string[]>('menu:categories', 'menu:categories');
  const { data: menuItems } = useIpcQuery<MenuItem[]>('menu:list', 'menu:list', 1);
  const { data: customers } = useIpcQuery<any[]>('customers:list', 'customers:list');
  const { data: settings } = useIpcQuery<Record<string, string>>('settings:get', 'settings:get');

  useEffect(() => {
    if (!settings) return;
  }, [settings]);

  const itemPrice = useCallback((item: MenuItem): number => {
  }, [saleType]);

  const filteredItems = useMemo(() => {
    if (!menuItems) return [];
    let items = menuItems;
    if (activeCategory) items = items.filter((item) => item.category === activeCategory);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter((item) => {
        const haystack = [item.name, item.brand, item.model, item.sku, item.category, item.shortcut].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    return items;
  }, [menuItems, activeCategory, searchQuery]);

  const subtotal = order.reduce((sum, l) => sum + itemPrice(l.menuItem) * l.qty, 0);
  let discountAmount = 0;
  if (discount.type === 'percent') {
    discountAmount = Math.round(subtotal * (discount.value / 100));
  } else if (discount.type === 'fixed') {
    discountAmount = Math.min(discount.value, subtotal);
  }
  const total = Math.max(0, subtotal - discountAmount);

  const addItem = useCallback((item: MenuItem) => {
    setOrder((prev) => {
      const existing = prev.findIndex((l) => l.menuItem.id === item.id);
      if (existing >= 0) {
        return prev.map((l, i) => i === existing ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, { menuItem: item, qty: 1, notes: '' }];
    });
  }, []);

  const updateQty = useCallback((itemId: number, delta: number) => {
    setOrder((prev) =>
      prev.map((l) => l.menuItem.id === itemId ? { ...l, qty: l.qty + delta } : l).filter((l) => l.qty > 0)
    );
  }, []);

  const removeLine = useCallback((itemId: number) => {
    setOrder((prev) => prev.filter((l) => l.menuItem.id !== itemId));
  }, []);

  const addLineNote = useCallback((index: number) => {
    setNotesLineIndex(index);
    setItemNotes(order[index]?.notes || '');
    setShowNotesModal(true);
  }, [order]);

  const saveLineNote = useCallback(() => {
    setOrder((prev) => prev.map((l, i) => i === notesLineIndex ? { ...l, notes: itemNotes } : l));
    setShowNotesModal(false);
  }, [notesLineIndex, itemNotes]);

  // ─── HOLD / RECALL ──────────────────────────────────────────────────

  const getHeldOrders = (): HeldOrder[] => {
    try {
      const raw = localStorage.getItem('held_orders');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  const holdOrder = () => {
    if (order.length === 0) return;
    const held: HeldOrder = {
      id: `hold_${Date.now()}`,
      label: customerName || `Order #${Date.now() % 1000}`,
      order,
      saleType,
      customerId,
      discount,
      heldAt: new Date().toLocaleTimeString(),
    };
    const heldOrders = getHeldOrders();
    heldOrders.push(held);
    localStorage.setItem('held_orders', JSON.stringify(heldOrders));
    setOrder([]);
    setCustomerId(undefined);
    setCustomerName('');
    setDiscount({ type: 'none', value: 0 });
  };

  const recallOrder = (heldId: string) => {
    const heldOrders = getHeldOrders();
    const found = heldOrders.find((h) => h.id === heldId);
    if (!found) return;
    setOrder(found.order);
    setSaleType(found.saleType);
    setCustomerId(found.customerId);
    setDiscount(found.discount);
    const remaining = heldOrders.filter((h) => h.id !== heldId);
    localStorage.setItem('held_orders', JSON.stringify(remaining));
    setShowHoldModal(false);
  };

  const deleteHeldOrder = (heldId: string) => {
    const heldOrders = getHeldOrders().filter((h) => h.id !== heldId);
    localStorage.setItem('held_orders', JSON.stringify(heldOrders));
  };

  const heldOrders = getHeldOrders();

  // ─── VOID ────────────────────────────────────────────────────────────

  const [voidReason, setVoidReason] = useState('');
  const [voidPin, setVoidPin] = useState('');
  const [voidError, setVoidError] = useState('');

  const handleVoid = async () => {
    setVoidError('');
    if (!voidReason) { setVoidError('Select a reason'); return; }
    const pinResult = await window.electronAPI.invoke('auth:login', voidPin) as { success: boolean };
    if (!pinResult.success) { setVoidError('Invalid PIN — manager override required'); return; }
    setOrder([]);
    setCustomerId(undefined);
    setCustomerName('');
    setDiscount({ type: 'none', value: 0 });
    setShowVoidModal(false);
    setVoidReason('');
    setVoidPin('');
  };

  // ─── CUSTOMER SEARCH ─────────────────────────────────────────────────

  const [customerSearch, setCustomerSearch] = useState('');
  const filteredCustomers = (customers || []).filter((c: any) =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) || String(c.phone || '').includes(customerSearch)
  );

  // ─── CREATE ORDER + BILL ─────────────────────────────────────────────

  const createOrder = useMutation({
    mutationFn: async (method: PaymentMethod) => {
      const result = await window.electronAPI.invoke('pos:checkout', {
        sale_type: saleType,
        created_by: user?.id || 0,
        customer_id: customerId || null,
        items: order.map((l) => ({ menu_item_id: l.menuItem.id, qty: l.qty, price: itemPrice(l.menuItem), discount: 0, notes: l.notes || null })),
        subtotal,
        discount_amount: discountAmount,
        total,
        payment_method: method,
        cashier_id: user?.id,
      }) as { success: boolean; data: { billId: number; orderId: number }; error?: string };

      if (!result.success) throw new Error(result.error || 'Checkout failed');
      return { ...result.data, paymentMethod: method, saleType, customerName: customerName || undefined };
    },
    onSuccess: (data) => {
      toast.success(`Sale #${data.orderId} completed — ${formatCurrency(total)}`);
      setPaymentReceipt({
        ...data,
        discount,
        items: order.map((l) => ({ name: l.menuItem.name, qty: l.qty, price: itemPrice(l.menuItem), notes: l.notes })),
        subtotal,
        discountAmount,
        total,
        timestamp: new Date().toLocaleString(),
      });
      setOrder([]);
      setCustomerId(undefined);
      setCustomerName('');
      setDiscount({ type: 'none', value: 0 });
      queryClient.invalidateQueries({ queryKey: ['orders:list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard:kpi'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard:activity'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard:hourly-sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard:daily-sales'] });
      queryClient.invalidateQueries({ queryKey: ['stock:summary'] });
      queryClient.invalidateQueries({ queryKey: ['reports:low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['customers:list'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Checkout failed — please try again'),
  });

  const handlePrint = async () => {
    if (!paymentReceipt) return;
    try {
      await window.electronAPI.invoke('printer:print-receipt', {
        orderId: paymentReceipt.orderId,
        billId: paymentReceipt.billId,
        items: paymentReceipt.items,
        subtotal: paymentReceipt.subtotal,
        discountAmount: paymentReceipt.discountAmount,
        total: paymentReceipt.total,
        paymentMethod: paymentReceipt.paymentMethod,
        cashierName: user?.name || 'Cashier',
        saleType: paymentReceipt.saleType,
        customerName: paymentReceipt.customerName,
        timestamp: paymentReceipt.timestamp,
        businessName: settings?.business_name || 'Sheikh Ahmad Mobiles',
        businessPhone: settings?.business_phone || '',
        businessAddress: settings?.business_address || '',
        businessNTN: settings?.business_ntn || '',
        receiptHeader: settings?.receipt_header || 'Thank you for shopping with us!',
        receiptFooter: settings?.receipt_footer || '',
      });
    } catch { /* Printer not available */ }
  };

  const paymentLabel = (m: PaymentMethod) => PAYMENT_OPTIONS.find((o) => o.method === m)?.label || 'Credit';

  return (
    <div className="flex h-full overflow-hidden">
      {/* Categories sidebar */}
      <div className="w-[140px] shrink-0 bg-surface border-r border-outline-variant overflow-y-auto py-2">
        <button
          onClick={() => setActiveCategory('')}
          className={cn(
            'w-full flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-all',
            !activeCategory
              ? 'border-l-4 border-primary bg-surface-container-low text-primary font-bold'
              : 'border-l-4 border-transparent text-on-surface-variant hover:bg-surface-container'
          )}
        >
          <span className="material-symbols-outlined text-[18px]">grid_view</span>
          All
        </button>
        {categories?.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              'w-full flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-all',
              activeCategory === cat
                ? 'border-l-4 border-primary bg-surface-container-low text-primary font-bold'
                : 'border-l-4 border-transparent text-on-surface-variant hover:bg-surface-container'
            )}
          >
            <span className="material-symbols-outlined text-[18px]">phone_android</span>
            <span className="truncate">{cat}</span>
          </button>
        ))}
      </div>

      {/* Products Grid */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar */}
        <div className="px-4 py-3 border-b border-outline-variant bg-surface">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">search</span>
              <input
                type="text"
                placeholder="Search name, brand, model, SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl border border-outline-variant bg-surface-container-low text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <span className="material-symbols-outlined text-[18px] text-on-surface-variant">close</span>
                </button>
              )}
            </div>
            <button
              onClick={() => logout()}
              title="Logout"
              className="h-10 w-10 shrink-0 rounded-xl border border-outline-variant bg-surface-container-low hover:bg-error-container hover:border-error/40 transition-all flex items-center justify-center text-on-surface-variant hover:text-error"
            >
              <span className="material-symbols-outlined text-[22px]">logout</span>
            </button>
          </div>
        </div>

        {/* Items grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredItems?.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                className="flex flex-col items-center gap-2 p-4 bg-surface border border-outline-variant rounded-xl hover:bg-surface-container-low active:scale-[0.97] transition-all text-center"
              >
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="w-14 h-14 rounded-lg object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-secondary-container flex items-center justify-center">
                    <span className="material-symbols-outlined text-on-secondary-container text-[24px]">phone_android</span>
                  </div>
                )}
                <span className="text-[12px] font-semibold text-on-surface leading-[16px] line-clamp-2">{item.name}</span>
                <span className="text-[13px] font-bold text-primary">{formatCurrency(itemPrice(item))}</span>
                  
                )}
              </button>
            ))}
            {filteredItems?.length === 0 && (
              <div className="col-span-full text-center py-12 text-on-surface-variant">
                <span className="material-symbols-outlined text-[48px]">search_off</span>
                <p className="text-[14px] mt-2">No products found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order Panel */}
      <div className="w-[380px] shrink-0 bg-surface border-l border-outline-variant flex flex-col">
        {/* Sale type + customer */}
        <div className="px-4 py-3 border-b border-outline-variant space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSaleType('retail')}
              className={cn(
                'h-10 rounded-lg text-[13px] font-semibold transition-all',
                saleType === 'retail' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              )}
            >
              Retail
            </button>
            <button
              className={cn(
                'h-10 rounded-lg text-[13px] font-semibold transition-all',
              )}
            >
            </button>
          </div>
          <button
            onClick={() => setShowCustomerModal(true)}
            className={cn(
              'w-full h-9 px-3 rounded-lg border text-[13px] font-medium transition-all flex items-center justify-center gap-1',
              customerId
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container'
            )}
          >
            <span className="material-symbols-outlined text-[16px]">{customerId ? 'person' : 'person_add'}</span>
            {customerName || 'Assign Customer'}
          </button>
        </div>

        {/* Held orders indicator + action buttons */}
        <div className="px-4 py-2 flex gap-2 border-b border-outline-variant">
          <button
            onClick={() => setShowHoldModal(true)}
            className="flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-medium bg-surface-container text-on-surface-variant hover:bg-surface-container-high transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">pause</span>
            Hold
            {heldOrders.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-[10px] font-bold flex items-center justify-center">
                {heldOrders.length}
              
            )}
          </button>
          <button
            onClick={() => order.length > 0 && setShowDiscountModal(true)}
            className={cn(
              'flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-medium transition-all',
              discount.type !== 'none'
                ? 'bg-tertiary-container text-on-tertiary-container'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            )}
          >
            <span className="material-symbols-outlined text-[16px]">local_offer</span>
            {discount.type !== 'none' ? `${discount.type === 'percent' ? `${discount.value}%` : formatCurrency(discount.value)} off` : 'Discount'}
          </button>
          <button
            onClick={() => order.length > 0 && setShowVoidModal(true)}
            className="flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-medium bg-error-container/30 text-error hover:bg-error-container/50 transition-all ml-auto"
          >
            <span className="material-symbols-outlined text-[16px]">cancel</span>
            Void
          </button>
        </div>

        {/* Order lines */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {order.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-on-surface-variant gap-2">
              <span className="material-symbols-outlined text-[40px]">receipt_long</span>
              <p className="text-[14px]">Add items to start a sale</p>
            </div>
          ) : (
            <div className="space-y-1">
              {order.map((line, index) => {
                const price = itemPrice(line.menuItem);
                return (
                  <div key={line.menuItem.id} className="py-2 border-b border-outline-variant last:border-0">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-on-surface truncate">{line.menuItem.name}</p>
                        <p className="text-[11px] text-on-surface-variant">{formatCurrency(price)} each</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => updateQty(line.menuItem.id, -1)}
                          className="w-7 h-7 rounded-md bg-surface-container hover:bg-error-container flex items-center justify-center transition-colors">
                          <span className="material-symbols-outlined text-[16px]">remove</span>
                        </button>
                        <span className="w-6 text-center text-[13px] font-bold text-on-surface">{line.qty}</span>
                        <button onClick={() => updateQty(line.menuItem.id, 1)}
                          className="w-7 h-7 rounded-md bg-surface-container hover:bg-primary-container flex items-center justify-center transition-colors">
                          <span className="material-symbols-outlined text-[16px]">add</span>
                        </button>
                        <span className="w-16 text-right text-[13px] font-semibold text-on-surface">
                          {formatCurrency(price * line.qty)}
                        
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => addLineNote(index)}
                        className={cn(
                          'flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium transition-all',
                          line.notes ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                        )}>
                        <span className="material-symbols-outlined text-[12px]">edit_note</span>
                        {line.notes ? 'Note added' : 'Add note'}
                      </button>
                      <button onClick={() => removeLine(line.menuItem.id)}
                        className="flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-error-container/20 text-error hover:bg-error-container/40 transition-all ml-auto">
                        <span className="material-symbols-outlined text-[12px]">delete</span>
                        Remove
                      </button>
                    </div>
                    {line.notes && (
                      <p className="text-[10px] text-tertiary mt-0.5 pl-1 italic">Note: {line.notes}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Totals + Pay */}
        <div className="border-t border-outline-variant px-4 py-3 space-y-1.5">
          <div className="flex justify-between text-[13px] text-on-surface-variant">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-[13px] text-primary font-medium">
              <span>
                Discount
                {discount.type === 'percent' && ` (${discount.value}%)`}
              
              <span>-{formatCurrency(discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-[16px] font-bold text-on-surface pt-1.5 border-t border-outline-variant">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>

          {/* Payment Method Selector */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            {PAYMENT_OPTIONS.map((opt) => (
              <button
                key={opt.method}
                disabled={order.length === 0 || (opt.method === 'credit' && !customerId)}
                onClick={() => setPaymentMethod(opt.method)}
                className={cn(
                  'h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all border-b-2 disabled:opacity-40 disabled:cursor-not-allowed',
                  paymentMethod === opt.method
                    ? 'bg-primary text-on-primary border-[#001f19]'
                    : 'bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container-low active:bg-surface-dim'
                )}
              >
                <span className="material-symbols-outlined text-[18px]">{opt.icon}</span>
                <span className="text-[10px] font-semibold leading-tight">{opt.label}</span>
              </button>
            ))}
          </div>

          {/* Pay CTA */}
          <Button
            variant="primary"
            size="lg"
            icon="receipt_long"
            className="w-full mt-2 h-12"
            disabled={order.length === 0}
            loading={createOrder.isPending}
            onClick={() => createOrder.mutate(paymentMethod)}
          >
            {paymentLabel(paymentMethod)} — {formatCurrency(total)}
          </Button>
        </div>
      </div>

      {/* ─── MODALS ─────────────────────────────────────────────────── */}

      {/* Receipt Modal */}
      <Modal open={!!paymentReceipt} onClose={() => setPaymentReceipt(null)} title="Payment Successful">
        {paymentReceipt && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary-container text-[28px]">check_circle</span>
            </div>
            <div className="text-center">
              <p className="text-[20px] font-bold text-on-surface">{formatCurrency(paymentReceipt.total)}</p>
              <p className="text-[13px] text-on-surface-variant mt-1">
              </p>
            </div>
            <div className="w-full bg-surface-container-low rounded-xl p-4 border border-outline-variant text-[12px]">
              <div className="text-center border-b border-outline-variant pb-2 mb-2">
                <div className="flex flex-col items-center gap-1 mb-1">
                  <img src={logoUrl} alt="Sheikh Ahmad Mobiles" className="w-12 h-12 object-contain" draggable={false} />
                  <p className="text-[14px] font-bold text-on-surface">{settings?.business_name || 'Sheikh Ahmad Mobiles'}</p>
                </div>
                <p className="text-on-surface-variant">Bill #{paymentReceipt.billId} &middot; Order #{paymentReceipt.orderId}</p>
                {paymentReceipt.customerName && <p className="text-on-surface-variant">Customer: {paymentReceipt.customerName}</p>}
                <p className="text-on-surface-variant">{paymentReceipt.timestamp}</p>
              </div>
              <div className="space-y-0.5 mb-2">
                {paymentReceipt.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-on-surface">
                    <span>{item.qty}x {item.name}</span>
                    <span>{formatCurrency(item.price * item.qty)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-outline-variant pt-1.5 space-y-0.5">
                <div className="flex justify-between text-on-surface-variant"><span>Subtotal</span><span>{formatCurrency(paymentReceipt.subtotal)}</span></div>
                {paymentReceipt.discountAmount > 0 && <div className="flex justify-between text-primary"><span>Discount</span><span>-{formatCurrency(paymentReceipt.discountAmount)}</span></div>}
                <div className="flex justify-between font-bold text-on-surface pt-1 border-t border-outline-variant"><span>TOTAL</span><span>{formatCurrency(paymentReceipt.total)}</span></div>
              </div>
            </div>
            <div className="flex gap-3 w-full">
              <Button variant="primary" size="lg" icon="print" className="flex-1" onClick={handlePrint}>Print</Button>
              <Button variant="secondary" size="lg" icon="add_shopping_cart" className="flex-1" onClick={() => setPaymentReceipt(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Discount Modal */}
      <Modal open={showDiscountModal} onClose={() => setShowDiscountModal(false)} title="Apply Discount">
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setDiscount({ type: 'none', value: 0 })}
              className={cn('flex-1 h-10 rounded-lg border text-[13px] font-medium transition-all',
                discount.type === 'none' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant text-on-surface-variant')}>
              None
            </button>
            <button onClick={() => setDiscount({ type: 'percent', value: discount.type === 'percent' ? discount.value : 10 })}
              className={cn('flex-1 h-10 rounded-lg border text-[13px] font-medium transition-all',
                discount.type === 'percent' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant text-on-surface-variant')}>
              % Percent
            </button>
            <button onClick={() => setDiscount({ type: 'fixed', value: discount.type === 'fixed' ? discount.value : 0 })}
              className={cn('flex-1 h-10 rounded-lg border text-[13px] font-medium transition-all',
                discount.type === 'fixed' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant text-on-surface-variant')}>
              Fixed Amount
            </button>
          </div>
          {discount.type !== 'none' && (
            <div>
              <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">
                {discount.type === 'percent' ? 'Discount %' : 'Discount Amount'}
              </label>
              <input
                type="number"
                value={discount.value || ''}
                onChange={(e) => setDiscount({ ...discount, value: Number(e.target.value) })}
                className="w-full h-11 px-4 rounded-lg border border-outline-variant bg-surface text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={discount.type === 'percent' ? 'e.g. 10' : 'e.g. 500'}
                min={0}
                max={discount.type === 'percent' ? 100 : subtotal}
              />
              <p className="text-[12px] text-on-surface-variant mt-1">
                Discount: {formatCurrency(discount.type === 'percent' ? Math.round(subtotal * discount.value / 100) : Math.min(discount.value, subtotal))}
              </p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowDiscountModal(false)} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={() => setShowDiscountModal(false)} className="flex-1">Apply</Button>
          </div>
        </div>
      </Modal>

      {/* Customer Modal */}
      <Modal open={showCustomerModal} onClose={() => setShowCustomerModal(false)} title="Assign Customer">
        <div className="space-y-3">
          <Input icon="search" placeholder="Search by name or phone..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
          <div className="max-h-[300px] overflow-y-auto divide-y divide-outline-variant rounded-lg border border-outline-variant">
            <button
              onClick={() => { setCustomerId(undefined); setCustomerName(''); setShowCustomerModal(false); }}
              className="w-full px-4 py-3 text-left text-[13px] text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              No Customer (Walk-in)
            </button>
            {filteredCustomers.map((c: any) => (
              <button key={c.id}
                onClick={() => { setCustomerId(c.id); setCustomerName(c.name); setCustomerSearch(''); setShowCustomerModal(false); }}
                className="w-full px-4 py-3 text-left hover:bg-surface-container-low transition-colors">
                <p className="text-[13px] font-medium text-on-surface">{c.name}</p>
                <p className="text-[11px] text-on-surface-variant">{c.phone || 'No phone'}</p>
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Hold Orders Modal */}
      <Modal open={showHoldModal} onClose={() => setShowHoldModal(false)} title="Held Sales">
        <div className="space-y-3">
          {order.length > 0 && (
            <Button variant="primary" icon="pause" className="w-full" onClick={() => { holdOrder(); setShowHoldModal(false); }}>
              Hold Current Sale
            </Button>
          )}
          {heldOrders.length === 0 ? (
            <p className="text-center text-[14px] text-on-surface-variant py-6">No held sales</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {heldOrders.map((held) => (
                <div key={held.id} className="flex items-center justify-between p-3 rounded-lg border border-outline-variant bg-surface-container-low">
                  <div>
                    <p className="text-[13px] font-medium text-on-surface">{held.label}</p>
                    <p className="text-[11px] text-on-surface-variant">
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => recallOrder(held.id)}>Recall</Button>
                    <button onClick={() => deleteHeldOrder(held.id)}
                      className="w-8 h-8 rounded-lg hover:bg-error-container/30 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[16px] text-error">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Void Order Modal */}
      <Modal open={showVoidModal} onClose={() => { setShowVoidModal(false); setVoidReason(''); setVoidPin(''); setVoidError(''); }} title="Void Sale">
        <div className="space-y-4">
          <div>
            <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Reason</label>
            <select value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
              className="w-full h-11 px-4 rounded-lg border border-outline-variant bg-surface text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Select reason...</option>
              {VOID_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Manager PIN</label>
            <input type="password" maxLength={6} value={voidPin} onChange={(e) => setVoidPin(e.target.value)}
              placeholder="Enter 6-digit PIN"
              className="w-full h-11 px-4 rounded-lg border border-outline-variant bg-surface text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          {voidError && <p className="text-[13px] text-error">{voidError}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowVoidModal(false); setVoidReason(''); setVoidPin(''); setVoidError(''); }} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={handleVoid} className="flex-1 bg-error hover:bg-error/90">Void Sale</Button>
          </div>
        </div>
      </Modal>

      {/* Item Notes Modal */}
      <Modal open={showNotesModal} onClose={() => setShowNotesModal(false)} title="Item Notes">
        <div className="space-y-4">
          <p className="text-[13px] text-on-surface-variant">
            Add note for: <strong>{order[notesLineIndex]?.menuItem.name}</strong>
          </p>
          <textarea
            value={itemNotes}
            onChange={(e) => setItemNotes(e.target.value)}
            placeholder="e.g. Check warranty, blue colour..."
            rows={3}
            className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowNotesModal(false)} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={saveLineNote} className="flex-1">Save Note</Button>
          </div>
        </div>
      </Modal>

      {/* ─── FLOATING NAV FAB ──────────────────────────────────────────── */}
      <div ref={navRef} className="fixed bottom-6 left-6 z-50">
        {showNav && (
          <div className="absolute bottom-16 left-0 w-[200px] bg-surface border border-outline-variant rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="p-2 border-b border-outline-variant bg-surface-container">
              <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wide px-2">Navigate To</p>
            </div>
            <nav className="p-1.5 max-h-[360px] overflow-y-auto">
              {NAV_ENTRIES
                .filter((e) => !e.permission || hasPermission(e.permission))
                .map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => { setShowNav(false); navigate(entry.path); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-on-surface hover:bg-surface-container-low transition-colors text-left"
                >
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">{entry.icon}</span>
                  {entry.label}
                </button>
              ))}
            </nav>
            <div className="p-2 border-t border-outline-variant">
              <p className="text-[10px] text-on-surface-variant text-center">Press F2 to toggle</p>
            </div>
          </div>
        )}
        <button
          onClick={() => setShowNav((v) => !v)}
          className={cn(
            'w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200',
            showNav
              ? 'bg-on-primary text-primary rotate-90'
              : 'bg-primary text-on-primary hover:bg-on-primary-fixed-variant'
          )}
          title="Navigate (F2)"
        >
          <span className="material-symbols-outlined text-[28px]">menu</span>
        </button>
      </div>
    </div>
  );
}
