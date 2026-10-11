import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDateTime } from '../lib/utils';

export function PriceHistory({ menuItemId }: { menuItemId: number }) {
  const { data } = useQuery({
    queryKey: ['product-prices:list', menuItemId],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('product-prices:list', menuItemId) as { success: boolean; data?: any[] };
      return result.data || [];
    },
  });

  if (!data?.length) {
    return <p className="text-[14px] text-on-surface-variant py-6 text-center">No price history recorded for this product yet</p>;
  }

  return (
    <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
      <div className="grid grid-cols-[100px_1fr_90px_90px_90px_110px] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
        <span>Date</span><span>Source</span><span className="text-right">Cost</span><span className="text-right">Retail</span><span className="text-right">Wholesale</span><span>By</span>
      </div>
      {data.map((pp) => (
        <div key={pp.id} className="grid grid-cols-[100px_1fr_90px_90px_90px_110px] gap-2 px-5 py-3 border-t border-outline-variant items-center">
          <span className="text-[12px] text-on-surface">{formatDateTime(pp.created_at)}</span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-on-surface capitalize">{pp.source === 'purchase' ? `Purchase${pp.supplier_name ? ` · ${pp.supplier_name}` : ''}` : 'Manual edit'}</p>
            {pp.notes && <p className="text-[11px] text-on-surface-variant truncate">{pp.notes}</p>}
          </div>
          <span className="text-[12px] text-on-surface text-right">{formatCurrency(pp.cost_price)}</span>
          <span className="text-[12px] text-on-surface text-right">{formatCurrency(pp.retail_price)}</span>
          <span className="text-[12px] text-on-surface-variant text-right">{formatCurrency(pp.wholesale_price)}</span>
          <span className="text-[12px] text-on-surface-variant truncate">{pp.created_by_name || '—'}</span>
        </div>
      ))}
    </div>
  );
}