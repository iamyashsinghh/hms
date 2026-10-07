'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { estimateLine, expiryLabel, inr } from './format';

/** Shows sellable stock of an item and what `qty` would cost, picking batches first-expiry-first-out like the server. */
export function useFefoEstimate(storeId: string | undefined, itemId: string | undefined, qty: number, discountPct = 0) {
  const { data } = useQuery({
    queryKey: ['pharmacy', 'batches', storeId, itemId],
    queryFn: () => api.pharmacy.stock.batches(storeId!, itemId!),
    enabled: !!storeId && !!itemId,
  });
  const sellable = (data ?? []).filter((b) => !b.isExpired);
  const available = sellable.reduce((s, b) => s + b.qty, 0);
  let left = qty;
  let amount = 0;
  for (const b of sellable) {
    if (left <= 0) break;
    const take = Math.min(left, b.qty);
    amount += estimateLine(b.saleRate, take, discountPct);
    left -= take;
  }
  return { loaded: !!data, available, amount, short: left > 0, first: sellable[0] };
}

export function StockHint({ est }: { est: ReturnType<typeof useFefoEstimate> }) {
  if (!est.loaded) return null;
  return (
    <span className={`text-xs ${est.short ? 'text-destructive' : 'text-muted-foreground'}`}>
      {est.available} in stock
      {est.first && ` · ${inr(est.first.saleRate)} · exp ${expiryLabel(est.first.expiryDate)}`}
    </span>
  );
}
