'use client';

// Pick an admitted patient to issue consumables for (charged to their IPD bill per the billing rules).
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import type { ipd } from '@hms/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/modules/billing/ui';

export function AdmittedPatientPicker({ value, onChange }: { value: ipd.AdmissionSummary | null; onChange: (a: ipd.AdmissionSummary | null) => void }) {
  const [term, setTerm] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const q = useDebounced(term.trim());
  const { data, isFetching } = useQuery({
    queryKey: ['inventory', 'admitted-patients', q],
    queryFn: () => api.inventory.indents.admittedPatients(q || undefined),
    enabled: !value && open,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          {value.patientName} <span className="text-muted-foreground">· {value.patientUhid} · {value.ipdNo}</span>
          {value.bedLabel && <span className="text-muted-foreground"> · {[value.wardName, value.bedLabel].filter(Boolean).join(' ')}</span>}
        </span>
        <Button type="button" size="sm" variant="ghost" className="h-7" aria-label="Clear patient" onClick={() => onChange(null)}>
          <X className="size-4" />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="issue-patient"
        className="pl-8"
        value={term}
        placeholder="Admitted patient: name, UHID or IPD number"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setTerm(e.target.value)}
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-background shadow-md">
          {isFetching && !data && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
          {data?.items.length === 0 && <p className="p-3 text-sm text-muted-foreground">No admitted patient found.</p>}
          {data?.items.map((a) => (
            <button
              key={a.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(a);
                setTerm('');
                setOpen(false);
              }}
            >
              <span>{a.patientName}</span>
              <span className="text-xs text-muted-foreground">
                {a.patientUhid} · {a.ipdNo}
                {a.bedLabel ? ` · ${[a.wardName, a.bedLabel].filter(Boolean).join(' ')}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
