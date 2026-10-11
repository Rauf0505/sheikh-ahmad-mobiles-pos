import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpcQuery } from '../hooks/useDB';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ui/Toast';
import { formatCurrency, formatDateTime, toLocalYMD, cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Card } from '../components/ui/Card';
import type { Expense, ExpenseCategory } from '../types';

type DatePreset = 'today' | '7days' | '30days' | 'month' | 'custom';

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7days', label: 'Last 7 Days' },
  { key: '30days', label: 'Last 30 Days' },
  { key: 'month', label: 'This Month' },
];

export function ExpensesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [datePreset, setDatePreset] = useState<DatePreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

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
    const days = datePreset === '7days' ? 7 : 30;
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { dateFrom: toLocalYMD(from), dateTo: toLocalYMD(now) };
  };

  const range = getDateRange();
  const { data: expenses } = useIpcQuery<Expense[]>('expenses:list', 'expenses:list', range.dateFrom, range.dateTo);
  const { data: categories } = useIpcQuery<ExpenseCategory[]>('expenses:categories', 'expenses:categories');

  const grandTotal = (expenses || []).reduce((sum, e) => sum + e.amount, 0);

  const totalByCategory = (categories || []).map((cat) => ({
    ...cat,
    total: (expenses || []).filter((e) => e.category_id === cat.id).reduce((sum, e) => sum + e.amount, 0),
  }));

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('expenses:create', data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses:list'] });
      setShowModal(false);
      toast.success('Expense added');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add expense'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const result = await window.electronAPI.invoke('expenses:update', id, data) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses:list'] });
      setShowModal(false);
      setEditingExpense(null);
      toast.success('Expense updated');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update expense'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await window.electronAPI.invoke('expenses:delete', id) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses:list'] });
      toast.success('Expense deleted');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to delete expense'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await window.electronAPI.invoke('expenses:categories:delete', id) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses:categories'] });
      toast.success('Category deleted');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to delete category'),
  });

  const addCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const result = await window.electronAPI.invoke('expenses:categories:create', name) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses:categories'] });
      setShowCategoryModal(false);
      toast.success('Category added');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add category'),
  });

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] leading-[36px] font-bold text-on-surface">Expenses</h1>
          <p className="text-[14px] text-on-surface-variant mt-1">Track and manage business expenses</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon="category" onClick={() => setShowCategoryModal(true)}>Categories</Button>
          <Button variant="primary" icon="add" onClick={() => setShowModal(true)}>Add Expense</Button>
        </div>
      </div>

      {totalByCategory.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {totalByCategory.map((cat) => (
            <Card key={cat.id}>
              <p className="text-[12px] font-medium text-on-surface-variant uppercase tracking-wide">{cat.name}</p>
              <p className="text-[20px] font-bold text-on-surface mt-1">{formatCurrency(cat.total)}</p>
            </Card>
          ))}
          <Card className="bg-primary-container">
            <p className="text-[12px] font-medium text-on-primary-container uppercase tracking-wide">Total Expenses</p>
            <p className="text-[20px] font-bold text-on-primary-container mt-1">{formatCurrency(grandTotal)}</p>
          </Card>
        </div>
      )}

      {/* Date Presets */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {DATE_PRESETS.map((p) => (
            <button key={p.key} onClick={() => setDatePreset(p.key)}
              className={cn('h-8 px-3 rounded-full text-[13px] font-medium transition-all',
                datePreset === p.key ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              )}>
              {p.label}
            </button>
          ))}
          <button onClick={() => setDatePreset('custom')}
            className={cn('h-8 px-3 rounded-full text-[13px] font-medium transition-all',
              datePreset === 'custom' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            )}>
            Custom
          </button>
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            className="h-8 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
          <span className="text-[13px] text-on-surface-variant">to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            className="h-8 px-3 rounded-lg border border-outline-variant bg-surface text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
        <div className="grid grid-cols-[140px_140px_1fr_120px_120px_100px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
          <span>Date</span><span>Category</span><span>Description</span><span className="text-right">Amount</span><span>Recorded By</span><span className="text-right">Actions</span>
        </div>
        {!(expenses || []).length ? (
          <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">No expenses found</div>
        ) : (
          (expenses || []).map((expense) => (
            <div key={expense.id} className="grid grid-cols-[140px_140px_1fr_120px_120px_100px] gap-2 px-5 py-3 border-t border-outline-variant items-center hover:bg-surface-container-low transition-colors">
              <span className="text-[13px] text-on-surface">{formatDateTime(expense.expense_date)}</span>
              <span className="text-[13px] text-on-surface-variant">{expense.category_name || '—'}</span>
              <span className="text-[13px] text-on-surface truncate">{expense.description}</span>
              <span className="text-[13px] font-semibold text-on-surface text-right">{formatCurrency(expense.amount)}</span>
              <span className="text-[12px] text-on-surface-variant">{expense.paid_by_name || '—'}</span>
              <div className="flex gap-1 justify-end">
                <button onClick={() => { setEditingExpense(expense); setShowModal(true); }}
                  className="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center transition-colors">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">edit</span>
                </button>
                <button onClick={() => { if (confirm('Delete this expense?')) deleteMutation.mutate(expense.id); }}
                  className="w-8 h-8 rounded-lg hover:bg-error-container/30 flex items-center justify-center transition-colors">
                  <span className="material-symbols-outlined text-[16px] text-error">delete</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-[13px] text-on-surface-variant">{expenses?.length || 0} expenses &middot; Total: {formatCurrency(grandTotal)}</p>

      <Modal open={showModal} onClose={() => { setShowModal(false); setEditingExpense(null); }} title={editingExpense ? 'Edit Expense' : 'Add Expense'}>
        {editingExpense ? (
          <AddExpenseForm
            categories={categories || []}
            initial={editingExpense}
            onSubmit={(data) => updateMutation.mutate({ id: editingExpense.id, ...data })}
            loading={updateMutation.isPending}
          />
        ) : (
          <AddExpenseForm categories={categories || []} onSubmit={(data) => createMutation.mutate(data)} loading={createMutation.isPending} />
        )}
      </Modal>

      <Modal open={showCategoryModal} onClose={() => setShowCategoryModal(false)} title="Manage Expense Categories">
        <CategoryManager
          categories={categories || []}
          onAdd={(name) => addCategoryMutation.mutate(name)}
          onDelete={(id) => { if (confirm('Delete this category?')) deleteCategoryMutation.mutate(id); }}
          loading={addCategoryMutation.isPending}
        />
      </Modal>
    </div>
  );
}

function CategoryManager({ categories, onAdd, onDelete, loading }: { categories: ExpenseCategory[]; onAdd: (name: string) => void; onDelete: (id: number) => void; loading: boolean }) {
  const [newName, setNewName] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input label="New Category Name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Utilities" />
        <Button variant="primary" loading={loading} disabled={!newName} onClick={() => { onAdd(newName); setNewName(''); }} className="self-end mb-1">
          Add
        </Button>
      </div>
      <div className="space-y-1">
        {categories.map((cat) => (
          <div key={cat.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-container-low">
            <span className="text-[14px] text-on-surface">{cat.name}</span>
            <button onClick={() => onDelete(cat.id)}
              className="w-8 h-8 rounded-lg hover:bg-error-container/30 flex items-center justify-center transition-colors">
              <span className="material-symbols-outlined text-[16px] text-error">delete</span>
            </button>
          </div>
        ))}
        {categories.length === 0 && <p className="text-[13px] text-on-surface-variant text-center py-4">No categories defined</p>}
      </div>
    </div>
  );
}

function AddExpenseForm({ categories, onSubmit, loading, initial }: { categories: ExpenseCategory[]; onSubmit: (data: any) => void; loading: boolean; initial?: Expense }) {
  const { user } = useAuth();
  const [categoryId, setCategoryId] = useState(initial ? String(initial.category_id) : '');
  const [description, setDescription] = useState(initial?.description || '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [expenseDate, setExpenseDate] = useState(initial?.expense_date || toLocalYMD());
  const [notes, setNotes] = useState((initial as any)?.notes || '');

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Category</label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
          className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">Select category</option>
          {categories.map((cat) => (<option key={cat.id} value={cat.id}>{cat.name}</option>))}
        </select>
      </div>
      <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Expense description" />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Amount" type="number" prefix="Rs." value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        <div>
          <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">Date</label>
          <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)}
            className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>
      <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." />
      <Button variant="primary" className="w-full" loading={loading} disabled={!categoryId || !description || !amount}
        onClick={() => onSubmit({
          category_id: Number(categoryId),
          description,
          amount: Number(amount),
          expense_date: expenseDate,
          ...(initial ? {} : { paid_by: user?.id || 1 }),
          notes: notes || undefined,
        })}>
        {initial ? 'Update Expense' : 'Add Expense'}
      </Button>
    </div>
  );
}
