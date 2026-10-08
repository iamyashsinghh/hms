'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ipd as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { BulkImportButton } from '@/components/bulk-import';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BED_STATUS_LABELS, BedStatusDot, ErrorBox, Field, WARD_TYPE_LABELS, fieldErrors, formatINR } from '@/modules/ipd/ui';

export default function WardsPage() {
  const canManage = usePermission('ipd.ward.manage');
  const queryClient = useQueryClient();
  const { data: wards, error } = useQuery({
    queryKey: ['ipd', 'wards', 'all'],
    queryFn: () => api.ipd.wards.list(true),
    enabled: canManage,
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const ward = wards?.find((w) => w.id === selected) ?? null;
  const editWard = wards?.find((w) => w.id === editing) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipd'] });

  if (!canManage) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Wards & beds"
        description="Set up wards with a default daily rate, then add beds. Room rent is charged per day from the bed's rate."
        actions={
          <BulkImportButton buttonLabel="Import beds from Excel" noun="beds" columns={I.BED_IMPORT_COLUMNS} run={(req) => api.ipd.beds.import(req)} invalidate={[['ipd']]} />
        }
      />
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
                      <TableCell className="whitespace-nowrap text-right">
                        <Button size="sm" variant={w.id === editing ? 'secondary' : 'ghost'} onClick={() => setEditing(w.id === editing ? null : w.id)}>
                          Edit
                        </Button>
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
          {editWard ? (
            <WardForm
              key={editWard.id}
              initial={editWard}
              onDone={() => {
                setEditing(null);
                refresh();
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <WardForm onDone={refresh} />
          )}
          {ward && ward.isActive && (
            <Card>
              <CardHeader>
                <CardTitle>Add one bed to {ward.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <BedForm key={ward.id} ward={ward} onDone={refresh} />
              </CardContent>
            </Card>
          )}
          {ward && ward.isActive && <AddBeds key={ward.id} ward={ward} onDone={refresh} />}
        </div>
      </div>
    </>
  );
}

function WardForm({ initial, onDone, onCancel }: { initial?: I.Ward; onDone: () => void; onCancel?: () => void }) {
  const empty = {
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    wardType: initial?.wardType ?? ('general' as I.WardType),
    floor: initial?.floor ?? '',
    defaultDailyRate: initial ? String(initial.defaultDailyRate) : '',
  };
  const [form, setForm] = React.useState(empty);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: () => {
      const common = {
        name: form.name,
        wardType: form.wardType,
        floor: form.floor,
        defaultDailyRate: form.defaultDailyRate === '' ? 0 : Number(form.defaultDailyRate),
      };
      return initial ? api.ipd.wards.update(initial.id, common) : api.ipd.wards.create({ ...common, code: form.code, floor: form.floor || undefined });
    },
    onSuccess: () => {
      if (!initial) setForm(empty);
      onDone();
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const rate = form.defaultDailyRate === '' ? 0 : Number(form.defaultDailyRate);
    const parsed = initial
      ? I.updateWardSchema.safeParse({
          name: form.name,
          wardType: form.wardType,
          floor: form.floor,
          defaultDailyRate: rate,
        })
      : I.wardInputSchema.safeParse({
          ...form,
          floor: form.floor || undefined,
          defaultDailyRate: rate,
        });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error.issues));
    if (parsed.success) save.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial ? `Edit ward ${initial.code}` : 'New ward'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" noValidate onSubmit={submit}>
          <div className="grid grid-cols-3 gap-3">
            <Field id="w-code" label="Code" error={errors.code}>
              <Input
                id="w-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                required
                maxLength={20}
                placeholder="GW"
                disabled={!!initial}
                title={initial ? 'The ward code cannot be changed' : undefined}
              />
            </Field>
            <Field id="w-name" label="Name" className="col-span-2" error={errors.name}>
              <Input
                id="w-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={100}
                placeholder="General ward (male)"
              />
            </Field>
          </div>
          <Field id="w-type" label="Type" error={errors.wardType}>
            <Select id="w-type" value={form.wardType} onChange={(e) => setForm({ ...form, wardType: e.target.value as I.WardType })}>
              {I.WARD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {WARD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="w-floor" label="Floor" error={errors.floor}>
              <Input id="w-floor" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} maxLength={40} />
            </Field>
            <Field id="w-rate" label="Rate / day (₹)" error={errors.defaultDailyRate}>
              <Input
                id="w-rate"
                type="number"
                min={0}
                step="0.01"
                value={form.defaultDailyRate}
                onChange={(e) => setForm({ ...form, defaultDailyRate: e.target.value })}
              />
            </Field>
          </div>
          {initial && (
            <p className="text-xs text-muted-foreground">A new ward rate applies to beds added later; change existing beds&apos; rates bed by bed.</p>
          )}
          <ErrorBox error={save.error ? errorMessage(save.error) : null} />
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} {initial ? 'Save ward' : 'Add ward'}
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** One bed, new or edited. */
function BedForm({ ward, initial, onDone, onCancel }: { ward: I.Ward; initial?: I.Bed; onDone: () => void; onCancel?: () => void }) {
  const empty = {
    code: initial?.code ?? '',
    roomNo: initial?.roomNo ?? '',
    dailyRate: initial ? String(initial.dailyRate) : '',
    chargeServiceCode: initial?.chargeServiceCode ?? '',
  };
  const [form, setForm] = React.useState(empty);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const body = () => ({
    code: form.code,
    dailyRate: form.dailyRate === '' ? undefined : Number(form.dailyRate),
  });
  const save = useMutation({
    mutationFn: () =>
      initial
        ? api.ipd.beds.update(initial.id, {
            ...body(),
            roomNo: form.roomNo || null,
            chargeServiceCode: form.chargeServiceCode || null,
          })
        : api.ipd.beds.create({
            ...body(),
            wardId: ward.id,
            roomNo: form.roomNo || undefined,
            chargeServiceCode: form.chargeServiceCode || undefined,
          }),
    onSuccess: () => {
      if (!initial) setForm(empty);
      onDone();
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = initial
      ? I.updateBedSchema.safeParse({
          ...body(),
          roomNo: form.roomNo || null,
          chargeServiceCode: form.chargeServiceCode || null,
        })
      : I.bedInputSchema.safeParse({
          ...body(),
          wardId: ward.id,
          roomNo: form.roomNo || undefined,
          chargeServiceCode: form.chargeServiceCode || undefined,
        });
    const errs = parsed.success ? {} : fieldErrors(parsed.error.issues);
    if (!form.code.trim()) errs.code = 'Enter the bed code';
    if (initial && form.dailyRate === '') errs.dailyRate = 'Enter the daily rate';
    setErrors(errs);
    if (!Object.keys(errs).length) save.mutate();
  };
  const id = initial ? `bed-${initial.id}` : 'bed-new';
  return (
    <form className="grid gap-3" noValidate onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${id}-code`} label="Bed code" error={errors.code}>
          <Input
            id={`${id}-code`}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
            maxLength={20}
            placeholder={`${ward.code}-11`}
          />
        </Field>
        <Field id={`${id}-room`} label="Room (optional)" error={errors.roomNo}>
          <Input id={`${id}-room`} value={form.roomNo} onChange={(e) => setForm({ ...form, roomNo: e.target.value })} maxLength={20} />
        </Field>
      </div>
      <Field
        id={`${id}-rate`}
        label={initial ? 'Rate / day (₹)' : `Rate / day (blank = ward rate ${formatINR(ward.defaultDailyRate)})`}
        error={errors.dailyRate}
      >
        <Input id={`${id}-rate`} type="number" min={0} step="0.01" value={form.dailyRate} onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} />
      </Field>
      <Field id={`${id}-svc`} label="Billing service code for room rent (optional)" error={errors.chargeServiceCode}>
        <Input
          id={`${id}-svc`}
          value={form.chargeServiceCode}
          onChange={(e) => setForm({ ...form, chargeServiceCode: e.target.value.toUpperCase() })}
          maxLength={40}
        />
      </Field>
      {initial?.status === 'occupied' && (
        <p className="text-xs text-muted-foreground">A new rate applies from the next bed move; the current stay keeps its rate.</p>
      )}
      <ErrorBox error={save.error ? errorMessage(save.error) : null} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} {initial ? 'Save bed' : 'Add bed'}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function AddBeds({ ward, onDone }: { ward: I.Ward; onDone: () => void }) {
  const [form, setForm] = React.useState({
    prefix: `${ward.code}-`,
    from: '1',
    to: '10',
    dailyRate: '',
    chargeServiceCode: '',
  });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const create = useMutation({
    mutationFn: (body: I.BulkBeds) => api.ipd.beds.createMany(body),
    onSuccess: onDone,
  });
  const count = Math.max(0, Number(form.to) - Number(form.from) + 1);
  const [formError, setFormError] = React.useState<string | null>(null);
  const submit = () => {
    // Strings go to the schema as typed, so a blank "From" is an error instead of 0.
    const body: I.BulkBeds = {
      wardId: ward.id,
      prefix: form.prefix,
      from: form.from,
      to: form.to,
      dailyRate: form.dailyRate === '' ? undefined : form.dailyRate,
      chargeServiceCode: form.chargeServiceCode || undefined,
    };
    const { errors: found } = validate(I.bulkBedsSchema, body);
    setErrors(found ?? {});
    setFormError(found ? (found._form ?? 'Please correct the highlighted fields') : null);
    if (!found) create.mutate(body);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add beds to {ward.name}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-3 gap-3">
          <Field id="b-prefix" label="Prefix" error={errors.prefix}>
            <Input id="b-prefix" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} maxLength={10} />
          </Field>
          <Field id="b-from" label="From" error={errors.from}>
            <Input id="b-from" type="number" min={0} max={9999} step={1} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </Field>
          <Field id="b-to" label="To" error={errors.to}>
            <Input id="b-to" type="number" min={0} max={9999} step={1} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </Field>
        </div>
        <Field id="b-rate" label={`Rate / day (blank = ward rate ${formatINR(ward.defaultDailyRate)})`} error={errors.dailyRate}>
          <Input id="b-rate" type="number" min={0} step="0.01" value={form.dailyRate} onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} />
        </Field>
        <Field id="b-svc" label="Billing service code for room rent (optional)" error={errors.chargeServiceCode}>
          <Input
            id="b-svc"
            value={form.chargeServiceCode}
            onChange={(e) => setForm({ ...form, chargeServiceCode: e.target.value.toUpperCase() })}
            maxLength={40}
          />
        </Field>
        <ErrorBox error={formError ?? (create.error ? errorMessage(create.error) : null)} />
        <Button disabled={create.isPending || count < 1} onClick={submit}>
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
  const [editing, setEditing] = React.useState<string | null>(null);

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
            beds.map((b) =>
              editing === b.id ? (
                <TableRow key={b.id} className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-4">
                    <BedForm
                      ward={ward}
                      initial={b}
                      onDone={() => {
                        setEditing(null);
                        onChanged();
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </TableCell>
                </TableRow>
              ) : (
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
                    <Button size="sm" variant="ghost" onClick={() => setEditing(b.id)}>
                      Edit
                    </Button>
                    {b.status !== 'occupied' && (
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: b.id, body: { isActive: !b.isActive } })}>
                        {b.isActive ? 'Retire' : 'Restore'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ),
            )
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
