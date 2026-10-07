'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ipd as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BED_STATUS_LABELS, BedStatusDot, ErrorBox, Field, WARD_TYPE_LABELS, formatINR } from '@/modules/ipd/ui';

export default function WardsPage() {
  const canManage = usePermission('ipd.ward.manage');
  const queryClient = useQueryClient();
  const { data: wards, error } = useQuery({ queryKey: ['ipd', 'wards', 'all'], queryFn: () => api.ipd.wards.list(true), enabled: canManage });
  const [selected, setSelected] = React.useState<string | null>(null);
  const ward = wards?.find((w) => w.id === selected) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipd'] });

  if (!canManage) return <NoAccess />;

  return (
    <>
      <PageHeader title="Wards & beds" description="Set up wards with a default daily rate, then add beds. Room rent is charged per day from the bed's rate." />
      <ErrorBox error={error ? errorMessage(error) : null} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Code</TableHead>
                  <TableHead>Ward</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Rate / day</TableHead>
                  <TableHead className="text-right">Beds</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!wards?.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      No wards yet. Add one on the right.
                    </TableCell>
                  </TableRow>
                ) : (
                  wards.map((w) => (
                    <TableRow key={w.id} className={w.isActive ? '' : 'text-muted-foreground'} data-state={w.id === selected ? 'selected' : undefined}>
                      <TableCell className="font-mono text-xs">{w.code}</TableCell>
                      <TableCell className="font-medium">
                        {w.name}
                        {!w.isActive && ' (closed)'}
                      </TableCell>
                      <TableCell>{WARD_TYPE_LABELS[w.wardType]}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(w.defaultDailyRate)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {w.occupiedCount}/{w.bedCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant={w.id === selected ? 'secondary' : 'ghost'} onClick={() => setSelected(w.id === selected ? null : w.id)}>
                          {w.id === selected ? 'Close' : 'Beds'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
          {ward && <WardBeds ward={ward} onChanged={refresh} />}
        </div>
        <div className="space-y-6">
          <NewWard onDone={refresh} />
          {ward && <AddBeds key={ward.id} ward={ward} onDone={refresh} />}
        </div>
      </div>
    </>
  );
}

function NewWard({ onDone }: { onDone: () => void }) {
  const empty = { code: '', name: '', wardType: 'general' as I.WardType, floor: '', defaultDailyRate: '' };
  const [form, setForm] = React.useState(empty);
  const create = useMutation({
    mutationFn: (body: I.WardInput) => api.ipd.wards.create(body),
    onSuccess: () => {
      setForm(empty);
      onDone();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>New ward</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ ...form, floor: form.floor || undefined, defaultDailyRate: Number(form.defaultDailyRate) || 0 });
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <Field id="w-code" label="Code">
              <Input id="w-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required maxLength={20} placeholder="GW" />
            </Field>
            <Field id="w-name" label="Name" className="col-span-2">
              <Input id="w-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} placeholder="General ward (male)" />
            </Field>
          </div>
          <Field id="w-type" label="Type">
            <Select id="w-type" value={form.wardType} onChange={(e) => setForm({ ...form, wardType: e.target.value as I.WardType })}>
              {I.WARD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {WARD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="w-floor" label="Floor">
              <Input id="w-floor" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} maxLength={40} />
            </Field>
            <Field id="w-rate" label="Rate / day (₹)">
              <Input id="w-rate" type="number" min={0} step="0.01" value={form.defaultDailyRate} onChange={(e) => setForm({ ...form, defaultDailyRate: e.target.value })} />
            </Field>
          </div>
          <ErrorBox error={create.error ? errorMessage(create.error) : null} />
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Add ward
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AddBeds({ ward, onDone }: { ward: I.Ward; onDone: () => void }) {
  const [form, setForm] = React.useState({ prefix: `${ward.code}-`, from: '1', to: '10', dailyRate: '', chargeServiceCode: '' });
  const create = useMutation({
    mutationFn: (body: I.BulkBeds) => api.ipd.beds.createMany(body),
    onSuccess: onDone,
  });
  const count = Math.max(0, Number(form.to) - Number(form.from) + 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add beds to {ward.name}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-3 gap-3">
          <Field id="b-prefix" label="Prefix">
            <Input id="b-prefix" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} maxLength={10} />
          </Field>
          <Field id="b-from" label="From">
            <Input id="b-from" type="number" min={0} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </Field>
          <Field id="b-to" label="To">
            <Input id="b-to" type="number" min={0} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </Field>
        </div>
        <Field id="b-rate" label={`Rate / day (blank = ward rate ${formatINR(ward.defaultDailyRate)})`}>
          <Input id="b-rate" type="number" min={0} step="0.01" value={form.dailyRate} onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} />
        </Field>
        <Field id="b-svc" label="Billing service code for room rent (optional)">
          <Input id="b-svc" value={form.chargeServiceCode} onChange={(e) => setForm({ ...form, chargeServiceCode: e.target.value.toUpperCase() })} maxLength={40} />
        </Field>
        <ErrorBox error={create.error ? errorMessage(create.error) : null} />
        <Button
          disabled={create.isPending || count < 1}
          onClick={() =>
            create.mutate({
              wardId: ward.id,
              prefix: form.prefix,
              from: Number(form.from),
              to: Number(form.to),
              dailyRate: form.dailyRate === '' ? undefined : Number(form.dailyRate),
              chargeServiceCode: form.chargeServiceCode || undefined,
            })
          }
        >
          Add {count} bed{count === 1 ? '' : 's'} ({form.prefix}
          {form.from}
          {count > 1 ? ` to ${form.prefix}${form.to}` : ''})
        </Button>
      </CardContent>
    </Card>
  );
}

function WardBeds({ ward, onChanged }: { ward: I.Ward; onChanged: () => void }) {
  const { data: beds, error } = useQuery({
    queryKey: ['ipd', 'beds', ward.id, 'all'],
    queryFn: () => api.ipd.beds.list({ wardId: ward.id, includeInactive: 'true' }),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; body: I.UpdateBed }) => api.ipd.beds.update(v.id, v.body),
    onSuccess: onChanged,
  });
  const status = useMutation({
    mutationFn: (v: { id: string; status: I.ManualBedStatus }) => api.ipd.beds.setStatus(v.id, { status: v.status }),
    onSuccess: onChanged,
  });
  const closeWard = useMutation({
    mutationFn: (isActive: boolean) => api.ipd.wards.update(ward.id, { isActive }),
    onSuccess: onChanged,
  });
  const err = error ?? update.error ?? status.error ?? closeWard.error;

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between">
        <CardTitle>Beds in {ward.name}</CardTitle>
        <Button size="sm" variant="ghost" disabled={closeWard.isPending} onClick={() => closeWard.mutate(!ward.isActive)}>
          {ward.isActive ? 'Close ward' : 'Reopen ward'}
        </Button>
      </CardHeader>
      <CardContent className="pb-2">
        <ErrorBox error={err ? errorMessage(err) : null} />
      </CardContent>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Bed</TableHead>
            <TableHead>Room</TableHead>
            <TableHead className="text-right">Rate / day</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {!beds?.length ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                No beds yet.
              </TableCell>
            </TableRow>
          ) : (
            beds.map((b) => (
              <TableRow key={b.id} className={b.isActive ? '' : 'text-muted-foreground'}>
                <TableCell className="font-medium">{b.code}</TableCell>
                <TableCell>{b.roomNo ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(b.dailyRate)}</TableCell>
                <TableCell>
                  {b.isActive ? (
                    <span className="inline-flex items-center gap-2">
                      <BedStatusDot status={b.status} /> {BED_STATUS_LABELS[b.status]}
                      {b.occupant && <span className="text-xs text-muted-foreground">· {b.occupant.patientName}</span>}
                    </span>
                  ) : (
                    'Retired'
                  )}
                </TableCell>
                <TableCell className="space-x-1 whitespace-nowrap text-right">
                  {b.isActive && b.status !== 'occupied' && (
                    <Select
                      aria-label={`Status of ${b.code}`}
                      className="inline-flex h-8 w-36 text-xs"
                      value={b.status}
                      onChange={(e) => status.mutate({ id: b.id, status: e.target.value as I.ManualBedStatus })}
                    >
                      {I.MANUAL_BED_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {BED_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const v = window.prompt(`New daily rate for ${b.code} (₹)`, String(b.dailyRate));
                      if (v !== null && v.trim() !== '' && !Number.isNaN(Number(v))) update.mutate({ id: b.id, body: { dailyRate: Number(v) } });
                    }}
                  >
                    Rate
                  </Button>
                  {b.status !== 'occupied' && (
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: b.id, body: { isActive: !b.isActive } })}>
                      {b.isActive ? 'Retire' : 'Restore'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
