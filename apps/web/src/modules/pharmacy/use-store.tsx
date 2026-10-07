'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { pharmacy } from '@hms/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Select } from '@/components/ui/input';

const KEY = 'hms.pharmacy.storeId';

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The pharmacy store (counter) the user works at; remembered per browser, defaulting to the current facility's. */
export function useActiveStore() {
  const { facility } = useAuth();
  const { data: stores, isPending, error } = useQuery({ queryKey: ['pharmacy', 'stores'], queryFn: () => api.pharmacy.stores.list() });
  const [chosen, setChosen] = React.useState<string | null>(() => (typeof window === 'undefined' ? null : stored()));

  const store: pharmacy.Store | undefined =
    stores?.find((s) => s.id === chosen) ?? stores?.find((s) => s.facilityId === facility?.id) ?? stores?.[0];

  const setStore = React.useCallback((id: string) => {
    setChosen(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  }, []);

  return { stores: stores ?? [], store, setStore, isPending, error };
}

export function StorePicker({ active }: { active: ReturnType<typeof useActiveStore> }) {
  if (active.isPending) return null;
  if (!active.stores.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No pharmacy store yet.{' '}
        <Link href="/pharmacy/stores" className="text-primary hover:underline">
          Create one
        </Link>
      </p>
    );
  }
  return (
    <Select aria-label="Store" className="w-56" value={active.store?.id ?? ''} onChange={(e) => active.setStore(e.target.value)}>
      {active.stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}
