'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Search, X } from 'lucide-react';
import type { lab as L, Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ErrorBox, Field, PatientPicker, formatINR, useDebounced } from '@/modules/billing/ui';

export default function NewLabOrderPage() {
  const canCreate = usePermission('lab.order.create');
  const canCollect = usePermission('billing.payment.collect');
  const router = useRouter();
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [doctorId, setDoctorId] = React.useState('');
  const [referredBy, setReferredBy] = React.useState('');
  const [source, setSource] = React.useState<'walkin' | 'b2b'>('walkin');
  const [priority, setPriority] = React.useState<L.OrderPriority>('routine');
  const [clinicalNotes, setClinicalNotes] = React.useState('');
  const [picked, setPicked] = React.useState<L.Orderable[]>([]);
  const [bill, setBill] = React.useState(true);
  const [payMode, setPayMode] = React.useState<'' | 'cash' | 'upi' | 'card'>('cash');
  const [term, setTerm] = React.useState('');
  const q = useDebounced(term.trim(), 200);

  const { data: orderables } = useQuery({ queryKey: ['lab', 'orderables'], queryFn: () => api.lab.orderables(), enabled: canCreate, staleTime: 60_000 });
  const { data: doctors } = useQuery({ queryKey: ['setup', 'doctors'], queryFn: () => api.setup.listDoctors(), enabled: canCreate, retry: false });

  const matches = React.useMemo(() => {
    if (!orderables || !q) return [];
    const t = q.toLowerCase();
    return orderables.filter((o) => !picked.some((p) => p.id === o.id) && (o.code.toLowerCase().startsWith(t) || o.name.toLowerCase().includes(t))).slice(0, 10);
  }, [orderables, q, picked]);
  const total = picked.reduce((a, p) => a + p.price, 0);

  const create = useMutation({
    mutationFn: () =>
      api.lab.orders.create({
        patientId: patient!.id,
        source,
        priority,
        doctorId: doctorId || undefined,
        referredBy: referredBy || undefined,
        clinicalNotes: clinicalNotes || undefined,
        items: picked.map((p) => (p.kind === 'panel' ? { panelId: p.id } : { testId: p.id })),
        bill,
        payNow: bill && payMode && canCollect && total > 0 ? { mode: payMode, amount: total } : undefined,
      }),
    onSuccess: (o) => router.push(`/lab/orders/${o.id}`),
  });

  if (!canCreate) return <NoAccess />;
  const add = (o: L.Orderable) => {
    setPicked([...picked, o]);
    setTerm('');
  };

  return (
    <>
      <PageHeader title="New lab order" description="Book tests for a walk-in or referred patient. Barcodes are created for each sample type." />
      <form
        className="grid gap-6 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Patient and referral</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <PatientPicker value={patient} onChange={setPatient} />
              </div>
              <Field id="doctor" label="Referring doctor (staff)">
                <Select id="doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  <option value="">None / outside doctor</option>
                  {doctors?.map((d) => (
                    <option key={d.userId} value={d.userId}>
                      {d.name}
                      {d.specialization ? ` (${d.specialization})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="referred" label="Outside doctor / B2B client">
                <Input id="referred" maxLength={200} value={referredBy} onChange={(e) => setReferredBy(e.target.value)} placeholder="e.g. Dr. Sharma Clinic" />
              </Field>
              <Field id="source" label="Order type">
                <Select id="source" value={source} onChange={(e) => setSource(e.target.value as 'walkin' | 'b2b')}>
                  <option value="walkin">Walk-in / referral</option>
                  <option value="b2b">B2B (collection centre, clinic)</option>
                </Select>
              </Field>
              <Field id="priority" label="Priority">
                <Select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as L.OrderPriority)}>
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">STAT</option>
                </Select>
              </Field>
              <Field id="notes" label="Clinical notes" className="sm:col-span-2">
                <Input id="notes" maxLength={1000} value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} placeholder="Provisional diagnosis, fasting status, medication…" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Type a test or panel name or code (CBC, LFT, TSH…)"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && matches[0]) {
                      e.preventDefault();
                      add(matches[0]);
                    }
                  }}
                  aria-label="Find test"
                />
                {matches.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-card shadow-lg">
                    {matches.map((o) => (
                      <button key={o.id} type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => add(o)}>
                        <span>
                          <span className="font-medium">{o.name}</span> <span className="font-mono text-xs text-muted-foreground">{o.code}</span>
                          {o.kind === 'panel' && (
                            <Badge variant="secondary" className="ml-2">
                              Panel
                            </Badge>
                          )}
                        </span>
                        <span className="tabular-nums">{formatINR(o.price)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {orderables && orderables.length === 0 && (
                <p className="text-sm text-muted-foreground">The test catalogue is empty. Add tests under Tests &amp; panels first.</p>
              )}
              {picked.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tests added yet.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {picked.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        {p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{formatINR(p.price)}</span>
                        <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${p.name}`} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>
                          <X />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Bill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-2xl font-semibold tabular-nums">{formatINR(total)}</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bill} onChange={(e) => setBill(e.target.checked)} /> Bill now
            </label>
            {!bill && <p className="text-xs text-muted-foreground">The tests go on the patient&apos;s account and are billed at the billing desk.</p>}
            {bill && canCollect && (
              <Field id="pay" label="Collect payment">
                <Select id="pay" value={payMode} onChange={(e) => setPayMode(e.target.value as typeof payMode)}>
                  <option value="">Not now (bill stays unpaid)</option>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                </Select>
              </Field>
            )}
            <ErrorBox error={create.error ? errorMessage(create.error) : null} />
            <Button type="submit" className="w-full" disabled={!patient || picked.length === 0 || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Book order
            </Button>
          </CardContent>
        </Card>
      </form>
    </>
  );
}
