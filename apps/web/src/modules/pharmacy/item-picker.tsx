'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { pharmacy } from '@hms/shared';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { SCHEDULE_LABEL } from './format';

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Type-ahead search over the drug master. Calls onPick and clears itself. */
export function ItemPicker({ onPick, placeholder = 'Search drug by name, generic or code…', autoFocus }: { onPick: (item: pharmacy.Item) => void; placeholder?: string; autoFocus?: boolean }) {
  const [text, setText] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const q = useDebounced(text.trim());
  const { data } = useQuery({
    queryKey: ['pharmacy', 'items', 'pick', q],
    queryFn: () => api.pharmacy.items.list({ q, pageSize: 10 }),
    enabled: q.length >= 2,
  });
  const items = q.length >= 2 ? (data?.items ?? []) : [];

  const pick = (item: pharmacy.Item) => {
    onPick(item);
    setText('');
    setOpen(false);
    setActive(0);
  };

  return (
    <div className="relative">
      <Input
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            pick(items[active]);
          }
        }}
      />
      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-card py-1 text-sm shadow-lg">
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${i === active ? 'bg-muted' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(it)}
              >
                <span>
                  <span className="font-medium">{it.name}</span>
                  {it.genericName && <span className="text-muted-foreground"> · {it.genericName}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {it.code} · {SCHEDULE_LABEL[it.schedule]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
