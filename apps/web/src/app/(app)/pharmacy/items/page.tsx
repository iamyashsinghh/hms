'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SCHEDULE_LABEL } from '@/modules/pharmacy/format';
import { ImportDrugsButton } from '@/modules/pharmacy/import-drugs';

const PAGE_SIZE = 25;

export default function DrugMasterPage() {
  const canRead = usePermission('pharmacy.item.read');
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [includeInactive, setIncludeInactive] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['pharmacy', 'items', { q, page, includeInactive }],
    queryFn: () => api.pharmacy.items.list({ q: q || undefined, page, pageSize: PAGE_SIZE, includeInactive }),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Drug master"
        description="Every drug and consumable the pharmacy stocks, with HSN, GST and schedule."
        actions={
          <Can permission="pharmacy.item.manage">
            <div className="flex gap-2">
              <ImportDrugsButton />
              <Link href="/pharmacy/items/new" className={buttonVariants()}>
                <Plus /> Add drug
              </Link>
            </div>
          </Can>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search drugs…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Show inactive
          </label>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Form / strength</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead>Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No drugs yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((it) => (
                  <TableRow key={it.id} className="cursor-pointer" onClick={() => router.push(`/pharmacy/items/${it.id}`)}>
                    <TableCell className="font-mono text-xs">{it.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {it.name} {!it.isActive && <Badge variant="outline">Inactive</Badge>}
                      </div>
                      {it.genericName && <div className="text-xs text-muted-foreground">{it.genericName}</div>}
                    </TableCell>
                    <TableCell className="capitalize">{[it.form, it.strength].filter(Boolean).join(' · ')}</TableCell>
                    <TableCell>
                      <Badge variant={it.schedule === 'otc' ? 'secondary' : 'accent'}>{SCHEDULE_LABEL[it.schedule]}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{it.hsnCode ?? '—'}</TableCell>
                    <TableCell className="text-right">{it.gstRate}%</TableCell>
                    <TableCell>
                      {it.unit}
                      {it.packSize > 1 && <span className="text-xs text-muted-foreground"> ×{it.packSize}</span>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft /> Prev
              </Button>
              <span>
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
