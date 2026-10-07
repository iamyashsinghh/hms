'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Search, TriangleAlert } from 'lucide-react';
import { ops as O } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ASSET_CATEGORY_LABELS, ASSET_STATUS, DueDate, MessageRow, Pager, StatusBadge, useDebounced } from '@/modules/ops/ui';
import { AssetForm, BreakdownForm, assetToForm, blankAssetForm, type AssetFormState } from '@/modules/ops/assets';

const PAGE_SIZE = 25;

export default function AssetsPage() {
  const canRead = usePermission('ops.asset.read');
  const canManage = usePermission('ops.asset.manage');
  const canReport = usePermission('ops.asset.report');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [dueOnly, setDueOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [form, setForm] = React.useState<AssetFormState | null>(null);
  const [reporting, setReporting] = React.useState<string | null>(null);
  const q = useDebounced(search.trim());

  const query: O.AssetQuery = {
    q: q || undefined,
    status: (status || undefined) as O.AssetStatus | undefined,
    category: (category || undefined) as O.AssetCategory | undefined,
    dueWithinDays: dueOnly ? 30 : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['ops', 'assets', query],
    queryFn: () => api.ops.assets.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  const resetPage = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Biomedical equipment"
        description="Equipment register with preventive maintenance, calibration, warranty and AMC due dates."
        actions={
          <Can permission="ops.asset.manage">
            <Button onClick={() => setForm({ ...blankAssetForm })}>
              <Plus /> Add equipment
            </Button>
          </Can>
        }
      />

      {form && canManage && <AssetForm key={form.id ?? 'new'} initial={form} onDone={() => setForm(null)} />}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search code, name, serial no.…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
            />
          </div>
          <Select
            className="w-48"
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              resetPage();
            }}
          >
            <option value="">All statuses</option>
            {O.ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ASSET_STATUS[s].label}
              </option>
            ))}
          </Select>
          <Select
            className="w-44"
            aria-label="Category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              resetPage();
            }}
          >
            <option value="">All categories</option>
            {O.ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {ASSET_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dueOnly}
              onChange={(e) => {
                setDueOnly(e.target.checked);
                resetPage();
              }}
            />
            Due within 30 days
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
                <TableHead>Equipment</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next PM</TableHead>
                <TableHead>Calibration</TableHead>
                <TableHead>Warranty / AMC</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <MessageRow cols={8}>Loading…</MessageRow>
              ) : data.items.length === 0 ? (
                <MessageRow cols={8}>No equipment found.</MessageRow>
              ) : (
                data.items.map((a) => (
                  <React.Fragment key={a.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs">{a.code}</TableCell>
                      <TableCell>
                        <Link href={`/ops/assets/${a.id}`} className="font-medium text-primary hover:underline">
                          {a.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {ASSET_CATEGORY_LABELS[a.category]}
                          {[a.make, a.model].filter(Boolean).length > 0 && ` · ${[a.make, a.model].filter(Boolean).join(' ')}`}
                          {a.criticality === 'high' && (
                            <Badge variant="destructive" className="ml-2">
                              High criticality
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{a.location ?? '—'}</TableCell>
                      <TableCell>
                        <StatusBadge s={ASSET_STATUS[a.status]} />
                        {a.openWorkOrders > 0 && <div className="mt-1 text-xs text-muted-foreground">{a.openWorkOrders} open WO</div>}
                      </TableCell>
                      <TableCell>
                        <DueDate date={a.nextPmDue} />
                      </TableCell>
                      <TableCell>
                        <DueDate date={a.calibrationDue} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>
                          W: <DueDate date={a.warrantyUntil} />
                        </div>
                        <div>
                          AMC: <DueDate date={a.amcUntil} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canReport && a.status !== 'condemned' && (
                            <Button size="sm" variant="outline" onClick={() => setReporting(reporting === a.id ? null : a.id)}>
                              <TriangleAlert /> Report breakdown
                            </Button>
                          )}
                          {canManage && (
                            <Button size="sm" variant="ghost" onClick={() => setForm(assetToForm(a))}>
                              Edit
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {reporting === a.id && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={8}>
                          <BreakdownForm asset={a} onDone={() => setReporting(null)} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        )}
        <Pager data={data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}
