'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { Patient } from '@hms/shared';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Search a registered patient by name, UHID or mobile. */
export function PatientPicker({ value, onChange }: { value: Patient | null; onChange: (p: Patient | null) => void }) {
  const [text, setText] = React.useState('');
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const { data } = useQuery({ queryKey: ['patients', { q, page: 1 }], queryFn: () => api.patients.list({ q, pageSize: 8 }), enabled: q.length >= 2 && !value });

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between rounded-md border px-3 text-sm">
        <span>
          <span className="font-medium">{fullName(value)}</span> <span className="font-mono text-xs text-muted-foreground">{value.uhid}</span>
        </span>
        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Clear patient" onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }
  const items = q.length >= 2 ? (data?.items ?? []) : [];
  return (
    <div className="relative">
      <Input placeholder="Search patient by name, UHID or mobile…" value={text} onChange={(e) => setText(e.target.value)} />
      {items.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-card py-1 text-sm shadow-lg">
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full justify-between px-3 py-2 text-left hover:bg-muted"
                onClick={() => {
                  onChange(p);
                  setText('');
                }}
              >
                <span className="font-medium">{fullName(p)}</span>
                <span className="text-xs text-muted-foreground">
                  {p.uhid} · {p.mobile ?? ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
