'use client';

// "+ Add item" on the billing desk: search the service master by name or code ("xray ch…").
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { billing as B } from '@hms/shared';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { CATEGORY_LABELS, formatINR, useDebounced } from '@/modules/billing/ui';

const RECENT_KEY = 'hms.billing.recentServices';
const RECENT_MAX = 6;

/** Letters and digits only, so "xray" finds "X-ray" and "x ray". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Every word typed must appear in the name or code. */
function matches(s: B.Service, words: string[]) {
  const hay = norm(`${s.name} ${s.code}`);
  return words.every((w) => hay.includes(w));
}

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberRecent(code: string) {
  try {
    const next = [code, ...readRecent().filter((c) => c !== code)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recent items are a convenience only.
  }
}

export function ServiceSearch({ onPick, autoFocus }: { onPick: (s: B.Service) => void; autoFocus?: boolean }) {
  const [term, setTerm] = React.useState('');
  const [active, setActive] = React.useState(0);
  // Rendered only after "Add item" is pressed, so reading browser storage here never runs on the server.
  const [recent, setRecent] = React.useState<string[]>(readRecent);
  const q = useDebounced(term.trim(), 200);
  const words = React.useMemo(() => q.split(/\s+/).map(norm).filter(Boolean), [q]);

  // The active master (most hospitals have a few hundred services) is matched word by word here;
  // the server search covers masters larger than one page.
  const { data: master } = useQuery({
    queryKey: ['billing', 'services', 'active'],
    queryFn: () => api.billing.services.list({ active: 'true', pageSize: 200 }),
    staleTime: 60_000,
  });
  const longest = [...q.split(/\s+/)].sort((a, b) => b.length - a.length)[0] ?? '';
  const { data: remote, isFetching } = useQuery({
    queryKey: ['billing', 'services', { q: longest, picker: true }],
    queryFn: () => api.billing.services.list({ q: longest, active: 'true', pageSize: 30 }),
    enabled: longest.length >= 2 && (master?.total ?? 0) > (master?.items.length ?? 0),
  });

  const results = React.useMemo(() => {
    if (!words.length) return [];
    const seen = new Set<string>();
    const out: B.Service[] = [];
    for (const s of [...(master?.items ?? []), ...(remote?.items ?? [])]) {
      if (seen.has(s.id) || !matches(s, words)) continue;
      seen.add(s.id);
      out.push(s);
    }
    // Exact code first, then names that start with what was typed.
    const first = words[0]!;
    return out
      .sort((a, b) => {
        const ra = norm(a.code) === first ? 0 : norm(a.name).startsWith(first) ? 1 : 2;
        const rb = norm(b.code) === first ? 0 : norm(b.name).startsWith(first) ? 1 : 2;
        return ra - rb || a.name.localeCompare(b.name);
      })
      .slice(0, 12);
  }, [words, master, remote]);

  const recentServices = React.useMemo(() => {
    const byCode = new Map((master?.items ?? []).map((s) => [s.code, s]));
    return recent.flatMap((c) => (byCode.has(c) ? [byCode.get(c)!] : []));
  }, [recent, master]);

  const pick = (s: B.Service) => {
    rememberRecent(s.code);
    setRecent(readRecent());
    setTerm('');
    setActive(0);
    onPick(s);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search services"
          className="pl-9"
          placeholder="Search by name or code, e.g. xray chest…"
          value={term}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(e) => {
            setTerm(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (!results.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(results[active] ?? results[0]!);
            } else if (e.key === 'Escape') {
              setTerm('');
            }
          }}
        />
      </div>
      {!words.length && recentServices.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Recent:</span>
          {recentServices.map((s) => (
            <button key={s.id} type="button" className="rounded-full border px-2.5 py-0.5 hover:bg-muted" onClick={() => pick(s)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      {words.length > 0 && (
        <div role="listbox" className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border bg-card shadow-lg">
          {results.length ? (
            results.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted ${i === active ? 'bg-muted' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
              >
                <span className="min-w-0">
                  <span className="font-medium">{s.name}</span>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                  <span className="block text-xs text-muted-foreground">
                    {CATEGORY_LABELS[s.category]}
                    {s.packageItems?.length ? ` · package of ${s.packageItems.length}` : ''}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatINR(s.basePrice)}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">{isFetching ? 'Searching…' : 'No service matches. Add it in Services & prices first.'}</p>
          )}
        </div>
      )}
    </div>
  );
}
