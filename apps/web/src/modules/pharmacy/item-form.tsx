'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { pharmacy } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SCHEDULE_LABEL } from './format';

const opt = { setValueAs: (v: string) => (v === '' ? undefined : v) };
const n = { setValueAs: (v: string) => (v === '' ? undefined : Number(v)) };

function Field({ id, label, error, children, hint }: { id: string; label: string; error?: { message?: string }; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-1">
        <FieldError error={error} />
      </div>
    </div>
  );
}

/** Create and edit form for a drug / item. In edit mode the code is fixed. */
export function ItemForm({
  initial,
  submitLabel,
  onSubmit,
  pending,
  error,
}: {
  initial?: pharmacy.Item;
  submitLabel: string;
  onSubmit: (values: pharmacy.CreateItem) => void;
  pending: boolean;
  error: unknown;
}) {
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(pharmacy.createItemSchema),
    defaultValues: initial
      ? {
          code: initial.code,
          name: initial.name,
          genericName: initial.genericName ?? undefined,
          form: initial.form,
          strength: initial.strength ?? undefined,
          manufacturer: initial.manufacturer ?? undefined,
          hsnCode: initial.hsnCode ?? undefined,
          gstRate: initial.gstRate,
          unit: initial.unit,
          packSize: initial.packSize,
          schedule: initial.schedule,
          reorderLevel: initial.reorderLevel,
        }
      : { code: '', name: '', form: 'tablet' as const, gstRate: 5, unit: 'tablet', packSize: 10, schedule: 'otc' as const, reorderLevel: 0 },
  });
  const { errors } = formState;

  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v))} noValidate className="space-y-6">
      {!!error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorMessage(error)}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Drug details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field id="code" label="Code *" error={errors.code} hint="Short unique code, e.g. PCM500">
            <Input id="code" disabled={!!initial} aria-invalid={!!errors.code} {...register('code')} />
          </Field>
          <Field id="name" label="Brand / item name *" error={errors.name}>
            <Input id="name" aria-invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field id="genericName" label="Generic name" error={errors.genericName}>
            <Input id="genericName" {...register('genericName', opt)} />
          </Field>
          <Field id="strength" label="Strength" error={errors.strength}>
            <Input id="strength" placeholder="e.g. 500 mg" {...register('strength', opt)} />
          </Field>
          <Field id="form" label="Form" error={errors.form}>
            <Select id="form" {...register('form')}>
              {pharmacy.ITEM_FORMS.map((f) => (
                <option key={f} value={f}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="manufacturer" label="Manufacturer" error={errors.manufacturer}>
            <Input id="manufacturer" {...register('manufacturer', opt)} />
          </Field>
          <Field id="schedule" label="Schedule" error={errors.schedule} hint="H, H1, X and narcotics need a prescription">
            <Select id="schedule" {...register('schedule')}>
              {pharmacy.DRUG_SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="reorderLevel" label="Reorder level" error={errors.reorderLevel} hint="Alert when stock falls to this many units">
            <Input id="reorderLevel" type="number" min={0} {...register('reorderLevel', n)} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Units &amp; tax</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field id="unit" label="Sale unit *" error={errors.unit} hint="Stock and prices are per this unit">
            <Input id="unit" placeholder="tablet, strip, bottle…" {...register('unit')} />
          </Field>
          <Field id="packSize" label="Units per pack" error={errors.packSize}>
            <Input id="packSize" type="number" min={1} {...register('packSize', n)} />
          </Field>
          <Field id="hsnCode" label="HSN code" error={errors.hsnCode}>
            <Input id="hsnCode" inputMode="numeric" placeholder="e.g. 30049099" {...register('hsnCode', opt)} />
          </Field>
          <Field id="gstRate" label="GST %" error={errors.gstRate}>
            <Input id="gstRate" type="number" step="0.01" min={0} max={40} {...register('gstRate', n)} />
          </Field>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
