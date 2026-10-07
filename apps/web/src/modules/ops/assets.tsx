'use client';

// Equipment add/edit and breakdown-report forms (used by /ops/assets and /ops/assets/[id]).
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ops as O } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ASSET_CATEGORY_LABELS, ErrorBox, Field, Textarea, humanize, num, opt } from './ui';

export interface AssetFormState {
  id?: string;
  code?: string;
  name: string;
  category: O.AssetCategory;
  criticality: O.AssetCriticality;
  status: 'in_service' | 'out_of_service' | 'condemned' | '';
  make: string;
  model: string;
  serialNo: string;
  location: string;
  purchaseDate: string;
  purchaseCost: string;
  vendor: string;
  warrantyUntil: string;
  amcVendor: string;
  amcUntil: string;
  pmIntervalDays: string;
  nextPmDue: string;
  calibrationDue: string;
  notes: string;
}
export const blankAssetForm: AssetFormState = {
  name: '',
  category: 'general',
  criticality: 'medium',
  status: '',
  make: '',
  model: '',
  serialNo: '',
  location: '',
  purchaseDate: '',
  purchaseCost: '',
  vendor: '',
  warrantyUntil: '',
  amcVendor: '',
  amcUntil: '',
  pmIntervalDays: '',
  nextPmDue: '',
  calibrationDue: '',
  notes: '',
};

export const assetToForm = (a: O.Asset): AssetFormState => ({
  id: a.id,
  code: a.code,
  name: a.name,
  category: a.category,
  criticality: a.criticality,
  status: a.status === 'under_maintenance' ? '' : a.status,
  make: a.make ?? '',
  model: a.model ?? '',
  serialNo: a.serialNo ?? '',
  location: a.location ?? '',
  purchaseDate: a.purchaseDate ?? '',
  purchaseCost: a.purchaseCost == null ? '' : String(a.purchaseCost),
  vendor: a.vendor ?? '',
  warrantyUntil: a.warrantyUntil ?? '',
  amcVendor: a.amcVendor ?? '',
  amcUntil: a.amcUntil ?? '',
  pmIntervalDays: a.pmIntervalDays == null ? '' : String(a.pmIntervalDays),
  nextPmDue: a.nextPmDue ?? '',
  calibrationDue: a.calibrationDue ?? '',
  notes: a.notes ?? '',
});

/** Add / edit equipment form. Exported for reuse on the detail page. */
export function AssetForm({ initial, onDone }: { initial: AssetFormState; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<AssetFormState>(initial);
  const set = (patch: Partial<AssetFormState>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: (f: AssetFormState) => {
      const body: O.AssetInput = {
        name: f.name.trim(),
        category: f.category,
        criticality: f.criticality,
        make: opt(f.make),
        model: opt(f.model),
        serialNo: opt(f.serialNo),
        location: opt(f.location),
        purchaseDate: opt(f.purchaseDate),
        purchaseCost: num(f.purchaseCost),
        vendor: opt(f.vendor),
        warrantyUntil: opt(f.warrantyUntil),
        amcVendor: opt(f.amcVendor),
        amcUntil: opt(f.amcUntil),
        pmIntervalDays: num(f.pmIntervalDays),
        nextPmDue: opt(f.nextPmDue),
        calibrationDue: opt(f.calibrationDue),
        notes: opt(f.notes),
      };
      return f.id ? api.ops.assets.update(f.id, { ...body, status: f.status || undefined }) : api.ops.assets.create(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });

  const date = (key: keyof AssetFormState, label: string) => (
    <Field id={`a-${key}`} label={label}>
      <Input id={`a-${key}`} type="date" value={form[key] ?? ''} onChange={(e) => set({ [key]: e.target.value } as Partial<AssetFormState>)} />
    </Field>
  );
  const text = (key: keyof AssetFormState, label: string, className?: string) => (
    <Field id={`a-${key}`} label={label} className={className}>
      <Input id={`a-${key}`} value={form[key] ?? ''} onChange={(e) => set({ [key]: e.target.value } as Partial<AssetFormState>)} />
    </Field>
  );

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{form.id ? `Edit ${form.code} · ${initial.name}` : 'Add equipment'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={save.error ? errorMessage(save.error) : null} />
          </div>
          <Field id="a-name" label="Name *" className="sm:col-span-2">
            <Input id="a-name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Multipara monitor" required />
          </Field>
          <Field id="a-category" label="Category">
            <Select id="a-category" value={form.category} onChange={(e) => set({ category: e.target.value as O.AssetCategory })}>
              {O.ASSET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ASSET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="a-crit" label="Criticality">
            <Select id="a-crit" value={form.criticality} onChange={(e) => set({ criticality: e.target.value as O.AssetCriticality })}>
              {O.ASSET_CRITICALITY.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
          {text('make', 'Make')}
          {text('model', 'Model')}
          {text('serialNo', 'Serial no.')}
          {text('location', 'Location')}
          {date('purchaseDate', 'Purchase date')}
          <Field id="a-cost" label="Purchase cost (₹)">
            <Input id="a-cost" type="number" min={0} step="0.01" value={form.purchaseCost} onChange={(e) => set({ purchaseCost: e.target.value })} />
          </Field>
          {text('vendor', 'Vendor')}
          {date('warrantyUntil', 'Warranty until')}
          {text('amcVendor', 'AMC / CMC vendor')}
          {date('amcUntil', 'AMC until')}
          <Field id="a-pm" label="PM every (days)">
            <Input id="a-pm" type="number" min={0} max={3650} value={form.pmIntervalDays} onChange={(e) => set({ pmIntervalDays: e.target.value })} placeholder="e.g. 180" />
          </Field>
          {date('nextPmDue', 'Next PM due')}
          {date('calibrationDue', 'Calibration due')}
          {form.id && (
            <Field id="a-status" label="Status">
              <Select id="a-status" value={form.status} onChange={(e) => set({ status: e.target.value as AssetFormState['status'] })}>
                <option value="">{initial.status === '' ? 'Under maintenance (follows work orders)' : 'No change'}</option>
                <option value="in_service">In service</option>
                <option value="out_of_service">Out of service</option>
                <option value="condemned">Condemned</option>
              </Select>
            </Field>
          )}
          <Field id="a-notes" label="Notes" className="sm:col-span-4">
            <Textarea id="a-notes" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-4">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function BreakdownForm({ asset, onDone }: { asset: O.Asset; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = React.useState('');
  const [priority, setPriority] = React.useState<'low' | 'normal' | 'urgent'>(asset.criticality === 'high' ? 'urgent' : 'normal');
  const report = useMutation({
    mutationFn: () => api.ops.workOrders.create({ assetId: asset.id, type: 'breakdown', problem: problem.trim(), priority }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        report.mutate();
      }}
    >
      <div className="sm:col-span-6">
        <ErrorBox error={report.error ? errorMessage(report.error) : null} />
      </div>
      <Field id={`bd-${asset.id}`} label={`What is wrong with ${asset.name}? *`} className="sm:col-span-4">
        <Input id={`bd-${asset.id}`} value={problem} onChange={(e) => setProblem(e.target.value)} required autoFocus />
      </Field>
      <Field id={`bdp-${asset.id}`} label="Priority">
        <Select id={`bdp-${asset.id}`} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </Select>
      </Field>
      <div className="flex items-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" size="sm" variant="destructive" disabled={report.isPending}>
          {report.isPending && <Loader2 className="animate-spin" />}
          Report
        </Button>
      </div>
    </form>
  );
}

