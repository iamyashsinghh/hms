'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { billing as B, insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate } from '@/lib/validate';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PayerForm } from '@/modules/insurance/payer-form';
import { ErrorBox, PAYER_TYPE_LABELS, formatINR, opt, optNum, todayIST } from '@/modules/insurance/ui';

export default function PayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('insurance.payer.read');
  const canManage = usePermission('insurance.payer.manage');
  const queryClient = useQueryClient();
  const { data: payer, isPending, error } = useQuery({ queryKey: ['insurance', 'payers', id], queryFn: () => api.insurance.payers.get(id), enabled: canRead });
  const save = useMutation({
    mutationFn: (body: I.PayerInput) => api.insurance.payers.update(id, { ...body, code: undefined } as I.UpdatePayer),
    onSuccess: (p) => {
      queryClient.setQueryData(['insurance', 'payers', id], p);
      queryClient.invalidateQueries({ queryKey: ['insurance', 'payers'], refetchType: 'none' });
    },
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  return (
    <div className="space-y-6">
      <Link href="/insurance/payers" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> All payers
      </Link>
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          {payer.name} <Badge variant="outline">{PAYER_TYPE_LABELS[payer.type]}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono">{payer.code}</span> · {payer.creditDays} days credit · TDS {payer.tdsPercent}%
          {payer.copayPercent > 0 && ` · co-pay ${payer.copayPercent}%`}
        </p>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <PayerForm key={payer.updatedAt} payer={payer} onSubmit={(b) => save.mutate(b)} pending={save.isPending} error={save.error ? errorMessage(save.error) : null} />
            {save.isSuccess && <p className="mt-2 text-sm text-muted-foreground">Saved.</p>}
          </CardContent>
        </Card>
      )}

      {payer.type !== 'tpa' && <Packages payerId={id} />}
      <PriceLists payer={payer} />
    </div>
  );
}

function Packages({ payerId }: { payerId: string }) {
  const queryClient = useQueryClient();
  const key = ['insurance', 'packages', payerId];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.insurance.payers.packages(payerId, true) });
  const blank = { id: '', code: '', name: '', specialty: '', rate: '', losDays: '' };
  const [form, setForm] = React.useState(blank);
  const [formError, setFormError] = React.useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), specialty: opt(form.specialty) ?? null, rate: Number(form.rate), losDays: optNum(form.losDays) ?? null };
      // Editing keeps the code (it is the payer's package code on claims); everything else can change.
      return form.id ? api.insurance.payers.updatePackage(payerId, form.id, body) : api.insurance.payers.createPackage(payerId, { ...body, code: form.code });
    },
    onSuccess: () => {
      setForm(blank);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const startEdit = (p: I.SchemePackage) => {
    add.reset();
    setFormError(null);
    setForm({ id: p.id, code: p.code, name: p.name, specialty: p.specialty ?? '', rate: String(p.rate), losDays: p.losDays != null ? String(p.losDays) : '' });
  };
  const toggle = useMutation({
    mutationFn: (p: I.SchemePackage) => api.insurance.payers.updatePackage(payerId, p.id, { isActive: !p.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Packages</CardTitle>
        <CardDescription>Package rates agreed with this payer, e.g. PM-JAY HBP codes or CGHS package rates. Pre-auths can name one.</CardDescription>
      </CardHeader>
      {error && <p className="px-6 text-sm text-destructive">{errorMessage(error)}</p>}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Code</TableHead>
            <TableHead>Package</TableHead>
            <TableHead>Specialty</TableHead>
            <TableHead className="text-right">Days</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).map((p) => (
            <TableRow key={p.id} className={p.isActive ? '' : 'opacity-60'}>
              <TableCell className="font-mono text-xs">{p.code}</TableCell>
              <TableCell>{p.name}</TableCell>
              <TableCell>{p.specialty ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{p.losDays ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(p.rate)}</TableCell>
              <TableCell className="text-right">
                <Can permission="insurance.payer.manage">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggle.mutate(p)}>
                    {p.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </Can>
              </TableCell>
            </TableRow>
          ))}
          {data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                No packages yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Can permission="insurance.payer.manage">
        <form
          className="flex flex-wrap items-end gap-2 border-t p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            const values = { code: form.code, name: form.name, specialty: opt(form.specialty) ?? null, rate: form.rate.trim() === '' ? undefined : Number(form.rate), losDays: optNum(form.losDays) ?? null };
            const parsed = (form.id ? I.updatePackageSchema : I.packageInputSchema).safeParse(values);
            if (form.rate.trim() === '') return setFormError('Enter the package rate');
            if (!parsed.success) {
              const issue = parsed.error.issues[0];
              return setFormError(issue ? `${issue.path.join('.') || 'Package'}: ${issue.message}` : 'Check the package');
            }
            add.mutate();
          }}
        >
          {form.id && <p className="w-full text-sm font-medium">Editing package {form.code}</p>}
          <Input className="w-32" required disabled={!!form.id} aria-label="Package code" placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input className="min-w-48 flex-1" required placeholder="Package name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input className="w-40" placeholder="Specialty" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
          <Input className="w-24" type="number" min={0} placeholder="Days" value={form.losDays} onChange={(e) => setForm({ ...form, losDays: e.target.value })} />
          <Input className="w-32" type="number" step="0.01" min={0} required placeholder="Rate ₹" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          <Button type="submit" disabled={add.isPending}>
            {form.id ? (
              'Save'
            ) : (
              <>
                <Plus /> Add
              </>
            )}
          </Button>
          {form.id && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(blank);
                setFormError(null);
                add.reset();
              }}
            >
              Cancel
            </Button>
          )}
          <div className="w-full">
            <ErrorBox error={formError ?? (add.error ? errorMessage(add.error) : toggle.error ? errorMessage(toggle.error) : null)} />
          </div>
        </form>
      </Can>
    </Card>
  );
}

/** This payer's tariff: billing price lists whose payerId is this payer. Bills raised with this payer use them. */
function PriceLists({ payer }: { payer: I.Payer }) {
  const canRead = usePermission('billing.service.read');
  const canManage = usePermission('billing.service.manage');
  const queryClient = useQueryClient();
  const lists = useQuery({ queryKey: ['billing', 'price-lists'], queryFn: () => api.billing.priceLists.list(), enabled: canRead });
  const mine = (lists.data ?? []).filter((l) => l.payerId === payer.id);
  const [editing, setEditing] = React.useState<B.PriceList | 'new' | null>(null);

  if (!canRead) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Tariff (price lists)</CardTitle>
          <CardDescription>Prices for this payer. Bills raised with this payer pick these prices first, then the cash price.</CardDescription>
        </div>
        {canManage && (
          <Button variant="outline" onClick={() => setEditing('new')}>
            <Plus /> New price list
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {mine.length === 0 && !editing && <p className="text-sm text-muted-foreground">No price list for this payer yet; bills use cash prices.</p>}
        {mine.map((l) => (
          <div key={l.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{l.name}</span> · {formatDate(l.effectiveFrom)} – {l.effectiveTo ? formatDate(l.effectiveTo) : 'open'} · {l.items.length} services
              {!l.isActive && <Badge variant="outline" className="ml-2">Inactive</Badge>}
            </span>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                Edit
              </Button>
            )}
          </div>
        ))}
        {editing && (
          <PriceListEditor
            payer={payer}
            list={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
              queryClient.invalidateQueries({ queryKey: ['billing', 'price-lists'] });
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PriceListEditor({ payer, list, onDone }: { payer: I.Payer; list: B.PriceList | null; onDone: () => void }) {
  const services = useQuery({ queryKey: ['billing', 'services', 'active'], queryFn: () => api.billing.services.list({ active: 'true', pageSize: 200 }) });
  const [name, setName] = React.useState(list?.name ?? `${payer.name} tariff`);
  const [from, setFrom] = React.useState(list?.effectiveFrom ?? todayIST());
  const [to, setTo] = React.useState(list?.effectiveTo ?? '');
  const [prices, setPrices] = React.useState<Record<string, string>>(() => Object.fromEntries((list?.items ?? []).map((i) => [i.serviceId, String(i.price)])));
  const [formError, setFormError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: B.PriceListInput) => (list ? api.billing.priceLists.update(list.id, body) : api.billing.priceLists.create(body)),
    onSuccess: onDone,
  });
  const submit = () => {
    const r = validate(B.priceListInputSchema, {
      name,
      payerId: payer.id,
      effectiveFrom: from,
      effectiveTo: to || null,
      // Keep an inactive tariff inactive on edit (the API defaults isActive to true).
      isActive: list?.isActive ?? true,
      items: Object.entries(prices)
        .filter(([, p]) => p.trim() !== '')
        .map(([serviceId, p]) => ({ serviceId, price: p })),
    });
    const msg = firstError(r.errors);
    const key = r.errors && Object.keys(r.errors)[0];
    const n = key ? /^items\.(\d+)\./.exec(key)?.[1] : undefined;
    const svcId = n !== undefined ? Object.entries(prices).filter(([, p]) => p.trim() !== '')[Number(n)]?.[0] : undefined;
    const svc = svcId ? services.data?.items.find((x) => x.id === svcId) : undefined;
    setFormError(msg ? (svc ? `${svc.code}: ${msg}` : msg) : null);
    if (r.data) save.mutate(r.data);
  };

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-60 flex-1" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} aria-label="Price list name" />
        <Input className="w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Effective from" />
        <Input className="w-40" type="date" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Effective to" />
      </div>
      <div className="max-h-96 overflow-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Service</TableHead>
              <TableHead className="text-right">Cash price</TableHead>
              <TableHead className="w-40 text-right">{payer.name} price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(services.data?.items ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <span className="font-mono text-xs">{s.code}</span> {s.name}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(s.basePrice)}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    className="text-right"
                    placeholder="—"
                    value={prices[s.id] ?? ''}
                    onChange={(e) => setPrices((p) => ({ ...p, [s.id]: e.target.value }))}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ErrorBox error={formError ?? (save.error ? errorMessage(save.error) : null)} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={save.isPending} onClick={submit}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save price list
        </Button>
      </div>
    </div>
  );
}
