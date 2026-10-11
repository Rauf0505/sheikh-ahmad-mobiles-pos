import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpcQuery } from '../hooks/useDB';
import { useToast } from '../components/ui/Toast';
import { formatCurrency, toLocalYMD, cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PriceHistory } from '../components/PriceHistory';
import type { MenuItem, Supplier } from '../types';

interface ProductForm {
  name: string;
  category: string;
  brand: string;
  model: string;
  sku: string;
  price: string;
  wholesale_price: string;
  cost_price: string;
  unit: string;
  description: string;
  image_url: string;
  supplier_id: string;
}

const emptyForm: ProductForm = {
  name: '',
  category: '',
  brand: '',
  model: '',
  sku: '',
  price: '',
  wholesale_price: '',
  cost_price: '',
  unit: 'pcs',
  description: '',
  image_url: '',
  supplier_id: '',
};

interface MenuCategory {
  id: number;
  name: string;
  sort_order: number;
  active: number;
  item_count: number;
}

type Tab = 'items' | 'categories';

export function ProductsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('items');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkPercent, setBulkPercent] = useState<string>('');
  const [bulkTarget, setBulkTarget] = useState<'retail' | 'wholesale'>('retail');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [historyItem, setHistoryItem] = useState<MenuItem | null>(null);

  const { data: menuItems, isLoading } = useIpcQuery<MenuItem[]>('menu:list', 'menu:list');
  const { data: categories } = useIpcQuery<string[]>('menu:categories', 'menu:categories');
  const { data: catEnts } = useIpcQuery<MenuCategory[]>('menu:categories:list', 'menu:categories:list');
  const { data: suppliers } = useIpcQuery<Supplier[]>('suppliers:list', 'suppliers:list');

  useEffect(() => {
    window.electronAPI.invoke('menu:categories:sync').then((r: any) => {
      if (r?.success && r.data?.added) {
        queryClient.invalidateQueries({ queryKey: ['menu:categories'] });
        queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] });
      }
    });
  }, [queryClient]);

  const filteredItems = (menuItems || [])
    .filter((item) => {
      const haystack = [item.name, item.brand, item.model, item.sku, item.category, item.shortcut].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !search || haystack.includes(search.toLowerCase());
      const matchesCategory = !categoryFilter || item.category === categoryFilter;
      const matchesSupplier = !supplierFilter || String(item.supplier_id || '') === supplierFilter;
      return matchesSearch && matchesCategory && matchesSupplier;
    });

  const createMutation = useMutation({
    mutationFn: async (data: ProductForm) => {
      const result = await window.electronAPI.invoke('menu:create', {
        name: data.name, category: data.category, price: Number(data.price),
        wholesale_price: data.wholesale_price ? Number(data.wholesale_price) : 0,
        cost_price: data.cost_price ? Number(data.cost_price) : 0,
        brand: data.brand || null, model: data.model || null, sku: data.sku || null,
        unit: data.unit || 'pcs', description: data.description || null,
        image_url: data.image_url || null, active: 1,
        supplier_id: data.supplier_id ? Number(data.supplier_id) : undefined,
      }) as { success: boolean; data?: MenuItem; error?: string };
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu:list'] });
      queryClient.invalidateQueries({ queryKey: ['menu:categories'] });
      queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] });
      closeModal();
      toast.success('Product created');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create product'),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: ProductForm & { id: number }) => {
      const result = await window.electronAPI.invoke('menu:update', data.id, {
        name: data.name, category: data.category, price: Number(data.price),
        wholesale_price: data.wholesale_price ? Number(data.wholesale_price) : 0,
        cost_price: data.cost_price ? Number(data.cost_price) : 0,
        brand: data.brand || null, model: data.model || null, sku: data.sku || null,
        unit: data.unit || 'pcs', description: data.description || null,
        image_url: data.image_url || null,
        supplier_id: data.supplier_id ? Number(data.supplier_id) : undefined,
      }) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu:list'] });
      queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] });
      closeModal();
      toast.success('Product updated');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update product'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await window.electronAPI.invoke('menu:delete', id) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu:list'] });
      queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] });
      toast.success('Product deleted from the catalog');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to delete product'),
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (percent: number) => {
      const newPrice = (p: number) => Math.round(p * (1 + percent / 100) * 100) / 100;
      for (const item of menuItems || []) {
        await window.electronAPI.invoke('menu:update', item.id, bulkTarget === 'retail' ? { price: newPrice(item.price) } : { wholesale_price: newPrice(item.wholesale_price || 0) });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu:list'] });
      setShowBulkModal(false);
      setBulkPercent('');
      toast.success('Bulk price update applied');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to apply bulk update'),
  });

  const openAdd = () => { setEditingItem(null); setForm(emptyForm); setShowModal(true); };
  const handleExport = async () => {
    if (!menuItems || menuItems.length === 0) { toast.error('No products to export'); return; }
    const header = ['name', 'category', 'brand', 'model', 'sku', 'price', 'wholesale_price', 'cost_price', 'unit', 'description', 'active'];
    const esc = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    for (const item of menuItems) {
      const row = (item as any);
      lines.push([
        esc(row.name), esc(row.category), esc(row.brand), esc(row.model), esc(row.sku),
        esc(row.price), esc(row.wholesale_price), esc(row.cost_price), esc(row.unit), esc(row.description), esc(row.active),
      ].join(','));
    }
    const stamp = toLocalYMD();
    const res = await window.electronAPI.invoke('menu:export-file', lines.join('\n'), `products-export-${stamp}.csv`) as { success: boolean; canceled?: boolean; path?: string };
    if (res.canceled) return;
    if (res.success) toast.success('Products exported successfully');
    else toast.error('Failed to export products');
  };

  const handleImport = async () => {
    const res = await window.electronAPI.invoke('menu:import-file') as { success: boolean; canceled?: boolean; content?: string };
    if (res.canceled) return;
    if (!res.success || !res.content) { toast.error('Failed to read file'); return; }
    let rows: Array<Record<string, string>>;
    try {
      rows = parseCSV(res.content);
    } catch {
      toast.error('Invalid CSV file');
      return;
    }
    const items = rows
      .filter((r) => r.name || r.category || r.price)
      .map((r) => ({
        name: (r.name || '').trim(),
        category: (r.category || '').trim(),
        brand: (r.brand || '').trim() || null,
        model: (r.model || '').trim() || null,
        sku: (r.sku || '').trim() || null,
        price: Number(r.price ?? 0),
        wholesale_price: r.wholesale_price ? Number(r.wholesale_price) : 0,
        cost_price: Number(r.cost_price ?? 0),
        unit: (r.unit || 'pcs').trim(),
        description: (r.description || '').trim() || null,
        active: r.active !== undefined && String(r.active).trim() === '0' ? 0 : 1,
      }))
      .filter((i) => i.name && i.category && !isNaN(i.price));
    if (items.length === 0) { toast.error('No valid rows found in file'); return; }
    if (!confirm(`Import ${items.length} product(s)? This will create new products.`)) return;
    try {
      const result = await window.electronAPI.invoke('menu:bulk-import', items) as { success: boolean; data?: { imported: number; errors: string[] }; error?: string };
      if (!result.success) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ['menu:list'] });
      queryClient.invalidateQueries({ queryKey: ['menu:categories'] });
      queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] });
      const imported = result.data?.imported ?? 0;
      const errors = result.data?.errors?.length ?? 0;
      toast.success(`Imported ${imported} product(s)${errors ? `, ${errors} error(s) skipped` : ''}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to import products');
    }
  };

  const openEdit = (item: MenuItem) => {
    setEditingItem(item);
    setForm({
      name: item.name, category: item.category,
      brand: item.brand || '', model: item.model || '', sku: item.sku || '',
      price: String(item.price), wholesale_price: item.wholesale_price ? String(item.wholesale_price) : '',
      cost_price: item.cost_price ? String(item.cost_price) : '',
      unit: item.unit || 'pcs', description: (item as any).description || '',
      image_url: (item as any).image_url || '',
      supplier_id: item.supplier_id ? String(item.supplier_id) : '',
    });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingItem(null); setForm(emptyForm); };
  const handleSubmit = () => {
    if (!form.name || !form.category || !form.price) return;
    if (editingItem) updateMutation.mutate({ ...form, id: editingItem.id });
    else createMutation.mutate(form);
  };
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] leading-[36px] font-bold text-on-surface">Products</h1>
          <p className="text-[14px] text-on-surface-variant mt-1">Manage the product catalog with retail &amp; wholesale pricing</p>
        </div>
        {tab === 'items' && (
          <div className="flex gap-2">
            <Button variant="secondary" icon="upload_file" onClick={handleImport}>Import CSV</Button>
            <Button variant="secondary" icon="download" onClick={handleExport}>Export CSV</Button>
            <Button variant="secondary" icon="trending_up" onClick={() => setShowBulkModal(true)}>Bulk Price Update</Button>
            <Button variant="primary" icon="add" onClick={openAdd}>Add Product</Button>
          </div>
        )}
        {tab === 'categories' && (
          <Button variant="primary" icon="add" onClick={() => setShowAddCategory(true)}>Add Category</Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-outline-variant">
        {(['items', 'categories'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-[14px] font-semibold border-b-2 transition-colors capitalize',
              tab === t ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            )}
          >
            {t === 'items' ? 'Products' : 'Categories'}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <>
          <div className="flex gap-3 items-center">
            <div className="flex-1 max-w-sm">
              <Input icon="search" placeholder="Search name, brand, model, SKU..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-10 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">All Categories</option>
              {categories?.map((cat) => (<option key={cat} value={cat}>{cat}</option>))}
            </select>
            <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}
              className="h-10 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">All Suppliers</option>
              {suppliers?.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
            </select>
          </div>

          <ProductTable items={filteredItems} isLoading={isLoading} onEdit={openEdit} onHistory={setHistoryItem} onDelete={(id) => { if (confirm('Delete this product?\n\nIf the product has purchase or stock history it will be deactivated (kept for records). Otherwise it is removed permanently.')) deleteMutation.mutate(id); }} />
        </>
      )}

      {tab === 'categories' && (
        <CategoriesPanel
          categories={catEnts}
          onChanged={() => { queryClient.invalidateQueries({ queryKey: ['menu:categories'] }); queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] }); }}
        />
      )}

      <Modal open={showModal} onClose={closeModal} title={editingItem ? 'Edit Product' : 'Add New Product'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Product Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Samsung Galaxy A05" />
            <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Mobile Phones" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Samsung" />
            <Input label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="e.g. A05" />
            <Input label="SKU (optional)" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. SAM-A05" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Retail Price" type="number" prefix="Rs." value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0" />
            <Input label="Wholesale Price" type="number" prefix="Rs." value={form.wholesale_price} onChange={(e) => setForm({ ...form, wholesale_price: e.target.value })} placeholder="0" />
            <Input label="Cost Price (for P&L)" type="number" prefix="Rs." value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} placeholder="Used to calculate COGS" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Supplier</label>
              <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">No supplier</option>
                {suppliers?.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
              </select>
            </div>
            <Input label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs" />
          </div>
          <Input label="Image URL (optional)" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." />
          <Input label="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief product description..." />
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" onClick={closeModal} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} loading={isSubmitting} disabled={!form.name || !form.category || !form.price} className="flex-1">
              {editingItem ? 'Update Product' : 'Add Product'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={showBulkModal} onClose={() => { setShowBulkModal(false); setBulkPercent(''); }} title="Bulk Price Update">
        <div className="space-y-4">
          <p className="text-[14px] text-on-surface-variant">Apply a percentage change to <strong>{menuItems?.length || 0}</strong> products. Use a negative value to decrease.</p>
          <div className="flex gap-2">
            <Button variant={bulkTarget === 'retail' ? 'primary' : 'secondary'} onClick={() => setBulkTarget('retail')} className="flex-1">Retail Price</Button>
            <Button variant={bulkTarget === 'wholesale' ? 'primary' : 'secondary'} onClick={() => setBulkTarget('wholesale')} className="flex-1">Wholesale Price</Button>
          </div>
          <Input label="Percentage (%)" type="number" value={bulkPercent} onChange={(e) => setBulkPercent(e.target.value)} placeholder="e.g. 10" />
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowBulkModal(false)} className="flex-1">Cancel</Button>
            <Button variant="primary" loading={bulkUpdateMutation.isPending} disabled={bulkPercent === '' || isNaN(Number(bulkPercent))}
              onClick={() => bulkUpdateMutation.mutate(Number(bulkPercent))} className="flex-1">Apply to All Products</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!historyItem} onClose={() => setHistoryItem(null)} title={historyItem ? `Price History — ${historyItem.name}` : 'Price History'}>
        {historyItem && <PriceHistory menuItemId={historyItem.id} />}
      </Modal>

      <AddCategoryModal open={showAddCategory} onClose={() => setShowAddCategory(false)} />
    </div>
  );
}

function AddCategoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  useEffect(() => { if (!open) setName(''); }, [open]);
  const addCat = useMutation({
    mutationFn: async (n: string) => { const r = await window.electronAPI.invoke('menu:categories:create', n) as { success: boolean; error?: string }; if (!r.success) throw new Error(r.error); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] });
      queryClient.invalidateQueries({ queryKey: ['menu:categories'] });
      onClose();
      toast.success('Category added');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add category'),
  });
  return (
    <Modal open={open} onClose={onClose} title="Add Category" size="sm">
      <div className="space-y-4">
        <Input label="Category Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mobile Phones" />
        <Button variant="primary" className="w-full" loading={addCat.isPending} disabled={!name.trim()} onClick={() => addCat.mutate(name.trim())}>Add Category</Button>
      </div>
    </Modal>
  );
}

function ProductTable({ items, isLoading, onEdit, onHistory, onDelete }: { items: MenuItem[]; isLoading: boolean; onEdit: (i: MenuItem) => void; onHistory: (i: MenuItem) => void; onDelete: (id: number) => void }) {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
      <div className="grid grid-cols-[44px_80px_1fr_120px_140px_110px_110px_60px_100px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
        <span></span><span>SKU</span><span>Product</span><span>Category</span><span>Supplier</span><span className="text-right">Retail</span><span className="text-right">Wholesale</span><span className="text-right">Stock</span><span className="text-right">Actions</span>
      </div>
      {isLoading ? (
        <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">Loading...</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">No products found</div>
      ) : (
        items.map((item) => {
          const isLow = !!item.reorder_level && (item.current_stock ?? 0) <= item.reorder_level;
          return (
          <div key={item.id} className="grid grid-cols-[44px_80px_1fr_120px_140px_110px_110px_60px_100px] gap-2 px-5 py-3 border-t border-outline-variant items-center hover:bg-surface-container-low transition-colors">
            <div className="w-11 h-11 rounded-lg bg-surface-container overflow-hidden shrink-0">
              {item.image_url ? (
                <img src={item.image_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><span className="material-symbols-outlined text-[18px] text-on-surface-variant">phone_android</span></div>
              )}
            </div>
            {item.sku ? (
              <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-semibold text-center truncate">{item.sku}</span>
            ) : (
              <span className="text-[13px] text-on-surface-variant">—</span>
            )}
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-on-surface truncate">{item.name}</p>
              {(item.brand || item.model) && (
                <p className="text-[12px] text-on-surface-variant truncate">{[item.brand, item.model].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            <span className="text-[13px] text-on-surface-variant">{item.category}</span>
            <span className="text-[13px] text-on-surface-variant truncate">{item.supplier_name || '—'}</span>
            <span className="text-[13px] font-semibold text-on-surface text-right">{formatCurrency(item.price)}</span>
            <span className="text-[13px] text-on-surface-variant text-right">{item.wholesale_price > 0 ? formatCurrency(item.wholesale_price) : '—'}</span>
            <span className={cn('text-[13px] font-semibold text-right', isLow ? 'text-error' : 'text-on-surface')}>
              {item.current_stock ?? '—'}
            </span>
            <div className="flex gap-1 justify-end">
              <button onClick={() => onHistory(item)} title="Price history" className="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">history</span>
              </button>
              <button onClick={() => onEdit(item)} className="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">edit</span>
              </button>
              <button onClick={() => onDelete(item.id)} className="w-8 h-8 rounded-lg hover:bg-error-container/30 flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined text-[16px] text-error">delete</span>
              </button>
            </div>
          </div>
          );
        })
      )}
    </div>
  );
}

function CategoriesPanel({ categories, onChanged }: { categories?: MenuCategory[]; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const delCat = useMutation({
    mutationFn: async (id: number) => {
      const r = await window.electronAPI.invoke('menu:categories:delete', id) as { success: boolean; error?: string };
      if (!r.success) throw new Error(r.error);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] }); onChanged(); toast.success('Category deleted'); },
    onError: (e: any) => toast.error(e.message || 'Failed to delete category'),
  });
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-on-surface-variant">Categories are used to filter products on the POS screen. Rename or delete them here.</p>
      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_120px_80px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
          <span>Name</span><span>Sort Order</span><span>Products</span><span className="text-right">Actions</span>
        </div>
        {(categories || []).map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_120px_120px_80px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
            <span className="text-[14px] font-medium text-on-surface">{c.name}</span>
            <span className="text-[13px] text-on-surface-variant">{c.sort_order}</span>
            <span className="text-[13px] text-on-surface-variant">{c.item_count}</span>
            <div className="flex gap-1 justify-end">
              <button
                onClick={async () => {
                  const name = prompt('Rename category:', c.name);
                  if (name && name.trim() && name.trim() !== c.name) {
                    await window.electronAPI.invoke('menu:categories:update', c.id, { name: name.trim() });
                    queryClient.invalidateQueries({ queryKey: ['menu:categories:list'] });
                    queryClient.invalidateQueries({ queryKey: ['menu:categories'] });
                    toast.success('Category renamed');
                  }
                }}
                className="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center transition-colors"
              >
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">edit</span>
              </button>
              <button
                onClick={() => { if (confirm(`Delete category "${c.name}"?`)) delCat.mutate(c.id); }}
                className="w-8 h-8 rounded-lg hover:bg-error-container/30 flex items-center justify-center transition-colors"
              >
                <span className="material-symbols-outlined text-[16px] text-error">delete</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseCSV(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const data = rows.filter((r) => r.length > 0 && r.some((c) => c.trim() !== ''));
  if (data.length === 0) return [];
  const header = data[0].map((h) => h.trim());
  return data.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
}